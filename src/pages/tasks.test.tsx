// The Tasks module's pages against the mocked data layer: what an employee and an admin each see,
// adding a task, the assignment email and what happens when it fails, and one task's own page with
// its steps, completion, the lock on a finished repeat, editing and deleting. Same mock block as
// pages.test.tsx plus the tasks service, so no test here reaches the network.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import * as tasksService from "../services/tasks.ts";
import { KINGDOM, RBA, makeHub } from "../test/fixtures.ts";
import TaskPage from "./tasks/TaskPage.tsx";
import TasksPage from "./tasks/TasksPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const kingdomEmployee = makeHub("employee", KINGDOM.company);
const jamie = RBA.profiles[1];
const noor = RBA.profiles[2];

function renderMine(hub = rbaEmployee) {
  return renderWithHub(<TasksPage tab="mine" />, hub, { path: "/tasks", pattern: "/tasks" });
}
function renderEveryone() {
  return renderWithHub(<TasksPage tab="everyone" />, rbaAdmin, { path: "/tasks/everyone", pattern: "/tasks/everyone" });
}
function renderTask(id: string, hub = rbaEmployee) {
  return renderWithHub(<TaskPage />, hub, { path: `/tasks/${id}`, pattern: "/tasks/:taskId" });
}
// The step titles in the order the checklist shows them.
function stepTitles(): string[] {
  return screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label") ?? "");
}
// The row a task's title sits in, so a check reads only that row.
function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}
function spyNotify() {
  const spy = vi.spyOn(tasksService, "notifyAssignment");
  onTestFinished(() => spy.mockRestore());
  return spy;
}
function spyCreate() {
  const spy = vi.spyOn(tasksService, "createTask");
  onTestFinished(() => spy.mockRestore());
  return spy;
}
function idFromRow(title: string): string {
  const href = rowOf(title).querySelector("a")?.getAttribute("href") ?? "";
  return href.replace("/tasks/", "");
}

