// GSR rhythms (0046) on the screens: a person on a weekly or two-week rhythm works their own period
// from My GSR, opening it when nobody has; a manager sets the rhythm of someone they lead and locks
// their weekly GSR in; the New GSR period form computes a week's dates; and a quarterly review's
// GSR line averages the weeks locked inside it. Each test reads the in-memory data layer the way
// the page does.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { describe, expect, it, onTestFinished, vi } from "vitest";

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
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));

import { HubContext, type HubValue } from "../context/HubContext.tsx";
import * as profilesService from "../services/profiles.ts";
import { createPillar, deletePillar, ensureGsrCycle, ensureReview, getReview, listCycles, listEmployeeReviews, updateReview } from "../services/gsr.ts";
import { RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import MyGsrPage from "./gsr/MyGsrPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import PersonPage from "./people/PersonPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const harper = byName("Harper Quinn");
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");
const morgan = byName("Morgan Reyes");
const noor = byName("Noor Haddad");
const team = [harper.id, rowan.id, kai.id];
// RBA's open week, Monday September 14 to Sunday September 20, covering the fixture's today.
const week = RBA.cycles.find((c) => c.kind === "gsr" && c.cadence === "weekly")!;
const q3 = RBA.cycles.find((c) => c.kind === "review" && c.status === "open")!;
const reviewAt = (id: string) => ({ path: `/gsr/reviews/${id}`, pattern: "/gsr/reviews/:reviewId" });

// The data layer judges a write as the persona the URL names (actorIn). Writing as Harper, and back
// to the default Klasik admin when the test ends, so no later test inherits her.
function writeAs(persona: string, company: string) {
  window.history.pushState({}, "", `/?persona=${persona}&company=${company}`);
  onTestFinished(() => window.history.pushState({}, "", "/?persona=admin&company=klasik"));
}

// What listCompanyProfiles returns under RLS for a viewer who sees only these people.
function onlySees(ids: string[]) {
  const original = profilesService.listCompanyProfiles;
  const spy = vi.spyOn(profilesService, "listCompanyProfiles").mockImplementation(async (companyId) => (await original(companyId)).filter((p) => ids.includes(p.id)));
  onTestFinished(() => spy.mockRestore());
}

function ReviewStub() {
  const { reviewId } = useParams();
  return <div>review {reviewId}</div>;
}

// The person page with the GSR review route beside it, so starting a GSR can land somewhere. It
// opens on Overview; `tab` lands on another of the page's tabs, such as an admin's Setup.
function renderPerson(id: string, hub: HubValue, tab?: string) {
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[tab ? `/people/${id}/${tab}` : `/people/${id}`]}>
        <Routes>
          <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
          <Route path="/gsr/reviews/:reviewId" element={<ReviewStub />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

describe("My GSR at a weekly rhythm", () => {
  it("reads as this week's GSR, and starting it opens the week", async () => {
    const user = userEvent.setup();
    const hub: HubValue = { ...rbaEmployee, profile: morgan };
    renderWithHub(<MyGsrPage />, hub);
    expect(await screen.findByText(`This week's GSR · ${week.name}`)).toBeInTheDocument();
    expect(screen.getByText(/Start your Goal Setting Review for Sep 14 to Sep 20, 2026/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start my GSR" }));
    expect(await screen.findByText("Goals for this week")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a goal for this week")).toBeInTheDocument();
    const reviews = await listEmployeeReviews(RBA.company.id, morgan.id);
    expect(reviews.map((r) => r.cycle_id)).toEqual([week.id]);
  });

  it("opens a two-week period nobody has opened yet, on the shared two-week calendar", async () => {
    const user = userEvent.setup();
    await profilesService.updateProfile(noor.id, { gsr_cadence: "biweekly" });
    onTestFinished(async () => {
      await profilesService.updateProfile(noor.id, { gsr_cadence: "monthly" });
    });
    const hub: HubValue = { ...rbaEmployee, profile: { ...noor, gsr_cadence: "biweekly" } };
    renderWithHub(<MyGsrPage />, hub);
    expect(await screen.findByText("These two weeks' GSR · Sep 7 to Sep 20, 2026")).toBeInTheDocument();
    expect((await listCycles(RBA.company.id)).some((c) => c.cadence === "biweekly")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Start my GSR" }));
    expect(await screen.findByText("Goals for these two weeks")).toBeInTheDocument();
    const opened = (await listCycles(RBA.company.id)).find((c) => c.cadence === "biweekly")!;
    expect(opened).toMatchObject({ kind: "gsr", period_start: "2026-09-07", period_end: "2026-09-20", name: "Sep 7 to Sep 20, 2026", status: "open" });
  });
});

describe("a manager and a led person's rhythm", () => {
  it("sets Kai to weekly, starts this week's GSR and locks it in", async () => {
    onlySees(team);
    writeAs("manager", "rba");
    onTestFinished(async () => {
      await profilesService.updateProfile(kai.id, { gsr_cadence: "monthly" });
    });
    const user = userEvent.setup();
    const page = renderPerson(kai.id, rbaManager);
    expect(await screen.findByRole("heading", { name: "This month's GSR" })).toBeInTheDocument();

    const rhythm = screen.getByLabelText("GSR rhythm");
    await user.selectOptions(rhythm, "weekly");
    await waitFor(async () => expect((await profilesService.listCompanyProfiles(RBA.company.id)).find((p) => p.id === kai.id)?.gsr_cadence).toBe("weekly"));
    expect(await screen.findByRole("heading", { name: "This week's GSR" })).toBeInTheDocument();
    expect(screen.getByText(/Kai's Goal Setting Review runs every week/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Start this week's GSR/ }));
    expect(await screen.findByText(/^review /)).toBeInTheDocument();
    const review = (await listEmployeeReviews(RBA.company.id, kai.id)).find((r) => r.cycle_id === week.id)!;
    expect(review.status).toBe("not_started");
    page.unmount();

    // The manager locks it in, and nothing else of theirs goes through.
    renderWithHub(<ReviewPage />, rbaManager, reviewAt(review.id));
    expect(await screen.findByText("Goals for this week")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mark complete/ }));
    expect(await screen.findByRole("button", { name: /Reopen/ })).toBeInTheDocument();
    expect((await getReview(review.id)).status).toBe("complete");
    await expect(updateReview(review.id, { manager_feedback: "Strong week" })).rejects.toThrow("A manager can lock and reopen a GSR, and nothing else on it.");
    await expect(profilesService.updateProfile(kai.id, { title: "Lead Carpenter" })).rejects.toThrow("A manager can change only the GSR rhythm of the people they lead.");
  });

  it("shows the rhythm read only on the manager's own page and to someone who does not lead them", async () => {
    onlySees([...team, morgan.id]);
    const own = renderPerson(harper.id, rbaManager);
    expect(await screen.findByText("GSR rhythm")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "GSR rhythm" })).not.toBeInTheDocument();
    own.unmount();

    renderPerson(morgan.id, rbaManager);
    expect(await screen.findByText("GSR rhythm")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "GSR rhythm" })).not.toBeInTheDocument();
  });

  it("gives an admin the rhythm of the people they manage", async () => {
    // Overview reads the rhythm and the current GSR at it; an admin changes it on Setup.
    const user = userEvent.setup();
    const overview = renderPerson(morgan.id, rbaAdmin);
    expect(await screen.findByRole("heading", { name: "This week's GSR" })).toBeInTheDocument();
    expect(screen.getByText("GSR rhythm")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "GSR rhythm" })).not.toBeInTheDocument();
    overview.unmount();

    renderPerson(morgan.id, rbaAdmin, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit GSR rhythm" }));
    const rhythm = screen.getByRole("combobox", { name: "GSR rhythm" });
    expect(rhythm).toHaveValue("weekly");
  });
});

