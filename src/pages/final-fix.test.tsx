// The final review fix wave of the hub clarity plan: the read-first rows hand focus over the same
// way everywhere, Divisions reads first, every destructive control carries a word, Goals points to
// what left it, and the small consistency fixes. Rendered against the mocked data layer, as
// pages.test.tsx is.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/audit.ts", () => import("../test/mocks/audit.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/wins.ts", () => import("../test/mocks/wins.ts"));
vi.mock("../services/sync.ts", () => import("../test/mocks/sync.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/milestoneTemplates.ts", () => import("../test/mocks/milestoneTemplates.ts"));

import { KINGDOM, RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import CompensationTable from "../components/people/CompensationTable.tsx";
import FinancialsTable from "../components/people/FinancialsTable.tsx";
import KpiList from "../components/people/KpiList.tsx";
import GsrSetupPage from "./gsr/GsrSetupPage.tsx";
import GoalsPage from "./gsr/GoalsPage.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import UsersPage from "./rococo/UsersPage.tsx";
import type { CompensationItem, EmployeeFinancial, EmployeeKpi } from "../types/database.ts";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rbaAdmin = makeHub("admin", RBA.company);
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const rococo = makeHub("rococo", null);
const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };

describe("read-first rows hand focus over", () => {
  it("moves focus into a milestone on open and back to its pencil on Escape", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    const pencil = screen.getAllByRole("button", { name: /^Edit / })[0];
    const title = pencil.getAttribute("aria-label")!.replace(/^Edit /, "");
    await user.click(pencil);
    expect(screen.getByLabelText(`Title of ${title}`)).toHaveFocus();
    // The danger action stays worded beside Done.
    expect(screen.getByRole("button", { name: `Archive ${title}` })).toHaveTextContent("Archive");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(`Title of ${title}`)).toBeNull();
    expect(screen.getByRole("button", { name: `Edit ${title}` })).toHaveFocus();
  });

  it("moves focus to a person's company on open and back to the pencil on Done in Rococo People", async () => {
    const user = userEvent.setup();
    const marcus = KINGDOM.profiles[0];
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    await screen.findByText("Austin Rococo (you)");
    await user.click(screen.getByRole("button", { name: `Edit ${marcus.email}` }));
    expect(screen.getByRole("combobox", { name: `Company for ${marcus.email}` })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: `Edit ${marcus.email}` })).toHaveFocus();
  });
});

// A destructive control shows its word on screen at every width; its accessible name is the one it
// always had and contains that word.
async function expectWorded(name: string | RegExp, word: string) {
  const buttons = await screen.findAllByRole("button", { name }, { timeout: 3000 });
  for (const button of buttons) {
    expect(button).toHaveTextContent(word);
    expect(button.querySelector("svg")).toBeNull();
  }
}

describe("destructive controls keep their words", () => {
  it("cancels an invitation with words on the roster", async () => {
    renderWithHub(<PeoplePage />, admin);
    await expectWorded("Cancel the invitation for Avery Cole", "Cancel invitation");
  });

  it("deletes a company goal and a person's goal with words", async () => {
    const first = renderWithHub(<GoalsPage tab="company" />, admin);
    await expectWorded("Delete goal", "Delete");
    first.unmount();
    renderWithHub(<MyGoalsPage />, employee);
    await expectWorded("Delete goal", "Delete");
  });

  it("removes a review's deliverable line item with words", async () => {
    const review = RBA.reviews.find((r) => r.status === "in_progress")!;
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    await expectWorded("Remove deliverable", "Remove");
  });

  it("removes a month's focus topic with words", async () => {
    renderWithHub(<GsrSetupPage />, admin);
    await expectWorded("Remove the September 2026 topic", "Remove");
  });

  it("removes a person's pay line, figure and KPI with words at the row's end", async () => {
    const stamp = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const item: CompensationItem = { id: "comp-1", company_id: "co-1", employee_id: "person-1", name: "Base salary", annual_amount: 60000, note: null, sort_order: 1, ...stamp };
    const figure: EmployeeFinancial = { id: "fin-1", company_id: "co-1", employee_id: "person-1", year: 2026, metric: "Closed sales", target: 500000, current: 120000, source: "manual", note: null, sort_order: 1, ...stamp };
    const kpi: EmployeeKpi = { id: "kpi-1", company_id: "co-1", employee_id: "person-1", year: 2026, name: "Jobs closed", target_display: "12", current_display: "4", target_numeric: null, current_numeric: null, is_hit: false, sort_order: 1, ...stamp };
    render(
      <>
        <CompensationTable companyId="co-1" employeeId="person-1" items={[item]} canEdit onChange={vi.fn()} onError={vi.fn()} />
        <FinancialsTable employeeId="person-1" year={2026} rows={[figure]} canEdit onChange={vi.fn()} onError={vi.fn()} />
        <KpiList companyId="co-1" employeeId="person-1" year={2026} kpis={[kpi]} canEdit onChange={vi.fn()} onError={vi.fn()} />
      </>,
    );
    await expectWorded("Remove Base salary", "Remove");
    await expectWorded("Remove figure Closed sales", "Remove");
    await expectWorded("Remove KPI Jobs closed", "Remove");
  });
});

// The rule as a guard over the source: no icon button anywhere carries a destructive name, so a
// trash or a cross can never stand alone for Remove, Delete, Unassign or Cancel again.
describe("no icon-only destructive control is left", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
    });
  }

  it("finds no IconButton or IconLink named for a destructive action", () => {
    const offenders: string[] = [];
    for (const file of files(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<Icon(?:Button|Link)\b[^>]*?label=\{?["'`](Remove|Delete|Unassign|Cancel|Archive|Retire)\b/g)) offenders.push(`${file}: ${match[0].slice(0, 80)}`);
      if (/<Trash2\b/.test(text) && /<IconButton\b[^>]*>\s*<Trash2/.test(text)) offenders.push(`${file}: IconButton with a trash icon`);
    }
    expect(offenders).toEqual([]);
  });
});
