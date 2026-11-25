// The page for one GSR in a company on demand: its goals, the focus topic of the month it began in,
// who may mark it done or reopen it (those who lead the person and admins, never the person
// themself), the score it locks, deleting it (an admin, or someone who leads the person), the
// company wall, and that a company on periods keeps the monthly review page at the same address.
// Each test reads the in-memory data layer the way the page does, acting as the person the hub was
// rendered for.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/sopCategories.ts", () => import("../test/mocks/sopCategories.ts"));
vi.mock("../services/sopSignoffs.ts", () => import("../test/mocks/sopSignoffs.ts"));
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
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import App from "../App.tsx";
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { createGoal, createPillar, deletePillar, listGoals } from "../services/gsr.ts";
import { deleteFocusTopic, upsertFocusTopic } from "../services/focusTopics.ts";
import { OWN_DONE_DELETE_MESSAGE, OWN_GSR_MESSAGE, deleteGsr, listPersonGsrs, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import { NOT_CHANGED_MESSAGE, errorMessage } from "../lib/errors.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import type { Gsr } from "../types/database.ts";
import GsrPage from "./gsr/GsrPage.tsx";

const onDemand = { ...RBA.company, gsr_mode: "on_demand" as const };
const admin = makeHub("admin", onDemand);
const manager = makeHub("manager", onDemand);
const employee = makeHub("employee", onDemand);
const alex = admin.profile;
const jamie = employee.profile;
const harper = manager.profile;
// Rowan reports to Harper.
const rowan = RBA.profiles.find((p) => p.full_name === "Rowan Ellis")!;

const at = (gsr: Gsr) => ({ path: `/gsr/reviews/${gsr.id}`, pattern: "/gsr/reviews/:reviewId" });
const renderGsr = (gsr: Gsr, hub: HubValue) => renderWithHub(<GsrPage />, hub, at(gsr));
const title = async (text: string | RegExp) => screen.findByRole("heading", { level: 1, name: text });

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-09-14", status: "in_progress", ...row });
}
async function goal(gsr: Gsr, title: string, progress: number, extra: { is_focus?: boolean } = {}) {
  return createGoal({ company_id: gsr.company_id, employee_id: gsr.employee_id, title, kind: "role", scope: "cycle", cycle_id: null, review_id: gsr.id, progress, ...extra });
}
// A Monthly GSRs pillar asking two goals of every GSR, gone after the test.
async function scoresGsrs() {
  const pillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 0, scoring_type: "gsr_goals", required_goals: 2 });
  onTestFinished(() => deletePillar(pillar.id));
}

beforeEach(() => {
  setMockGsrMode(RBA.company.id, "on_demand");
});

