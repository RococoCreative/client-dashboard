// Page checks for the follow-up on cycles, dashboards, the person page and the review page: the
// quarter's GSR line that must not vanish when a month covers today, a Rococo admin's role left
// to Rococo on their person page, a signed-off review whose My reviews card says what its review
// page says, a deliverables figure that belongs to the review on screen, and dashboard copy that
// is true for whoever reads it. Same mocked data layer as pages.test.tsx; every test puts back
// what it changes.
import { fireEvent, screen, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

// The review page hands the deliverables panel a callback and reads the year's figure from it.
// A panel told to stay quiet for one person never reports, which holds open the moment between
// one review's figure and the next one's, so a test can see which figure the page is using.
const panel = vi.hoisted(() => ({ quietFor: new Set<string>() }));

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
vi.mock("../components/people/DeliverablesPanel.tsx", async () => {
  const actual = await vi.importActual<typeof import("../components/people/DeliverablesPanel.tsx")>("../components/people/DeliverablesPanel.tsx");
  const Real = actual.default;
  return {
    default: function DeliverablesPanel(props: ComponentProps<typeof Real>) {
      return <Real {...props} onRollup={panel.quietFor.has(props.employeeId) ? undefined : props.onRollup} />;
    },
  };
});
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createCycle, createPillar, deleteCycle, deletePillar, ensureReview, updateReview } from "../services/gsr.ts";
import { createEmployeeFinancial, deleteEmployeeFinancial } from "../services/employees.ts";
import { updateProfile } from "../services/profiles.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import DashboardPage from "./DashboardPage.tsx";
import MyReviewsPage from "./gsr/MyReviewsPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import PersonPage from "./people/PersonPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rbaAdmin = makeHub("admin", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
const FIXTURE_NOW = new Date("2026-09-15T12:00:00.000Z");
const q3 = RBA.cycles[0];
const jamie = RBA.profiles[1];
const sectionFor = async (name: string) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;
const personAt = (id: string) => ({ path: `/people/${id}`, pattern: "/people/:profileId" });

describe("the quarter's GSR line", () => {
  it("stays on the dashboard and the person page while a month covers today and the quarter is still open", async () => {
    // October 5: October's GSR covers today, Q3 is over but nobody has closed it, and Q4 does not
    // exist yet. The months Jamie is being scored on in Q3 still count toward a review he owes.
    const gsrPillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    const october = await createCycle({ company_id: RBA.company.id, name: "October 2026", cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31" });
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    try {
      const dash = renderWithHub(<DashboardPage />, rbaEmployee);
      expect(await screen.findByText(`Monthly GSRs, ${q3.name}`)).toBeInTheDocument();
      dash.unmount();

      renderWithHub(<PersonPage />, rbaAdmin, personAt(jamie.id));
      expect(await screen.findByRole("heading", { name: "Jamie Fox" })).toBeInTheDocument();
      expect(await screen.findByText(`Monthly GSRs, ${q3.name}`)).toBeInTheDocument();
    } finally {
      vi.setSystemTime(FIXTURE_NOW);
      await deleteCycle(october.id);
      await deletePillar(gsrPillar.id);
    }
  });

  it("stays when nothing covers today and the most recently opened cycle is a month opened early", async () => {
    // October 5: Q3 is over but still open, September's GSR is over, and November was opened early.
    const gsrPillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    const november = await createCycle({ company_id: RBA.company.id, name: "November 2026", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" });
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    try {
      renderWithHub(<DashboardPage />, rbaEmployee);
      expect(await screen.findByText(`Monthly GSRs, ${q3.name}`)).toBeInTheDocument();
    } finally {
      vi.setSystemTime(FIXTURE_NOW);
      await deleteCycle(november.id);
      await deletePillar(gsrPillar.id);
    }
  });
});

describe("a Rococo admin's person page", () => {
  it("offers a company admin no role control, the same as the People list", async () => {
    const riley = KLASIK.profiles[2];
    await updateProfile(riley.id, { is_rococo_admin: true });
    try {
      const rococoRow = renderWithHub(<PersonPage />, admin, personAt(riley.id));
      expect(await screen.findByRole("heading", { name: "Riley Park" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
      expect(screen.getByText("Rococo Creative")).toBeInTheDocument();
      rococoRow.unmount();
    } finally {
      await updateProfile(riley.id, { is_rococo_admin: false });
    }
    // Everyone else keeps it.
    renderWithHub(<PersonPage />, admin, personAt(riley.id));
    expect(await screen.findByLabelText("Role")).toBeEnabled();
    expect(screen.queryByText("Rococo Creative")).not.toBeInTheDocument();
  });
});

describe("a signed-off review with nothing scored on it", () => {
  it("reads its Monthly GSRs bar on My reviews the way the review page does", async () => {
    // Someone set up and reviewed before any rating or month was recorded: the review is signed
    // off with no month locked in, so that pillar sat out of the score of record, and the card says so.
    const gsrPillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    const fresh = { ...rbaEmployee.profile, id: "rba-fresh-person", full_name: "Robin Fresh" };
    const review = await ensureReview(q3.id, RBA.company.id, fresh.id);
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: RBA.profiles[0].id });
    try {
      renderWithHub(<MyReviewsPage />, { ...rbaEmployee, profile: fresh });
      const card = await sectionFor(q3.name);
      const bar = within(card).getByText("Monthly GSRs (left out)").parentElement as HTMLElement;
      expect(within(bar).getByText("No month locked in")).toBeInTheDocument();
      expect(within(bar).queryByText("Not scored")).not.toBeInTheDocument();
    } finally {
      await updateReview(review.id, { status: "in_progress", completed_at: null });
      await deletePillar(gsrPillar.id);
    }
  });
});

describe("the deliverables figure on a review", () => {
  it("belongs to the person on screen, never to the review shown before it", async () => {
    // Klasik scores a pillar from the deliverables module. Sam has a year of rated tasks; Riley has
    // none reported yet. Moving from Sam's quarter to Riley's in place must not score Riley's
    // review, or freeze it at sign-off, with Sam's figure.
    const [sam, riley] = [KLASIK.profiles[1], KLASIK.profiles[2]];
    const quarter = KLASIK.cycles[2];
    const modulePillar = await createPillar({ company_id: KLASIK.company.id, name: "Deliverables module", weight: 20, scoring_type: "deliverables_module", sort_order: 5 });
    const samReview = await ensureReview(quarter.id, KLASIK.company.id, sam.id);
    const rileyReview = await ensureReview(quarter.id, KLASIK.company.id, riley.id);
    panel.quietFor.add(riley.id);
    function Switcher() {
      const [id, setId] = useState(samReview.id);
      return (
        <>
          <button type="button" onClick={() => setId(rileyReview.id)}>next review</button>
          <ReviewPage reviewId={id} embedded />
        </>
      );
    }
    try {
      renderWithHub(<Switcher />, admin);
      const samCard = await sectionFor("Deliverables module");
      expect(await within(samCard).findByText(/6 of 10 points across the year's deliverables/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "next review" }));
      expect(await screen.findByRole("heading", { name: "Riley Park" })).toBeInTheDocument();
      const rileyCard = await sectionFor("Deliverables module");
      expect(within(rileyCard).queryByText(/6 of 10 points/)).not.toBeInTheDocument();
      expect(within(rileyCard).getByText("Reading the year's deliverables...")).toBeInTheDocument();
      // And the score so far does not count it either: Mark complete waits for Riley's own figure.
      expect(screen.getByRole("button", { name: /Mark complete/ })).toBeDisabled();
    } finally {
      panel.quietFor.delete(riley.id);
      await deletePillar(modulePillar.id);
    }
  });
});

describe("your figures on a dashboard", () => {
  it("says where the figures are kept in words true for an admin and an employee", async () => {
    const role = KLASIK.jobRoles[0];
    const owner = admin.profile;
    const ownFigure = await createEmployeeFinancial({ employee_id: owner.id, year: 2026, metric: "Company revenue", target: 10000000, current: 6400000 });
    try {
      const adminDash = renderWithHub(<DashboardPage />, { ...admin, profile: { ...owner, job_role_id: role.id } });
      const adminFigures = await sectionFor("Your figures");
      expect(adminFigures).not.toHaveTextContent(/your manager/i);
      expect(adminFigures).toHaveTextContent(`What ${role.name} owns this year, against target, as recorded on your profile.`);
      adminDash.unmount();

      // Sam holds the role too, and reads the same line.
      renderWithHub(<DashboardPage />, employee);
      const employeeFigures = await sectionFor("Your figures");
      expect(employeeFigures).not.toHaveTextContent(/your manager/i);
      expect(employeeFigures).toHaveTextContent(`What ${role.name} owns this year, against target, as recorded on your profile.`);
    } finally {
      await deleteEmployeeFinancial(ownFigure.id);
    }
  });
});
