// The GSR screens after the team and division sprint: the hardening fixes (a review in a closed
// cycle stays signed off, a retried sign-off writes one line item, Start all carries on past one
// failure, a complete month freezes without a score) and the manager on a team member's month,
// who works its goals and notes but never locks or signs it off, and the tasks linked to a goal
// from inside the GSR. Each test reads the in-memory data layer the way the page does; the calls a
// test needs to fail are wrapped so it can fail them once.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", async () => {
  const mock = await import("../test/mocks/gsr.ts");
  return { ...mock, updateReview: vi.fn(mock.updateReview), ensureReview: vi.fn(mock.ensureReview) };
});
vi.mock("../services/tasks.ts", async () => {
  const mock = await import("../test/mocks/tasks.ts");
  return { ...mock, notifyAssignment: vi.fn(mock.notifyAssignment) };
});
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import * as profilesService from "../services/profiles.ts";
import * as gsrMock from "../test/mocks/gsr.ts";
import { createGoal, createPillar, createScore, ensureReview, getReview, listReviewScores, updateReview } from "../services/gsr.ts";
import { createTask, listTasksForGoals, notifyAssignment } from "../services/tasks.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import CyclePage from "./gsr/CyclePage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const harper = makeHub("manager", RBA.company);
const rowan = RBA.profiles.find((p) => p.full_name === "Rowan Ellis")!;
const jamie = RBA.profiles[1];
// RBA's September GSR, an open monthly cycle inside its Q3 review.
const september = RBA.cycles.find((c) => c.cadence === "monthly" && c.status === "open")!;
const reviewAt = (id: string) => ({ path: `/gsr/reviews/${id}`, pattern: "/gsr/reviews/:reviewId" });

describe("a signed-off review in a closed cycle", () => {
  it("offers no Reopen, and says the cycle has to reopen first", async () => {
    const closed = RBA.cycles.find((c) => c.status === "closed")!;
    const signedOff = RBA.reviews.find((r) => r.cycle_id === closed.id && r.status === "complete")!;
    renderWithHub(<ReviewPage />, rbaAdmin, reviewAt(signedOff.id));
    expect(await screen.findByText("Reopen the cycle first to reopen this review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen/ })).not.toBeInTheDocument();
  });

  it("is refused by the data layer too", async () => {
    const closed = RBA.cycles.find((c) => c.status === "closed")!;
    const signedOff = RBA.reviews.find((r) => r.cycle_id === closed.id && r.status === "complete")!;
    await expect(updateReview(signedOff.id, { status: "in_progress", completed_at: null })).rejects.toThrow(/Reopen the cycle/);
    expect((await getReview(signedOff.id)).status).toBe("complete");
  });
});

describe("signing off a scored review", () => {
  it("writes one Monthly GSRs line item when a failed sign-off is retried", async () => {
    const user = userEvent.setup();
    const q3 = RBA.cycles[0];
    const open = RBA.reviews.find((r) => r.cycle_id === q3.id && r.status !== "complete")!;
    // The company scores its GSRs, and the person's September month is locked in at 80.
    const pillar = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 9 });
    const month = await ensureReview(september.id, RBA.company.id, open.employee_id);
    await updateReview(month.id, { status: "complete", completed_at: new Date().toISOString(), gsr_score: 80 });

    renderWithHub(<ReviewPage />, rbaAdmin, reviewAt(open.id));
    const markComplete = await screen.findByRole("button", { name: /Mark complete/ });

    // The status flip fails once, after the line item was written.
    vi.mocked(updateReview).mockRejectedValueOnce(new Error("The connection dropped."));
    await user.click(markComplete);
    expect(await screen.findByText("The connection dropped.")).toBeInTheDocument();
    expect((await listReviewScores(open.id)).filter((s) => s.pillar_id === pillar.id && s.criterion_id === null)).toHaveLength(1);

    // The retry updates that row instead of adding a second.
    await user.click(screen.getByRole("button", { name: /Mark complete/ }));
    expect(await screen.findByRole("button", { name: /Reopen/ })).toBeInTheDocument();
    const lines = (await listReviewScores(open.id)).filter((s) => s.pillar_id === pillar.id && s.criterion_id === null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ target: 100, actual: 80 });
  });
});

