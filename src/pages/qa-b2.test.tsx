// Page checks for the cycle, dashboard and person-page fixes from the QA pass: cycle dialogs
// that refuse a twin, a month page that reads like a month, an employee who keeps the month they
// still owe, and job role modules that say and do the same thing for admins and retired roles.
// Same mocked data layer as pages.test.tsx; every test puts back what it changes.
import { fireEvent, screen, within } from "@testing-library/react";
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
// The review page reads the role scorecard, project assignments and project notes (0035).
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createCycle, createPillar, deleteCycle, deletePillar, listCycles, updateReview } from "../services/gsr.ts";
import { createEmployeeFinancial, deleteEmployeeFinancial } from "../services/employees.ts";
import { updateJobRole } from "../services/jobRoles.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import DashboardPage from "./DashboardPage.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import CyclePage from "./gsr/CyclePage.tsx";
import MyGsrPage from "./gsr/MyGsrPage.tsx";
import PersonPage from "./people/PersonPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rbaAdmin = makeHub("admin", RBA.company);
const september = KLASIK.cycles[0];
const august = KLASIK.cycles[1];
const sam = KLASIK.profiles[1];
const role = KLASIK.jobRoles[0];
const FIXTURE_NOW = new Date("2026-09-15T12:00:00.000Z");

function renderCycle(cycleId: string, hub = admin, section: "gsr" | "reviews" = "gsr") {
  return renderWithHub(<CyclePage />, hub, { path: `/${section}/cycles/${cycleId}`, pattern: `/${section}/cycles/:cycleId` });
}

describe("cycle dialogs", () => {
  it("refuses a second month over one that already exists, naming it", async () => {
    const user = userEvent.setup();
    const before = (await listCycles(KLASIK.company.id)).length;
    renderWithHub(<CyclesPage section="gsr" />, admin);
    await user.click(await screen.findByRole("button", { name: /New month/ }));
    const dialog = await screen.findByRole("dialog");
    // The form opens on this month, and September is already open.
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("2026-09-01");
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await within(dialog).findByText(/"September 2026" already covers Sep 1 to Sep 30, 2026/)).toBeInTheDocument();
    expect(await listCycles(KLASIK.company.id)).toHaveLength(before);
    expect(screen.queryByText("elsewhere")).not.toBeInTheDocument();

    // A month nobody has opened yet goes through.
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-10-01" } });
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    const october = (await listCycles(KLASIK.company.id)).find((c) => c.name === "October 2026");
    expect(october).toBeDefined();
    await deleteCycle(october!.id);
  });

  it("keeps an edited month on a calendar month and refuses one that lands on another", async () => {
    const user = userEvent.setup();
    renderCycle(august.id);
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog");
    const start = within(dialog).getByLabelText("Starts");
    const end = within(dialog).getByLabelText("Ends");
    // A month's end follows its start, the way the New month form has it.
    expect(end).toBeDisabled();
    fireEvent.change(start, { target: { value: "2026-09-10" } });
    expect(start).toHaveValue("2026-09-01");
    expect(end).toHaveValue("2026-09-30");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/"September 2026" already covers/)).toBeInTheDocument();
    // Nothing was saved: August is still August.
    const cycles = await listCycles(KLASIK.company.id);
    expect(cycles.find((c) => c.id === august.id)?.period_start).toBe("2026-08-01");
  });

  it("says the goals filed into a cycle are deleted with it", async () => {
    const user = userEvent.setup();
    renderCycle(september.id);
    await user.click(await screen.findByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/every review and score in it, and the goals filed into it/)).toBeInTheDocument();
  });
});

