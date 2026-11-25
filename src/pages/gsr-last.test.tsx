// The last GSR, pulled into the page of the new one: whatever the gap and whatever its state, so the
// two people in the meeting can talk it through while they set the new one. Those who may close it
// mark it done from there with the page's own confirm; the person sees it and works its goals while
// it is open, and never closes it. An unfinished goal carries forward into the new GSR once. Each
// test reads the in-memory data layer the way the page does, acting as the person the hub was
// rendered for.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
// listGoals is wrapped so one test can hold a read open; it reads the mock as ever otherwise.
vi.mock("../services/gsr.ts", async () => {
  const mock = await import("../test/mocks/gsr.ts");
  return { ...mock, listGoals: vi.fn(mock.listGoals) };
});
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

import type { HubValue } from "../context/HubContext.tsx";
import { createGoal, createGoalNote, createPillar, deletePillar, listGoals } from "../services/gsr.ts";
import { OWN_GSR_MESSAGE, getGsr, markGsrDone, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import { RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import type { Goal, Gsr, Profile } from "../types/database.ts";
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

const renderGsr = (gsr: Gsr, hub: HubValue) => renderWithHub(<GsrPage />, hub, { path: `/gsr/reviews/${gsr.id}`, pattern: "/gsr/reviews/:reviewId" });
const panel = async () => (await screen.findByRole("heading", { name: "Last GSR" })).closest("section") as HTMLElement;

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-09-15", status: "in_progress", ...row });
}
async function goal(gsr: Gsr, title: string, progress: number): Promise<Goal> {
  return createGoal({ company_id: gsr.company_id, employee_id: gsr.employee_id, title, kind: "professional", scope: "cycle", cycle_id: null, review_id: gsr.id, progress, status: progress >= 100 ? "achieved" : "in_progress" });
}
// Marks a GSR done before the page is rendered, as someone who may.
async function markDone(gsr: Gsr, by: Profile, score: number | null): Promise<Gsr> {
  setActingPerson(by);
  return markGsrDone(gsr.id, score, by.id);
}
// What the database says to a change on a done GSR's goals (0047).
const GSR_DONE_GOALS = "This GSR is done. Reopen it to change its goals.";
// Moves a completion slider and lets it go, which commits the value.
function slide(slider: HTMLElement, value: number) {
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.keyUp(slider);
}
// A Monthly GSRs pillar asking two goals of every GSR, gone after the test.
async function scoresGsrs() {
  const pillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 0, scoring_type: "gsr_goals", required_goals: 2 });
  onTestFinished(() => deletePillar(pillar.id));
}

beforeEach(() => {
  setMockGsrMode(RBA.company.id, "on_demand");
});