describe("a complete month with no score", () => {
  it("reads frozen to the person, scored or not", async () => {
    const employee = makeHub("employee");
    const month = KLASIK.reviews.find((r) => r.cycle_id === KLASIK.cycles[0].id && r.employee_id === employee.profile.id)!;
    // Klasik has no Monthly GSRs pillar, so marking the month complete locks no score in.
    await updateReview(month.id, { status: "complete", completed_at: new Date().toISOString() });
    renderWithHub(<ReviewPage />, employee, reviewAt(month.id));
    expect(await screen.findByText("Marked complete")).toBeInTheDocument();
    expect(screen.getByText(/an admin can reopen the review to change them/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^Title for /)).toHaveLength(0);
    expect(screen.queryByText(/your manager can reopen/)).not.toBeInTheDocument();
  });
});

describe("a manager on a team member's month", () => {
  it("works the goals and notes of someone they lead, and never signs it off", async () => {
    const user = userEvent.setup();
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    await createGoal({ company_id: RBA.company.id, employee_id: rowan.id, title: "Walk every site with the crew", kind: "role", scope: "cycle", cycle_id: september.id, sort_order: 1 });
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));

    expect(await screen.findByLabelText("Title for Walk every site with the crew")).toBeEnabled();
    await user.type(screen.getByLabelText("Add a goal for this month"), "Run the Monday toolbox talk{Enter}");
    expect(await screen.findByLabelText("Title for Run the Monday toolbox talk")).toBeInTheDocument();
    expect(screen.getByLabelText("New note for Walk every site with the crew")).toBeInTheDocument();

    // Locking, ratings and sign-off stay with an admin.
    expect(screen.queryByRole("button", { name: /Mark complete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen/ })).not.toBeInTheDocument();
    // Back to the person, never to the cycle page a manager cannot open.
    expect(screen.getByRole("link", { name: /Rowan Ellis/ })).toHaveAttribute("href", `/people/${rowan.id}`);
    expect(screen.queryByText(/your manager/i)).not.toBeInTheDocument();
  });

  it("reads the month of someone outside their team, and goes back to that person", async () => {
    const review = await ensureReview(september.id, RBA.company.id, jamie.id);
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
    // Seen through division access, not led: the back link still returns to the person.
    expect(screen.getByRole("link", { name: /Jamie Fox/ })).toHaveAttribute("href", `/people/${jamie.id}`);
    expect(screen.queryByRole("link", { name: /My GSR/ })).not.toBeInTheDocument();
  });
});