describe("cycle page", () => {
  it("tells a company with nobody on the roster to add the team, not to wait for sign-ins", async () => {
    const empty = { ...KLASIK.company, id: "co-empty", slug: "empty", name: "Empty Co" };
    const cycle = await createCycle({ company_id: empty.id, name: "September 2026", cadence: "monthly", period_start: "2026-09-01", period_end: "2026-09-30" });
    try {
      renderCycle(cycle.id, makeHub("admin", empty));
      expect(await screen.findByText(/Nobody on the roster yet/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/people");
      expect(screen.queryByText(/signed in/)).not.toBeInTheDocument();
    } finally {
      await deleteCycle(cycle.id);
    }
  });

  it("shows a month as a Goal Setting Review: no pillar columns, no team score, the locked GSR score", async () => {
    const riley = KLASIK.reviews.find((r) => r.cycle_id === september.id && r.status === "complete")!;
    const pillar = await createPillar({ company_id: KLASIK.company.id, name: "Monthly GSRs", weight: 0, scoring_type: "gsr_goals" });
    await updateReview(riley.id, { gsr_score: 43 });
    try {
      renderCycle(september.id);
      const table = await screen.findByRole("table");
      expect(within(table).queryByText("Brand Impact")).not.toBeInTheDocument();
      expect(within(table).queryByText("Overall")).not.toBeInTheDocument();
      expect(screen.queryByText("Team score")).not.toBeInTheDocument();
      expect(within(table).getByText("GSR score")).toBeInTheDocument();
      const rowFor = (id: string) => within(table).getByText(KLASIK.profiles.find((p) => p.id === id)!.full_name!).closest("tr")!;
      expect(rowFor(riley.employee_id)).toHaveTextContent("43%");
      expect(rowFor(sam.id)).toHaveTextContent("Not locked in");
    } finally {
      await updateReview(riley.id, { gsr_score: null });
      await deletePillar(pillar.id);
    }
  });

  it("shows a month with no GSR score column when the company does not score its GSRs", async () => {
    renderCycle(september.id);
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("GSR score")).not.toBeInTheDocument();
    expect(within(table).queryByText("Overall")).not.toBeInTheDocument();
    expect(screen.queryByText("Team score")).not.toBeInTheDocument();
  });

  it("keeps the pillar columns and team score on a scored cycle", async () => {
    renderCycle(RBA.cycles[0].id, rbaAdmin, "reviews");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Core Values")).toBeInTheDocument();
    expect(within(table).getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("Team score")).toBeInTheDocument();
    expect(within(table).queryByText("GSR score")).not.toBeInTheDocument();
  });
});

describe("an employee's month", () => {
  it("keeps a still-open month on My GSR and the dashboard while a quarter covers today", async () => {
    // October 5: Q4 covers today, September is over but nobody has closed it, and October has
    // not been opened. Sam still has September's GSR to finish.
    const q4 = await createCycle({ company_id: KLASIK.company.id, name: "Q4 2026", cadence: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31" });
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    try {
      const gsr = renderWithHub(<MyGsrPage />, employee);
      expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
      expect(screen.queryByText("No month open")).not.toBeInTheDocument();
      gsr.unmount();

      renderWithHub(<DashboardPage />, employee);
      expect(await screen.findByRole("button", { name: "Open my GSR" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: september.name })).toBeInTheDocument();
      expect(screen.queryByText("No month open")).not.toBeInTheDocument();
    } finally {
      vi.setSystemTime(FIXTURE_NOW);
      await deleteCycle(q4.id);
    }
  });

  it("keeps the still-open month ahead of a month opened early", async () => {
    // October 5: nothing covers today, September is over but still open, and November has been
    // opened early. November is the most recently started open cycle, but Sam still owes
    // September, so that is the month My GSR and the dashboard open.
    const november = await createCycle({ company_id: KLASIK.company.id, name: "November 2026", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" });
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    try {
      const gsr = renderWithHub(<MyGsrPage />, employee);
      expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Goal Setting Review · ${september.name}`))).toBeInTheDocument();
      expect(screen.queryByText(/November 2026/)).not.toBeInTheDocument();
      gsr.unmount();

      renderWithHub(<DashboardPage />, employee);
      expect(await screen.findByRole("button", { name: "Open my GSR" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: september.name })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "November 2026" })).not.toBeInTheDocument();
    } finally {
      vi.setSystemTime(FIXTURE_NOW);
      await deleteCycle(november.id);
    }
  });
});

describe("job role modules", () => {
  it("marks a retired role on the person page and does not claim its module is on the dashboard", async () => {
    await updateJobRole(role.id, { is_active: false });
    try {
      const person = renderWithHub(<PersonPage />, admin, { path: `/people/${sam.id}`, pattern: "/people/:profileId" });
      expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
      expect(await screen.findByLabelText("Job role")).toHaveValue(role.id);
      expect(screen.getByText(/is retired, so it no longer puts its modules on their dashboard/)).toBeInTheDocument();
      expect(screen.queryByText(/On their dashboard, because/)).not.toBeInTheDocument();
      expect(screen.getByText(/Not on their dashboard: .* is retired/)).toBeInTheDocument();
      person.unmount();

      // And the dashboard agrees: a retired role adds nothing.
      renderWithHub(<DashboardPage />, employee);
      expect(await screen.findByText(/Welcome back, Sam/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Your figures" })).not.toBeInTheDocument();
    } finally {
      await updateJobRole(role.id, { is_active: true });
    }
  });

  it("shows an admin holding a job role the module that role carries", async () => {
    const owner = admin.profile;
    const figure = await createEmployeeFinancial({ employee_id: owner.id, year: 2026, metric: "Company revenue", target: 10000000, current: 6400000 });
    try {
      // Not in a role: the admin dashboard carries no figures of their own.
      const plain = renderWithHub(<DashboardPage />, admin);
      expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Your figures" })).not.toBeInTheDocument();
      plain.unmount();

      renderWithHub(<DashboardPage />, { ...admin, profile: { ...owner, job_role_id: role.id } });
      expect(await screen.findByRole("heading", { name: "Your figures" })).toBeInTheDocument();
      expect(screen.getByText("Company revenue")).toBeInTheDocument();
      expect(screen.getByText("$6,400,000 of $10,000,000")).toBeInTheDocument();
    } finally {
      await deleteEmployeeFinancial(figure.id);
    }
  });
});