describe("the last GSR inside the new one", () => {
  it("pulls in the last GSR whatever the gap", async () => {
    const last = seed(rowan.id, { started_on: "2026-06-02" });
    const walk = await goal(last, "Walk every site on Fridays", 60);
    await createGoalNote({ goal_id: walk.id, company_id: walk.company_id, employee_id: walk.employee_id, author_id: harper.id, body: "Missed two Fridays in the rain" });
    const current = seed(rowan.id, { started_on: "2026-09-15" });
    renderGsr(current, manager);
    const box = await panel();
    expect(within(box).getByText("Started Jun 2, 2026")).toBeInTheDocument();
    expect(within(box).getByText("In progress")).toBeInTheDocument();
    expect(within(box).getByText("Walk every site on Fridays")).toBeInTheDocument();
    // Its notes, read only.
    expect(await within(box).findByText("Missed two Fridays in the rain")).toBeInTheDocument();
    expect(within(box).queryByRole("textbox", { name: "New note for Walk every site on Fridays" })).not.toBeInTheDocument();
    // Worded for a GSR, which has no month and is never signed off.
    expect(within(box).queryByText(/month|review|signed off/i)).not.toBeInTheDocument();
  });

  it("closes the last GSR from inside the new one", async () => {
    await scoresGsrs();
    const last = seed(rowan.id, { started_on: "2026-08-03" });
    await goal(last, "Walk every site on Fridays", 50);
    await goal(last, "Finish the estimating course", 30);
    const current = seed(rowan.id);
    renderGsr(current, manager);
    const box = await panel();
    await userEvent.click(within(box).getByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark this GSR done at 40%?" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The panel reads Done with its date and score, and the page's own GSR is still open.
    expect(await within(box).findByText(/^Done /)).toBeInTheDocument();
    expect(within(box).getByText("40%")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "GSR · Sep 15, 2026" })).toBeInTheDocument();
    expect(screen.getAllByText("In progress")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(await getGsr(last.id)).toMatchObject({ status: "complete", gsr_score: 40, reviewer_id: harper.id });
    expect((await getGsr(current.id)).status).toBe("in_progress");
  });

  it("lets the person see their last GSR and gives them no way to close it", async () => {
    const last = seed(jamie.id, { started_on: "2026-08-03" });
    await goal(last, "Learn the takeoff software", 40);
    const current = seed(jamie.id);
    renderGsr(current, employee);
    const box = await panel();
    expect(within(box).getByText("Learn the takeoff software")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    // While it is open, its goals' completion is theirs to work, as on its own page.
    const slider = within(box).getByRole("slider", { name: "Agreed completion for Learn the takeoff software on the last GSR" });
    expect(slider).toBeEnabled();
  });

  it("shows the person a done last GSR read only", async () => {
    const last = seed(jamie.id, { started_on: "2026-08-03" });
    await goal(last, "Learn the takeoff software", 40);
    await markDone(last, alex, null);
    const current = seed(jamie.id);
    renderGsr(current, employee);
    const box = await panel();
    expect(within(box).getByText(/^Done /)).toBeInTheDocument();
    expect(within(box).getByText("Learn the takeoff software")).toBeInTheDocument();
    expect(within(box).queryByRole("slider")).not.toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("carries an unfinished goal forward once", async () => {
    const last = seed(rowan.id, { started_on: "2026-08-03" });
    await goal(last, "Walk every site on Fridays", 100);
    const course = await goal(last, "Finish the estimating course", 60);
    await markDone(last, harper, 80);
    const current = seed(rowan.id);
    const { unmount } = renderGsr(current, manager);
    const box = await panel();
    // A goal at 100 has nothing to carry.
    expect(within(box).queryByRole("button", { name: "Carry forward Walk every site on Fridays" })).not.toBeInTheDocument();
    await userEvent.click(within(box).getByRole("button", { name: "Carry forward Finish the estimating course" }));
    expect(await within(box).findByText("Carried forward")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: /^Carry forward/ })).not.toBeInTheDocument();
    // It lands on the new GSR's goals.
    expect(await screen.findByRole("textbox", { name: "Title for Finish the estimating course" })).toBeInTheDocument();
    const carried = (await listGoals(RBA.company.id, rowan.id)).filter((g) => g.carried_from_goal_id === course.id);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ review_id: current.id, cycle_id: null, title: "Finish the estimating course" });
    unmount();

    // Read from the goals on record, so a reload says the same.
    renderGsr(current, manager);
    const again = await panel();
    expect(within(again).getByText("Carried forward")).toBeInTheDocument();
    expect(within(again).queryByRole("button", { name: /^Carry forward/ })).not.toBeInTheDocument();
  });

  it("says there is no earlier GSR on a first one", async () => {
    renderGsr(seed(rowan.id), manager);
    const box = await panel();
    expect(within(box).getByText("No earlier GSR yet.")).toBeInTheDocument();
  });

  it("shows the last GSR to someone opening a done GSR", async () => {
    const last = seed(rowan.id, { started_on: "2026-08-03" });
    await goal(last, "Finish the estimating course", 60);
    await goal(last, "Walk every site on Fridays", 100);
    await markDone(last, harper, 55);
    const current = seed(rowan.id);
    await markDone(current, harper, 70);
    renderGsr(current, admin);
    const box = await panel();
    expect(within(box).getByText("Started Aug 3, 2026")).toBeInTheDocument();
    expect(within(box).getByText("Finish the estimating course")).toBeInTheDocument();
    expect(within(box).getByText("55%")).toBeInTheDocument();
    // A finished goal reads as the monthly page reads it, an unfinished one as missed.
    expect(within(box).getByText("Hit")).toBeInTheDocument();
    expect(within(box).getByText("Missed at 60%")).toBeInTheDocument();
    // Nothing carries into a done GSR, and a done last GSR is read only.
    expect(within(box).queryByRole("button", { name: /^Carry forward/ })).not.toBeInTheDocument();
    expect(within(box).queryByRole("slider")).not.toBeInTheDocument();
  });

  it("keeps Mark done in the panel away from an admin whose own GSR it is", async () => {
    const last = seed(alex.id, { started_on: "2026-08-03" });
    await goal(last, "Hire a second estimator", 50);
    renderGsr(seed(alex.id), admin);
    const box = await panel();
    expect(within(box).getByText("Hire a second estimator")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("says a refused Mark done inside the panel's dialog", async () => {
    const last = seed(rowan.id, { started_on: "2026-08-03" });
    renderGsr(seed(rowan.id), manager);
    const box = await panel();
    await userEvent.click(within(box).getByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    // The write reaches the database as Rowan himself, which it refuses.
    onTestFinished(() => setActingPerson(harper));
    setActingPerson(rowan);
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark done" }));
    expect(await within(dialog).findByText(OWN_GSR_MESSAGE)).toBeInTheDocument();
    setActingPerson(harper);
    expect((await getGsr(last.id)).status).toBe("in_progress");
  });

  it("saves a completion changed in the panel to the last GSR's goal", async () => {
    const last = seed(jamie.id, { started_on: "2026-08-03" });
    const course = await goal(last, "Learn the takeoff software", 40);
    renderGsr(seed(jamie.id), employee);
    const box = await panel();
    slide(within(box).getByRole("slider", { name: "Agreed completion for Learn the takeoff software on the last GSR" }), 70);
    await waitFor(async () => expect((await listGoals(RBA.company.id, jamie.id)).find((g) => g.id === course.id)?.progress).toBe(70));
    expect(within(box).getByText("70%")).toBeInTheDocument();
  });

  it("says a refused completion and leaves the value as it was", async () => {
    const last = seed(jamie.id, { started_on: "2026-08-03" });
    const course = await goal(last, "Learn the takeoff software", 40);
    renderGsr(seed(jamie.id), employee);
    const box = await panel();
    const slider = within(box).getByRole("slider", { name: "Agreed completion for Learn the takeoff software on the last GSR" });
    // Someone who leads Jamie marks the last GSR done in another window, which freezes its goals.
    await markDone(last, alex, null);
    onTestFinished(() => setActingPerson(jamie));
    setActingPerson(jamie);
    slide(slider, 70);
    expect(await screen.findByText(GSR_DONE_GOALS)).toBeInTheDocument();
    await waitFor(() => expect(slider).toHaveValue("40"));
    expect(within(box).getByText("Not saved")).toBeInTheDocument();
    expect((await listGoals(RBA.company.id, jamie.id)).find((g) => g.id === course.id)?.progress).toBe(40);
  });

  it("keeps Carried forward on a goal raised to 100 after it was carried", async () => {
    const last = seed(rowan.id, { started_on: "2026-08-03" });
    await goal(last, "Finish the estimating course", 60);
    renderGsr(seed(rowan.id), manager);
    const box = await panel();
    await userEvent.click(within(box).getByRole("button", { name: "Carry forward Finish the estimating course" }));
    expect(await within(box).findByText("Carried forward")).toBeInTheDocument();
    slide(within(box).getByRole("slider", { name: "Agreed completion for Finish the estimating course on the last GSR" }), 100);
    await waitFor(() => expect(within(box).getByText("Complete")).toBeInTheDocument());
    expect(within(box).getByText("Carried forward")).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: /^Carry forward/ })).not.toBeInTheDocument();
  });

  it("holds Delete GSR still while Mark done reads the goals again", async () => {
    renderGsr(seed(rowan.id), admin);
    const markDoneButton = await screen.findByRole("button", { name: "Mark done" });
    let release: () => void = () => undefined;
    const read = vi.mocked(listGoals);
    read.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return (await vi.importActual<typeof import("../test/mocks/gsr.ts")>("../test/mocks/gsr.ts")).listGoals(...args);
    });
    await userEvent.click(markDoneButton);
    expect(screen.getByRole("button", { name: "Delete GSR" })).toBeDisabled();
    release();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete GSR" })).toBeEnabled();
  });
});