describe("tasks on a monthly goal", () => {
  it("lists the linked tasks, links an open one, adds a new one under the goal, and unlinks", async () => {
    const user = userEvent.setup();
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    const goal = await createGoal({ company_id: RBA.company.id, employee_id: rowan.id, title: "Close out the Harbour punch list", kind: "role", scope: "cycle", cycle_id: september.id, sort_order: 5 });
    const linked = await createTask({ company_id: RBA.company.id, title: "Book the final walk", assignee_id: rowan.id, due_date: "2026-09-24", goal_id: goal.id });
    await createTask({ company_id: RBA.company.id, title: "Order the trim", assignee_id: rowan.id });
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));

    const list = await screen.findByRole("list", { name: `Tasks for ${goal.title}` });
    expect(within(list).getByRole("link", { name: "Book the final walk" })).toHaveAttribute("href", `/tasks/${linked.id}`);
    expect(within(list).getByText(/Open · Due Sep 24, 2026/)).toBeInTheDocument();

    // Link one of the person's open tasks.
    await user.click(screen.getByRole("button", { name: `Link a task to ${goal.title}` }));
    const picker = await screen.findByLabelText(`Task to link to ${goal.title}`);
    await user.selectOptions(picker, within(picker).getByRole("option", { name: "Order the trim" }));
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(await within(list).findByRole("link", { name: "Order the trim" })).toBeInTheDocument();

    // A new task lands on the goal, for the goal's person, and asks for the assignment email.
    await user.click(screen.getByRole("button", { name: `New task for ${goal.title}` }));
    await user.type(await screen.findByLabelText("Title"), "Photograph the finished trim");
    // The form says whose task it is and which goal, with no picker to show it.
    expect(within(screen.getByRole("dialog")).getByText("For Rowan Ellis")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(`Linked to ${goal.title}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(await within(list).findByRole("link", { name: "Photograph the finished trim" })).toBeInTheDocument();
    const onGoal = await listTasksForGoals(RBA.company.id, [goal.id]);
    expect(onGoal.find((t) => t.title === "Photograph the finished trim")).toMatchObject({ assignee_id: rowan.id, goal_id: goal.id });
    await waitFor(() => expect(notifyAssignment).toHaveBeenCalled());

    // Unlinking takes it off the goal and leaves the task.
    await user.click(within(list).getByRole("button", { name: "Unlink Book the final walk" }));
    await waitFor(() => expect(within(list).queryByRole("link", { name: "Book the final walk" })).not.toBeInTheDocument());
    expect((await listTasksForGoals(RBA.company.id, [goal.id])).map((t) => t.title)).not.toContain("Book the final walk");
  });

  it("reads only once the month is complete", async () => {
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString() });
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));
    const list = await screen.findByRole("list", { name: "Tasks for Close out the Harbour punch list" });
    expect(within(list).getByRole("link", { name: "Order the trim" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /^Unlink/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Link a task/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^New task/ })).not.toBeInTheDocument();
  });
});

describe("Start all on a cycle", () => {
  it("carries on past one failure, names it, and shows everyone else started", async () => {
    const user = userEvent.setup();
    const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;
    vi.mocked(ensureReview).mockImplementation(async (cycleId, companyId, employeeId) => {
      if (employeeId === kai.id) throw new Error("That already exists.");
      return gsrMock.ensureReview(cycleId, companyId, employeeId);
    });
    renderWithHub(<CyclePage />, rbaAdmin, { path: `/gsr/cycles/${september.id}`, pattern: "/gsr/cycles/:cycleId" });
    const startAll = await screen.findByRole("button", { name: /Start all \d+ reviews/ });
    const tried = Number(/Start all (\d+)/.exec(startAll.textContent ?? "")![1]);
    expect(tried).toBeGreaterThan(1);
    await user.click(startAll);
    expect(await screen.findByText(new RegExp(`1 GSR of ${tried} did not start; the rest did`))).toBeInTheDocument();
    expect(screen.getByText(/Kai Bennett: That already exists\./)).toBeInTheDocument();
    // The page reloaded: only Kai is left to start.
    expect(await screen.findByRole("button", { name: "Start all 1 reviews" })).toBeInTheDocument();
    vi.mocked(ensureReview).mockImplementation(gsrMock.ensureReview);
  });

  it("starts nothing in a closed cycle, and says why", async () => {
    const closed = RBA.cycles.find((c) => c.status === "closed")!;
    renderWithHub(<CyclePage />, rbaAdmin, { path: `/gsr/cycles/${closed.id}`, pattern: "/gsr/cycles/:cycleId" });
    expect(await screen.findByText(/is closed, so nothing new starts in it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
  });

  it("asks before closing, with how many are not complete", async () => {
    const user = userEvent.setup();
    renderWithHub(<CyclePage />, rbaAdmin, { path: `/gsr/cycles/${september.id}`, pattern: "/gsr/cycles/:cycleId" });
    await user.click(await screen.findByRole("button", { name: /Close cycle/ }));
    const dialog = (await screen.findByRole("heading", { name: `Close ${september.name}?` })).closest("[role=dialog]") as HTMLElement;
    expect(within(dialog).getByText(/are not complete/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /Close cycle/ })).toBeInTheDocument();
  });
});

// These run last: they start GSRs and sign off reviews that the counts above do not expect.
describe("a manager over a manager", () => {
  // Harper (manager) > Rowan, made a manager here > Kai (employee): what the database shows Harper
  // once the managers in her chain are visible to her.
  function rowanManages() {
    const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;
    const team = [harper.profile.id, rowan.id, kai.id];
    const original = profilesService.listCompanyProfiles;
    const spy = vi.spyOn(profilesService, "listCompanyProfiles").mockImplementation(async (companyId) =>
      (await original(companyId)).filter((p) => team.includes(p.id)).map((p) => (p.id === rowan.id ? { ...p, role: "manager" as const } : p)),
    );
    onTestFinished(() => spy.mockRestore());
    return kai;
  }

  it("works the goals of the employee two levels down, through the manager between them", async () => {
    const kai = rowanManages();
    const review = await ensureReview(september.id, RBA.company.id, kai.id);
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));
    expect(await screen.findByLabelText("Add a goal for this month")).toBeInTheDocument();
  });

  it("reads the month of the manager under her without working it", async () => {
    rowanManages();
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    renderWithHub(<ReviewPage />, harper, reviewAt(review.id));
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
  });
});

describe("who signed off a review", () => {
  const q3 = RBA.cycles[0];

  it("reads neutrally when the reviewer is no longer in the company's directory", async () => {
    const review = RBA.reviews.find((r) => r.cycle_id === q3.id && r.status !== "complete" && r.employee_id !== rowan.id)!;
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: "someone-moved-away" });
    renderWithHub(<ReviewPage />, rbaAdmin, reviewAt(review.id));
    expect(await screen.findByText(/by someone no longer listed/)).toBeInTheDocument();
    expect(screen.queryByText(/by Rococo/)).not.toBeInTheDocument();
  });

  it("says Rococo to the Rococo admin who signed it off", async () => {
    const rococo = makeHub("rococo", RBA.company);
    const review = RBA.reviews.find((r) => r.cycle_id === q3.id && r.employee_id === rowan.id) ?? (await ensureReview(q3.id, RBA.company.id, rowan.id));
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: rococo.profile.id });
    renderWithHub(<ReviewPage />, rococo, reviewAt(review.id));
    expect(await screen.findByText(/by Rococo/)).toBeInTheDocument();
  });
});

describe("a line item's target and actual", () => {
  it("refuses text that is not a figure, rather than saving it as a blank", async () => {
    const user = userEvent.setup();
    const q3 = RBA.cycles[0];
    const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;
    const pillar = await createPillar({ company_id: RBA.company.id, name: "Projects delivered", weight: 10, scoring_type: "deliverables", sort_order: 10 });
    const review = await ensureReview(q3.id, RBA.company.id, kai.id);
    const item = await createScore({ review_id: review.id, company_id: RBA.company.id, pillar_id: pillar.id, label: "Kitchens finished", target: 10, actual: 8, sort_order: 0 });
    renderWithHub(<ReviewPage />, rbaAdmin, reviewAt(review.id));
    const target = await screen.findByDisplayValue("10");
    await user.clear(target);
    await user.type(target, "12k");
    await user.tab();
    expect(await screen.findByText("Enter the target as a number, like 100.")).toBeInTheDocument();
    const actual = screen.getByDisplayValue("8");
    await user.clear(actual);
    await user.type(actual, "n/a");
    await user.tab();
    expect(await screen.findByText("Enter the actual as a number, like 100.")).toBeInTheDocument();
    const stored = (await listReviewScores(review.id)).find((s) => s.id === item.id)!;
    expect(stored).toMatchObject({ target: 10, actual: 8 });
  });
});