describe("a new GSR period", () => {
  it("computes a week's dates from the rhythm and the day picked, and refuses one already open", async () => {
    const user = userEvent.setup();
    renderWithHub(<CyclesPage section="gsr" />, rbaAdmin);
    // RBA runs monthly and weekly GSRs, so the list groups them by rhythm.
    expect(await screen.findByRole("region", { name: "Weekly" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Monthly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New GSR period" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Rhythm"), "weekly");
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("2026-09-14");
    expect(within(dialog).getByLabelText("Ends")).toHaveValue("2026-09-20");
    expect(within(dialog).getByLabelText("Ends")).toBeDisabled();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Sep 14 to Sep 20, 2026");
    // A week reads the month's focus topic on the review, so the form asks for no theme.
    expect(within(dialog).queryByLabelText("Theme (optional)")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await within(dialog).findByText(/"Sep 14 to Sep 20, 2026" already covers Sep 14 to Sep 20, 2026\. .* open that week instead\./)).toBeInTheDocument();

    // A Wednesday picks its week, Monday to Sunday.
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-09-23" } });
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("2026-09-21");
    expect(within(dialog).getByLabelText("Ends")).toHaveValue("2026-09-27");
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    const created = (await listCycles(RBA.company.id)).find((c) => c.period_start === "2026-09-21")!;
    expect(created).toMatchObject({ kind: "gsr", cadence: "weekly", period_end: "2026-09-27", name: "Sep 21 to Sep 27, 2026", theme: null });
  });

  it("puts two weeks on the shared calendar", async () => {
    const user = userEvent.setup();
    renderWithHub(<CyclesPage section="gsr" />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "New GSR period" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Rhythm"), "biweekly");
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("2026-09-07");
    expect(within(dialog).getByLabelText("Ends")).toHaveValue("2026-09-20");
  });
});

describe("a quarterly review of someone on a weekly rhythm", () => {
  it("averages the weeks locked inside the quarter on the Monthly GSRs line", async () => {
    const pillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 9 });
    onTestFinished(() => deletePillar(pillar.id));
    // Two of Morgan's weeks in Q3, locked at 80 and 60.
    const earlier = await ensureGsrCycle(RBA.company.id, "weekly", new Date(2026, 8, 8));
    const thisWeek = await ensureReview(week.id, RBA.company.id, morgan.id);
    const lastWeek = await ensureReview(earlier.id, RBA.company.id, morgan.id);
    await updateReview(thisWeek.id, { status: "complete", completed_at: new Date().toISOString(), gsr_score: 80 });
    await updateReview(lastWeek.id, { status: "complete", completed_at: new Date().toISOString(), gsr_score: 60 });
    const quarter = await ensureReview(q3.id, RBA.company.id, morgan.id);

    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/reviews/${quarter.id}`, pattern: "/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "The weeks in this period" })).toBeInTheDocument();
    expect(screen.getAllByText("Sep 7 to Sep 13, 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sep 14 to Sep 20, 2026").length).toBeGreaterThan(0);
    // September's monthly GSR is not Morgan's rhythm, so it is not one of his periods.
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
    expect(screen.getByText(/70% across 2 locked-in weeks/)).toBeInTheDocument();
  });
});
