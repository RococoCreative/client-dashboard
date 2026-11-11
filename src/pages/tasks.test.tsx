// The Tasks module's pages against the mocked data layer: what an employee and an admin each see,
// adding a task, the assignment email and what happens when it fails. Same mock block as
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
import { RBA, makeHub } from "../test/fixtures.ts";
import TasksPage from "./tasks/TasksPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
const jamie = RBA.profiles[1];
const noor = RBA.profiles[2];

function renderMine(hub = rbaEmployee) {
  return renderWithHub(<TasksPage tab="mine" />, hub, { path: "/tasks", pattern: "/tasks" });
}
function renderEveryone() {
  return renderWithHub(<TasksPage tab="everyone" />, rbaAdmin, { path: "/tasks/everyone", pattern: "/tasks/everyone" });
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