describe("one GSR's page", () => {
  it("shows an open GSR with its goals and the focus topic of the month it was started in", async () => {
    const august = await upsertFocusTopic(RBA.company.id, "2026-08-01", "Clean sites", "A site you would show a client, every day.");
    const september = await upsertFocusTopic(RBA.company.id, "2026-09-01", "Change orders", null);
    onTestFinished(async () => {
      await deleteFocusTopic(august.id);
      await deleteFocusTopic(september.id);
    });
    const gsr = seed(rowan.id, { started_on: "2026-08-28" });
    await goal(gsr, "Walk every site on Fridays", 40);
    renderGsr(gsr, manager);
    expect(await title("GSR · Aug 28, 2026")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(await screen.findByText("Clean sites")).toBeInTheDocument();
    expect(screen.queryByText("Change orders")).not.toBeInTheDocument();
    // Worded for a GSR, which has no month of its own.
    await userEvent.click(screen.getByRole("button", { name: "Set their GSR based on this focus topic" }));
    expect(screen.getByPlaceholderText("What will they do on this topic?")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title for Walk every site on Fridays" })).toBeInTheDocument();
    // Whose GSR it is, in the header, with the way back to their GSRs.
    expect(screen.getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}/gsr`);
  });

  it("adds a goal to the GSR, not to a cycle", async () => {
    const gsr = seed(rowan.id);
    renderGsr(gsr, admin);
    const box = await screen.findByRole("textbox", { name: "Add a goal for this GSR" });
    await userEvent.type(box, "Close out the punch list{Enter}");
    await screen.findByRole("textbox", { name: "Title for Close out the punch list" });
    const created = (await listGoals(RBA.company.id, rowan.id)).find((g) => g.title === "Close out the punch list")!;
    expect(created.review_id).toBe(gsr.id);
    expect(created.cycle_id).toBeNull();
    expect(created.scope).toBe("cycle");
  });

  it("lets a manager mark a report's GSR done and shows the score it locked", async () => {
    await scoresGsrs();
    const gsr = seed(rowan.id);
    await goal(gsr, "Walk every site on Fridays", 50);
    await goal(gsr, "Finish the estimating course", 30);
    renderGsr(gsr, manager);
    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark this GSR done at 40%?" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/^Done /)).toBeInTheDocument();
    expect(screen.getByText("40% · Marked done by Harper Quinn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    const [stored] = await listPersonGsrs(RBA.company.id, rowan.id);
    expect(stored).toMatchObject({ status: "complete", gsr_score: 40, reviewer_id: harper.id });
  });

  it("gives the person no Mark done and says their manager does it", async () => {
    const gsr = seed(jamie.id);
    renderGsr(gsr, employee);
    expect(await screen.findByText("Your manager marks this GSR done.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    // Their own GSR is still theirs to work.
    expect(screen.getByRole("textbox", { name: "Add a goal for this GSR" })).toBeInTheDocument();
  });

  it("keeps the opening discussion the person writes on their own GSR", async () => {
    const gsr = seed(jamie.id);
    renderGsr(gsr, employee);
    const box = await screen.findByRole("textbox", { name: "What would help you do your job better?" });
    await userEvent.type(box, "A second laptop on site");
    await userEvent.tab();
    await waitFor(async () => expect((await listPersonGsrs(RBA.company.id, jamie.id))[0].support_discussion).toBe("A second laptop on site"));
  });

  it("words the focus topic field for the person's own GSR without a month", async () => {
    const topic = await upsertFocusTopic(RBA.company.id, "2026-09-01", "Change orders", null);
    onTestFinished(() => deleteFocusTopic(topic.id));
    renderGsr(seed(jamie.id), employee);
    await userEvent.click(await screen.findByRole("button", { name: "Set your GSR based on this focus topic" }));
    expect(screen.getByPlaceholderText("What will you do on this topic?")).toBeInTheDocument();
    // The goals say nothing of a month ("Performance this month" below tracks a real one).
    const goals = screen.getByRole("heading", { name: "Goals for this GSR" }).closest("section") as HTMLElement;
    expect(within(goals).queryByText(/month/i)).not.toBeInTheDocument();
  });

  it("does not let an admin mark their own GSR done", async () => {
    const gsr = seed(alex.id);
    renderGsr(gsr, admin);
    expect(await screen.findByText("Your manager marks this GSR done.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("reopens a done GSR for a manager and never for the person", async () => {
    const done = seed(rowan.id, { status: "complete", done_on: "2026-09-14", completed_at: "2026-09-14T15:00:00.000Z", gsr_score: 72, reviewer_id: harper.id });
    const { unmount } = renderGsr(done, manager);
    expect(await screen.findByText(/^Done /)).toBeInTheDocument();
    // Marked done, never signed off.
    expect(screen.getByText("As it was discussed when this GSR was marked done.")).toBeInTheDocument();
    expect(screen.queryByText(/signed off/)).not.toBeInTheDocument();
    // A done GSR is read only.
    expect(screen.queryByRole("textbox", { name: "Add a goal for this GSR" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a goal for this GSR" })).toBeInTheDocument();
    unmount();
    setActingPerson(null);

    const theirs = seed(jamie.id, { status: "complete", done_on: "2026-09-14", completed_at: "2026-09-14T15:00:00.000Z", gsr_score: 80, reviewer_id: alex.id });
    renderGsr(theirs, employee);
    expect(await screen.findByText(/^Done /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("marks done with no score in a company that does not score GSRs", async () => {
    const gsr = seed(rowan.id);
    await goal(gsr, "Walk every site on Fridays", 50);
    renderGsr(gsr, admin);
    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark this GSR done?" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    expect(await screen.findByText(/^Done /)).toBeInTheDocument();
    expect(screen.getByText("Marked done by Alex Morgan")).toBeInTheDocument();
    expect(screen.queryByText(/% · Marked done by/)).not.toBeInTheDocument();
    const [stored] = await listPersonGsrs(RBA.company.id, rowan.id);
    expect(stored).toMatchObject({ status: "complete", gsr_score: null, reviewer_id: alex.id });
  });

  it("reads a not-started GSR as In progress", async () => {
    renderGsr(seed(rowan.id, { status: "not_started" }), admin);
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });

  it("shows a done GSR's stored score even when nobody is on file as marking it done", async () => {
    renderGsr(seed(rowan.id, { status: "complete", done_on: "2026-08-31", completed_at: "2026-08-31T15:00:00.000Z", gsr_score: 65, reviewer_id: null }), admin);
    expect(await screen.findByText("Done Aug 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.queryByText(/Marked done by/)).not.toBeInTheDocument();
  });

  it("says a refused Mark done inside the dialog", async () => {
    const gsr = seed(rowan.id);
    renderGsr(gsr, manager);
    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    // The write reaches the database as Rowan himself, which it refuses.
    onTestFinished(() => setActingPerson(manager.profile));
    setActingPerson(rowan);
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    expect(await within(dialog).findByText(OWN_GSR_MESSAGE)).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, rowan.id))[0].status).toBe("in_progress");
  });

  it("shows a manager who is not an admin the opening discussion read only on a report's GSR", async () => {
    renderGsr(seed(rowan.id, { support_discussion: "A second truck" }), manager);
    expect(await screen.findByText("A second truck")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "What would help you do your job better?" })).not.toBeInTheDocument();
  });

  it("offers an admin Delete GSR on their own GSR while it is open, and not once it is done", async () => {
    const { unmount } = renderGsr(seed(alex.id), admin);
    expect(await screen.findByRole("button", { name: "Delete GSR" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    unmount();
    renderGsr(seed(alex.id, { started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70, reviewer_id: harper.id }), admin);
    await title(/^GSR · /);
    expect(screen.queryByRole("button", { name: "Delete GSR" })).not.toBeInTheDocument();
  });

  it("still offers an admin Delete GSR on someone else's done GSR, and says why their own stays", async () => {
    const done = seed(rowan.id, { started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70, reviewer_id: alex.id });
    renderGsr(done, admin);
    expect(await screen.findByRole("button", { name: "Delete GSR" })).toBeInTheDocument();
    // The database's refusal of one's own done GSR reads as written, never as a raw error.
    expect(errorMessage(new Error(OWN_DONE_DELETE_MESSAGE))).toBe("Your own GSR stays once it is done. Someone who leads you can delete it.");
  });

  it("lets an admin delete a GSR after a confirm, and offers it to nobody else but those who lead the person", async () => {
    const gsr = seed(rowan.id);
    await goal(gsr, "Walk every site on Fridays", 50);
    const { unmount } = renderGsr(gsr, manager);
    await title(/^GSR · /);
    expect(screen.getByRole("button", { name: "Delete GSR" })).toBeInTheDocument();
    unmount();
    const own = seed(jamie.id);
    const second = renderGsr(own, employee);
    await title(/^GSR · /);
    expect(screen.queryByRole("button", { name: "Delete GSR" })).not.toBeInTheDocument();
    second.unmount();

    setActingPerson(admin.profile);
    render(
      <HubContext value={admin}>
        <MemoryRouter initialEntries={[`/gsr/reviews/${gsr.id}`]}>
          <Routes>
            <Route path="/gsr/reviews/:reviewId" element={<GsrPage />} />
            <Route path="/people/:profileId/gsr" element={<div>The person's GSRs</div>} />
          </Routes>
        </MemoryRouter>
      </HubContext>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete GSR" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Delete this GSR and its goals?" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete GSR" }));
    expect(await screen.findByText("The person's GSRs")).toBeInTheDocument();
    expect(await listPersonGsrs(RBA.company.id, rowan.id)).toEqual([]);
    expect((await listGoals(RBA.company.id, rowan.id)).some((g) => g.review_id === gsr.id)).toBe(false);
  });

  it("lets a manager who leads the person delete their GSR, done or open, after a confirm", async () => {
    const done = seed(rowan.id, { started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70, reviewer_id: harper.id });
    const gsr = seed(rowan.id);
    await goal(gsr, "Walk every site on Fridays", 50);
    const first = renderGsr(done, manager);
    expect(await screen.findByRole("button", { name: "Delete GSR" })).toBeInTheDocument();
    first.unmount();

    setActingPerson(manager.profile);
    render(
      <HubContext value={manager}>
        <MemoryRouter initialEntries={[`/gsr/reviews/${gsr.id}`]}>
          <Routes>
            <Route path="/gsr/reviews/:reviewId" element={<GsrPage />} />
            <Route path="/people/:profileId/gsr" element={<div>The person's GSRs</div>} />
          </Routes>
        </MemoryRouter>
      </HubContext>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete GSR" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete GSR" }));
    expect(await screen.findByText("The person's GSRs")).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, rowan.id)).map((g) => g.id)).toEqual([done.id]);
    expect((await listGoals(RBA.company.id, rowan.id)).some((g) => g.review_id === gsr.id)).toBe(false);
  });

  it("offers Delete GSR to no manager who does not lead the person, and to no employee", async () => {
    // Harper leads Rowan and Kai, not Jamie, so Jamie's GSR is not hers to read or delete.
    const theirs = seed(jamie.id);
    const { unmount } = renderGsr(theirs, manager);
    expect(await screen.findByText("Review not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete GSR" })).not.toBeInTheDocument();
    await expect(deleteGsr(theirs.id)).rejects.toThrow(NOT_CHANGED_MESSAGE);
    unmount();
    // The employee on their own GSR, open and done.
    setActingPerson(null);
    const second = renderGsr(theirs, employee);
    await title(/^GSR · /);
    expect(screen.queryByRole("button", { name: "Delete GSR" })).not.toBeInTheDocument();
    second.unmount();
    renderGsr(seed(jamie.id, { started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70, reviewer_id: alex.id }), employee);
    await title(/^GSR · /);
    expect(screen.queryByRole("button", { name: "Delete GSR" })).not.toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, jamie.id))).toHaveLength(2);
  });

  it("says a GSR from another company is not here", async () => {
    setMockGsrMode(KINGDOM.company.id, "on_demand");
    const gsr = seed(rowan.id);
    const inRba = makeHub("rococo", onDemand);
    const inKingdom = makeHub("rococo", { ...KINGDOM.company, gsr_mode: "on_demand" });
    const tree = (hub: HubValue): ReactElement => (
      <HubContext value={hub}>
        <MemoryRouter initialEntries={[`/gsr/reviews/${gsr.id}`]}>
          <Routes>
            <Route path="/gsr/reviews/:reviewId" element={<GsrPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext>
    );
    setActingPerson(inRba.profile);
    const { rerender } = render(tree(inRba));
    expect(await title(/^GSR · /)).toBeInTheDocument();
    // The sidebar switcher changes company without navigating.
    rerender(tree(inKingdom));
    expect(await screen.findByText("That GSR is not in this company.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /^GSR · / })).not.toBeInTheDocument();
  });
});

describe("the same address in a company on periods", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("keeps the monthly page for a company on periods", async () => {
    const monthly = KLASIK.reviews.find((r) => r.status !== "complete" && KLASIK.cycles.find((c) => c.id === r.cycle_id)?.cadence === "monthly")!;
    window.history.pushState({}, "", `/gsr/reviews/${monthly.id}?persona=admin&company=${KLASIK.company.slug}`);
    render(<App />);
    expect(await screen.findByRole("button", { name: "Mark complete" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/^Goal Setting Review · /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /^GSR · / })).not.toBeInTheDocument();
  });

  it("opens a GSR's own page at that address once the company is on demand", async () => {
    const gsr = seed(rowan.id);
    window.history.pushState({}, "", `/gsr/reviews/${gsr.id}?persona=admin&company=${RBA.company.slug}`);
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "GSR · Sep 14, 2026" }, { timeout: 4000 })).toBeInTheDocument();
  });
});
