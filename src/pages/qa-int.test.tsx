// Integration-review regressions: places where two separately fixed screens met. The lock
// dialog on a monthly GSR keeps its own failure line, apart from the page's notice. The mocks
// are the usual in-memory data layer, with a switch to make one named call fail once.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => {
  // name -> what the next call to it throws
  const failures = new Map<string, unknown>();
  function wrap<T extends object>(mod: T, names: string[]): T {
    const out: Record<string, unknown> = { ...(mod as Record<string, unknown>) };
    for (const name of names) {
      const fn = (mod as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
      out[name] = async (...args: unknown[]) => {
        if (failures.has(name)) {
          const err = failures.get(name);
          failures.delete(name);
          throw err;
        }
        return fn(...args);
      };
    }
    return out as T;
  }
  return { failures, wrap };
});

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", async () => ctl.wrap(await import("../test/mocks/gsr.ts"), ["updateGoal", "updateReview"]));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
// The review page reads the role scorecard, project assignments and project notes (0035).
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KLASIK, makeHub } from "../test/fixtures.ts";
import { createGoal, createPillar } from "../services/gsr.ts";
import ReviewPage from "./gsr/ReviewPage.tsx";

const admin = makeHub("admin");

describe("the lock dialog on a monthly GSR", () => {
  it("opens clean after a goal save failed, shows its own failure, and leaves the page notice alone", async () => {
    const user = userEvent.setup();
    const casey = KLASIK.profiles.find((p) => p.full_name === "Casey Nguyen")!;
    const review = KLASIK.reviews.find((r) => r.cycle_id === KLASIK.cycles[0].id && r.employee_id === casey.id)!;
    await createPillar({ company_id: KLASIK.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    // The month the existing lock test reads: a focus GSR, a role goal and a personal stretch.
    const month = [
      ["Feel better day to day", "personal", 80, false],
      ["Price every change order inside a day", "role", 30, false],
      ["Teach the team the new estimate template", "professional", 50, true],
    ] as const;
    for (const [i, [goalTitle, kind, progress, isFocus]] of month.entries()) {
      await createGoal({ company_id: KLASIK.company.id, employee_id: casey.id, title: goalTitle, kind, progress, is_focus: isFocus, scope: "cycle", cycle_id: KLASIK.cycles[0].id, sort_order: i + 1 });
    }
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });

    // A goal save fails: the page says so.
    const title = (await screen.findAllByLabelText(/^Title for /))[0] as HTMLInputElement;
    ctl.failures.set("updateGoal", new Error("The goal did not save."));
    await user.clear(title);
    await user.type(title, "Renamed goal");
    await user.tab();
    expect(await screen.findByText("The goal did not save.")).toBeInTheDocument();

    // The lock dialog opens without that failure in it.
    await user.click(screen.getByRole("button", { name: /Mark complete/ }));
    const dialog = (await screen.findByRole("heading", { name: /^Lock in Casey's/ })).closest("[role=dialog]") as HTMLElement;
    expect(within(dialog).queryByText("The goal did not save.")).not.toBeInTheDocument();

    // A failed lock shows inside the dialog.
    ctl.failures.set("updateReview", new Error("The lock did not save."));
    await user.click(within(dialog).getByRole("button", { name: "Mark complete and lock in" }));
    expect(await within(dialog).findByText("The lock did not save.")).toBeInTheDocument();

    // Cancelling closes it and keeps the page's own notice.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /^Lock in Casey's/ })).not.toBeInTheDocument());
    expect(screen.getByText("The goal did not save.")).toBeInTheDocument();
    expect(screen.queryByText("The lock did not save.")).not.toBeInTheDocument();
  });
});