describe("tasks: Mine", () => {
  it("shows an employee their own open tasks, the overdue one marked, and no Everyone tab", async () => {
    renderMine();
    expect(await screen.findByText("Close out the September punch list")).toBeInTheDocument();
    expect(within(rowOf("Close out the September punch list")).getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Send the weekly progress update")).toBeInTheDocument();
    expect(screen.getByText("Renew my first aid certificate")).toBeInTheDocument();
    // The step progress shows on a task that has steps: one of three ticked.
    expect(within(rowOf("Close out the September punch list")).getByText("33%")).toBeInTheDocument();
    // A coworker's task and a finished task are not on the list.
    expect(screen.queryByText("Collect photos for the showcase page")).not.toBeInTheDocument();
    expect(screen.queryByText("Order the new signage")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Everyone" })).not.toBeInTheDocument();
  });

  it("shows completed tasks on request", async () => {
    const user = userEvent.setup();
    renderMine();
    await screen.findByText("Close out the September punch list");
    await user.click(screen.getByLabelText("Show completed"));
    expect(await screen.findByText("Order the new signage")).toBeInTheDocument();
    expect(within(rowOf("Order the new signage")).getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Close out the September punch list")).toBeInTheDocument();
  });

  it("lets an employee add a task for themselves, with no picker and no email", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    renderMine();
    await screen.findByText("Close out the September punch list");
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Assignee")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Campaign")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title"), "Call the tile supplier");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("Call the tile supplier")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("tasks: Everyone", () => {
  it("lists tasks for several people, including someone who has not signed in", async () => {
    renderEveryone();
    expect(await screen.findByText("Collect photos for the showcase page")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Tasks" });
    expect(within(list).getByText("Close out the September punch list")).toBeInTheDocument();
    expect(within(list).getByText("Complete the onboarding checklist")).toBeInTheDocument();
    expect(within(list).getAllByText(jamie.full_name!).length).toBeGreaterThan(0);
    expect(within(list).getByText(noor.full_name!)).toBeInTheDocument();
    expect(within(list).getByText("Avery Cole")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Everyone" })).toBeInTheDocument();
  });

  it("filters by person", async () => {
    const user = userEvent.setup();
    renderEveryone();
    await screen.findByText("Collect photos for the showcase page");
    await user.selectOptions(screen.getByLabelText("Filter by person"), noor.id);
    const list = screen.getByRole("list", { name: "Tasks" });
    expect(within(list).getByText("Collect photos for the showcase page")).toBeInTheDocument();
    expect(within(list).queryByText("Close out the September punch list")).not.toBeInTheDocument();
    expect(within(list).queryByText("Complete the onboarding checklist")).not.toBeInTheDocument();
  });

  it("marks people without an account in the assignee picker, never leaving them out", async () => {
    const user = userEvent.setup();
    renderEveryone();
    await screen.findByText("Collect photos for the showcase page");
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const picker = within(screen.getByRole("dialog")).getByLabelText("Assignee");
    expect(within(picker).getByRole("option", { name: "Avery Cole · not signed in yet" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: jamie.full_name! })).toBeInTheDocument();
  });

  it("creates a task for an employee with two steps and sends the assignment email once", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    renderEveryone();
    await screen.findByText("Collect photos for the showcase page");
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Measure the back porch");
    await user.selectOptions(within(dialog).getByLabelText("Assignee"), jamie.id);
    await user.type(within(dialog).getByLabelText("Steps"), "Measure the deck{Enter}Photograph the posts");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("Measure the back porch")).toBeInTheDocument();
    expect(within(rowOf("Measure the back porch")).getByText("0%")).toBeInTheDocument();
    const id = idFromRow("Measure the back porch");
    expect(id).not.toBe("");
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(id);
  });

  it("keeps the task and says so when the email does not send", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    notify.mockRejectedValueOnce(new Error("Task emails are not set up yet."));
    renderEveryone();
    await screen.findByText("Collect photos for the showcase page");
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Price the new windows");
    await user.selectOptions(within(dialog).getByLabelText("Assignee"), noor.id);
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("The task was saved. The email did not send.")).toBeInTheDocument();
    expect(screen.getByText("Price the new windows")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("will not save a repeating task without a due date", async () => {
    const user = userEvent.setup();
    const create = spyCreate();
    renderEveryone();
    await screen.findByText("Collect photos for the showcase page");
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Check the fire extinguishers");
    await user.selectOptions(within(dialog).getByLabelText("Repeat"), "monthly");
    expect(within(dialog).getByText("A repeating task needs a due date.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// The mock store lives for the whole file, so these tests change Kingdom's fixtures or tasks they
// create themselves, never the RBA fixtures the list tests above read.
describe("tasks: Task page", () => {
  it("lets an employee tick a step on a task an admin assigned them, with no Edit or Delete", async () => {
    const user = userEvent.setup();
    renderTask("kingdom-task-1", kingdomEmployee);
    expect(await screen.findByRole("heading", { name: "Close out the September punch list" })).toBeInTheDocument();
    expect(screen.getByText("Walk each open item and get sign-off on what is done.")).toBeInTheDocument();
    expect(screen.getByText(KINGDOM.profiles[0].full_name!)).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("33% complete")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Book the repairs" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Book the repairs" })).toBeChecked());
    expect(screen.getByText("67% complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a step")).not.toBeInTheDocument();
    expect(screen.queryByText("Campaign")).not.toBeInTheDocument();
  });

  it("shows the task as complete once the last step is ticked", async () => {
    const user = userEvent.setup();
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Close up the site", assignee_id: jamie.id, steps: ["Sweep the floor", "Lock the gate"] });
    renderTask(created.id);
    await screen.findByRole("heading", { name: "Close up the site" });
    await user.click(screen.getByRole("checkbox", { name: "Sweep the floor" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Sweep the floor" })).toBeChecked());
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Lock the gate" }));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.getByText("100% complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  });

  it("gives an employee Edit and Delete on a task they made for themselves, and saves an edit with no email", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    renderTask("kingdom-task-3", kingdomEmployee);
    await screen.findByRole("heading", { name: "Renew my first aid certificate" });
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByLabelText("Add a step")).toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Assignee")).not.toBeInTheDocument();
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Renew the first aid certificate");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Renew the first aid certificate" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(notify).not.toHaveBeenCalled();
  });

  it("links to the next one after an admin completes a weekly task, and locks the finished one", async () => {
    const user = userEvent.setup();
    renderTask("kingdom-task-2", kingdomAdmin);
    await screen.findByRole("heading", { name: "Send the weekly progress update" });
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    const next = await screen.findByRole("link", { name: "Open the next one" });
    expect(screen.getByText("This one is done. The next one is already open.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Email the summary" })).toBeDisabled();
    expect(screen.queryByLabelText("Add a step")).not.toBeInTheDocument();
    await user.click(next);
    expect(await screen.findByRole("button", { name: "Mark complete" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send the weekly progress update" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Email the summary" })).not.toBeChecked();
    expect(screen.queryByText("This one is done. The next one is already open.")).not.toBeInTheDocument();
  });

  it("will not show a task from another company", async () => {
    renderTask("kingdom-task-6", rbaAdmin);
    expect(await screen.findByText("That task is not in this company.")).toBeInTheDocument();
    expect(screen.queryByText("Collect photos for the showcase page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  });

  it("deletes a task after confirming and returns to the list", async () => {
    const user = userEvent.setup();
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Return the rental lift", assignee_id: null });
    renderTask(created.id, rbaAdmin);
    await screen.findByRole("heading", { name: "Return the rental lift" });
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete task" }));
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    const all = await tasksService.listTasks(RBA.company.id, { status: "all" });
    expect(all.some((t) => t.id === created.id)).toBe(false);
  });

  it("lets an admin add, rename, reorder and remove steps", async () => {
    const user = userEvent.setup();
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Prepare the site visit", assignee_id: jamie.id, steps: ["Call the client", "Print the plans"] });
    renderTask(created.id, rbaAdmin);
    await screen.findByRole("heading", { name: "Prepare the site visit" });
    await user.type(screen.getByLabelText("Add a step"), "Load the van{Enter}");
    expect(await screen.findByRole("checkbox", { name: "Load the van" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move Print the plans up" }));
    await waitFor(() => expect(stepTitles()).toEqual(["Print the plans", "Call the client", "Load the van"]));
    const rename = screen.getByLabelText("Rename Call the client");
    await user.clear(rename);
    await user.type(rename, "Call the homeowner{Enter}");
    expect(await screen.findByRole("checkbox", { name: "Call the homeowner" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Load the van" }));
    await waitFor(() => expect(stepTitles()).toEqual(["Print the plans", "Call the homeowner"]));
  });

  it("sends the assignment email on an edit only when the assignee changes", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Shoot the kitchen photos", assignee_id: noor.id, campaign_id: "rba-campaign-1" });
    renderTask(created.id, rbaAdmin);
    await screen.findByRole("heading", { name: "Shoot the kitchen photos" });
    expect(screen.getByText("Spring remodel showcase")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    let dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Shoot the kitchen and bath photos");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Shoot the kitchen and bath photos" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(notify).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Assignee"), jamie.id);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(created.id);
    expect(await screen.findByText(jamie.full_name!)).toBeInTheDocument();
  });

  it("keeps a reassignment and says so when the email does not send", async () => {
    const user = userEvent.setup();
    const notify = spyNotify();
    notify.mockRejectedValueOnce(new Error("Task emails are not set up yet."));
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Pick up the permit", assignee_id: null });
    renderTask(created.id, rbaAdmin);
    await screen.findByRole("heading", { name: "Pick up the permit" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Assignee"), noor.id);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The task was saved. The email did not send.")).toBeInTheDocument();
    expect(screen.getByText(noor.full_name!)).toBeInTheDocument();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
