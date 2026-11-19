// The person page and the tasks screens for a manager and an admin after the team access work: what
// a manager reads on a person they lead (no pay, read-only fields, ratings read only), adding a task
// from the person page and seeing it stay, starting this month's GSR from there, the division
// checkboxes (Both included) and the owner-only view access editor, the line for a person the
// viewer cannot see, the Team tab on Tasks, a leader editing a task on someone they lead, a task
// form started from a GSR goal, and the notice when the assignee has not signed in yet. The mocks
// stand in for RLS by narrowing listCompanyProfiles to what a manager would get.
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
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { HubContext, type HubValue } from "../context/HubContext.tsx";
import * as profilesService from "../services/profiles.ts";
import * as employeesService from "../services/employees.ts";
import * as tasksService from "../services/tasks.ts";
import { createGoal, ensureReview } from "../services/gsr.ts";
import { RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import TaskForm from "../components/tasks/TaskForm.tsx";
import PersonPage from "./people/PersonPage.tsx";
import TaskPage from "./tasks/TaskPage.tsx";
import TasksPage from "./tasks/TasksPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const rbaOwner: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, role: "owner" } };
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const harper = byName("Harper Quinn");
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");
const jamie = byName("Jamie Fox");
const team = [harper.id, rowan.id, kai.id];
const september = RBA.cycles.find((c) => c.id === "rba-cycle-overlapping")!;

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

// The person page, on a tab when one is named, with the GSR review route beside it, so starting a
// GSR can land somewhere.
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

// The stored row, as the database holds it after a write.
async function stored(id: string) {
  return (await profilesService.listCompanyProfiles(RBA.company.id)).find((p) => p.id === id)!;
}

function renderTask(id: string, hub: HubValue) {
  return renderWithHub(<TaskPage />, hub, { path: `/tasks/${id}`, pattern: "/tasks/:taskId" });
}

describe("the person page for a manager", () => {
  it("reads a team member's record without pay, financial figures or edit controls", async () => {
    onlySees(team);
    const compensation = vi.spyOn(employeesService, "listCompensation");
    const financials = vi.spyOn(employeesService, "listEmployeeFinancials");
    onTestFinished(() => {
      compensation.mockRestore();
      financials.mockRestore();
    });
    const user = userEvent.setup();
    renderPerson(rowan.id, rbaManager);
    expect(await screen.findByRole("heading", { name: "Rowan Ellis" })).toBeInTheDocument();
    // No Setup tab, and profile fields read as text on Overview.
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Reports to" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Role" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Crew Lead").length).toBeGreaterThan(0);
    expect(await screen.findByText("Both")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Divisions" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Scorecard" }));
    expect(await screen.findByRole("heading", { name: "Personal KPIs" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Compensation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Financial figures" })).not.toBeInTheDocument();
    expect(screen.queryByText("Annual compensation")).not.toBeInTheDocument();
    expect(compensation).not.toHaveBeenCalled();
    expect(financials).not.toHaveBeenCalled();
    // Ratings read only: no radio buttons to click.
    await user.click(screen.getByRole("link", { name: "Reviews" }));
    expect(await screen.findByRole("heading", { name: "Review history" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /of 5/ })).not.toBeInTheDocument();
  });

  it("adds a task for someone they lead, and the task is there after a reload", async () => {
    onlySees(team);
    const user = userEvent.setup();
    const first = renderPerson(rowan.id, rbaManager, "tasks");
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Assignee")).not.toBeInTheDocument();
    expect(within(dialog).getByText("For Rowan Ellis")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title"), "Check the scaffold tags");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    const list = await screen.findByRole("list", { name: "Open tasks for Rowan Ellis" });
    expect(within(list).getByText("Check the scaffold tags")).toBeInTheDocument();
    // The row leads back to this person.
    expect(within(list).getByRole("link", { name: /Check the scaffold tags/ })).toHaveAttribute("href", expect.stringMatching(/^\/tasks\//));
    first.unmount();

    renderPerson(rowan.id, rbaManager, "tasks");
    const again = await screen.findByRole("list", { name: "Open tasks for Rowan Ellis" });
    expect(within(again).getByText("Check the scaffold tags")).toBeInTheDocument();
  });

  it("starts this month's GSR for someone they lead and opens it", async () => {
    onlySees(team);
    const user = userEvent.setup();
    renderPerson(kai.id, rbaManager);
    expect(await screen.findByRole("heading", { name: "This month's GSR" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start this month's GSR/ }));
    expect(await screen.findByText(/^review /)).toBeInTheDocument();
  });

  it("says they have no access to someone outside their view", async () => {
    onlySees(team);
    renderPerson(jamie.id, rbaManager);
    expect(await screen.findByText("You do not have access to this person.")).toBeInTheDocument();
    expect(screen.queryByText(/not in this company/)).not.toBeInTheDocument();
  });

  it("tells the manager no email went when the person has not signed in yet", async () => {
    onlySees(team);
    const notify = vi.spyOn(tasksService, "notifyAssignment");
    onTestFinished(() => notify.mockRestore());
    const user = userEvent.setup();
    renderPerson(kai.id, rbaManager, "tasks");
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Read the safety binder");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("Saved. They have not signed in yet, so no email went.")).toBeInTheDocument();
    expect(screen.getByText("Read the safety binder")).toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("the person page for an admin", () => {
  it("places someone in divisions with checkboxes, ticking both for Both", async () => {
    const user = userEvent.setup();
    renderPerson(rowan.id, rbaAdmin, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    const group = await screen.findByRole("group", { name: "Divisions" });
    expect(within(group).getByRole("checkbox", { name: "RBA South" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "RBA North" })).toBeChecked();
    expect(within(group).getByText(/Works in: Both\./)).toBeInTheDocument();
    await user.click(within(group).getByRole("checkbox", { name: "RBA North" }));
    await waitFor(() => expect(within(group).getByText(/Works in: RBA South\./)).toBeInTheDocument());
    expect((await stored(rowan.id)).division_ids).toEqual(["rba-division-south"]);
    await user.click(within(group).getByRole("checkbox", { name: "RBA North" }));
    await waitFor(() => expect(within(group).getByText(/Works in: Both\./)).toBeInTheDocument());
    // An admin does not set who sees what: that is an owner's.
    expect(screen.queryByRole("group", { name: "Can view" })).not.toBeInTheDocument();
  });

  it("keeps a division the admin cannot view ticked and locked", async () => {
    await profilesService.updateProfile(rowan.id, { division_ids: ["rba-division-south", "rba-division-north"] });
    const southOnly: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, view_all_divisions: false, view_division_ids: ["rba-division-south"] } };
    renderPerson(rowan.id, southOnly, "setup");
    await userEvent.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    const group = await screen.findByRole("group", { name: "Divisions" });
    expect(within(group).getByRole("checkbox", { name: "RBA North" })).toBeDisabled();
    expect(within(group).getByRole("checkbox", { name: "RBA North" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "RBA South" })).toBeEnabled();
  });

  it("gives only an owner the view access editor, on a manager's row", async () => {
    const user = userEvent.setup();
    const asAdmin = renderPerson(harper.id, rbaAdmin, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    await screen.findByRole("group", { name: "Divisions" });
    expect(screen.queryByRole("group", { name: "Can view" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner or Rococo can change that\./)).toBeInTheDocument();
    asAdmin.unmount();

    renderPerson(harper.id, rbaOwner, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    const access = await screen.findByRole("group", { name: "Can view" });
    expect(within(access).getByRole("radio", { name: "None" })).toBeChecked();
    await user.click(within(access).getByRole("radio", { name: "Chosen divisions" }));
    await user.click(within(access).getByRole("checkbox", { name: "Can view RBA North" }));
    await waitFor(() => expect(within(access).getByRole("checkbox", { name: "Can view RBA North" })).toBeChecked());
    expect((await stored(harper.id)).view_division_ids).toEqual(["rba-division-north"]);
    await user.click(within(access).getByRole("radio", { name: "All divisions" }));
    await waitFor(() => expect(within(access).getByRole("radio", { name: "All divisions" })).toBeChecked());
    expect((await stored(harper.id)).view_all_divisions).toBe(true);
    // Membership and access are different settings, and the help says so.
    expect(within(access).getByText(/apart from where they work/)).toBeInTheDocument();
  });

  it("names a manager who is inactive in Reports to, and warns when the manager is an employee", async () => {
    const user = userEvent.setup();
    renderPerson(kai.id, rbaAdmin, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit reports to" }));
    const picker = await screen.findByRole("combobox", { name: "Reports to" });
    expect(picker).toHaveValue(rowan.id);
    expect(screen.getByText("They will not see this person until they are a manager.")).toBeInTheDocument();
    await user.selectOptions(picker, harper.id);
    await waitFor(() => expect(screen.queryByText("They will not see this person until they are a manager.")).not.toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox", { name: "Reports to" }), rowan.id);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Reports to" })).toHaveValue(rowan.id));
  });
});

describe("Reports to on the person page", () => {
  it("names a manager who is inactive, rather than reading Nobody", async () => {
    await profilesService.updateProfile(rowan.id, { is_active: false });
    onTestFinished(async () => {
      await profilesService.updateProfile(rowan.id, { is_active: true });
    });
    renderPerson(kai.id, rbaAdmin, "setup");
    await userEvent.click(await screen.findByRole("button", { name: "Edit reports to" }));
    const picker = await screen.findByRole("combobox", { name: "Reports to" });
    expect(picker).toHaveValue(rowan.id);
    expect(within(picker).getByRole("option", { name: "Rowan Ellis (inactive)" })).toBeInTheDocument();
  });

  it("names a manager the viewer cannot see from the directory", async () => {
    // An admin who sees Kai but not Rowan, Kai's manager.
    onlySees([rbaAdmin.profile.id, kai.id]);
    renderPerson(kai.id, rbaAdmin, "setup");
    await userEvent.click(await screen.findByRole("button", { name: "Edit reports to" }));
    const picker = await screen.findByRole("combobox", { name: "Reports to" });
    expect(picker).toHaveValue(rowan.id);
    expect(within(picker).getByRole("option", { name: "Rowan Ellis" })).toBeInTheDocument();
    expect(screen.getByText("Reports to Rowan Ellis")).toBeInTheDocument();
  });
});

describe("going back from a task on the person page", () => {
  function renderFrom(path: string) {
    return render(
      <HubContext value={rbaManager}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
            <Route path="/tasks/:taskId" element={<TaskPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext>,
    );
  }

  it("returns to the Tasks tab from a task opened there, and to Overview from the short list", async () => {
    await tasksService.createTask({ company_id: RBA.company.id, title: "Walk the site before the pour", assignee_id: rowan.id });
    onlySees(team);
    const fromTab = renderFrom(`/people/${rowan.id}/tasks`);
    const tabList = await screen.findByRole("list", { name: "Open tasks for Rowan Ellis" });
    fireEvent.click(within(tabList).getByRole("link", { name: /Walk the site before the pour/ }));
    expect(await screen.findByRole("heading", { name: "Walk the site before the pour" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rowan Ellis/ })).toHaveAttribute("href", `/people/${rowan.id}/tasks`);
    fromTab.unmount();

    renderFrom(`/people/${rowan.id}`);
    const overviewList = await screen.findByRole("list", { name: "Open tasks for Rowan Ellis" });
    fireEvent.click(within(overviewList).getByRole("link", { name: /Walk the site before the pour/ }));
    expect(await screen.findByRole("heading", { name: "Walk the site before the pour" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rowan Ellis/ })).toHaveAttribute("href", `/people/${rowan.id}`);
  });
});

describe("a task on a GSR goal", () => {
  it("says whose goal and which month on the task, links to the GSR, and goes back to the person", async () => {
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    const goal = await createGoal({ company_id: RBA.company.id, employee_id: rowan.id, cycle_id: september.id, title: "Run the Friday toolbox talk", kind: "role" });
    const task = await tasksService.createTask({ company_id: RBA.company.id, title: "Pick a toolbox topic", assignee_id: rowan.id, goal_id: goal.id });
    onlySees(team);
    render(
      <HubContext value={rbaManager}>
        <MemoryRouter initialEntries={[`/people/${rowan.id}`]}>
          <Routes>
            <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
            <Route path="/tasks/:taskId" element={<TaskPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext>,
    );
    const list = await screen.findByRole("list", { name: "Open tasks for Rowan Ellis" });
    expect(within(list).getByText("September 2026 GSR")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("link", { name: /Pick a toolbox topic/ }));
    expect(await screen.findByRole("heading", { name: "Pick a toolbox topic" })).toBeInTheDocument();
    expect(await screen.findByText(/On Rowan Ellis's GSR goal: Run the Friday toolbox talk, September 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the GSR" })).toHaveAttribute("href", `/gsr/reviews/${review.id}`);
    expect(screen.getByRole("link", { name: /Rowan Ellis/ })).toHaveAttribute("href", `/people/${rowan.id}`);
    // Its person stays with the goal while it is linked.
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    expect(within(screen.getByRole("dialog")).getByLabelText(/Assignee/)).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByText("Linked to Run the Friday toolbox talk")).toBeInTheDocument();
    expect(task.goal_id).toBe(goal.id);
  });
});

describe("Tasks for a manager", () => {
  it("labels the second tab Team and lists only the team's tasks", async () => {
    onlySees(team);
    const user = userEvent.setup();
    await tasksService.createTask({ company_id: RBA.company.id, title: "Sweep the yard", assignee_id: rowan.id });
    renderWithHub(<TasksPage tab="everyone" />, rbaManager, { path: "/tasks/everyone", pattern: "/tasks/everyone" });
    expect(await screen.findByText("Sweep the yard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Everyone" })).not.toBeInTheDocument();
    // Jamie is outside Harper's view, so Jamie's tasks are not on her Team list.
    expect(screen.queryByText("Close out the September punch list")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const picker = within(screen.getByRole("dialog")).getByLabelText("Assignee");
    expect(within(picker).getByRole("option", { name: "Rowan Ellis" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Kai Bennett · not signed in yet" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Harper Quinn" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Unassigned" })).not.toBeInTheDocument();
  });
});

describe("a task on someone a manager leads", () => {
  it("lets the manager edit it, but delete only what they created", async () => {
    onlySees(team);
    const user = userEvent.setup();
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Stack the lumber", assignee_id: rowan.id });
    renderTask(created.id, rbaManager);
    expect(await screen.findByRole("heading", { name: "Stack the lumber" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeInTheDocument();
    // Created by someone else, so the database would refuse a manager's delete.
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit task" }));
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Stack and cover the lumber");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Stack and cover the lumber" })).toBeInTheDocument();
  });

  it("gives an employee no Edit on a task someone else assigned them", async () => {
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Wash the trucks", assignee_id: jamie.id });
    renderTask(created.id, makeHub("employee", RBA.company));
    expect(await screen.findByRole("heading", { name: "Wash the trucks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit task" })).not.toBeInTheDocument();
  });
});

describe("the task form started from a GSR goal", () => {
  it("says which goal and saves the goal with the task", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(tasksService, "createTask").mockImplementation(async (input) => ({
      id: "task-from-goal",
      company_id: input.company_id,
      title: input.title,
      description: null,
      assignee_id: input.assignee_id,
      created_by: harper.id,
      due_date: null,
      priority: "medium",
      recurrence: null,
      campaign_id: null,
      goal_id: input.goal_id ?? null,
      completed_at: null,
      completed_by: null,
      next_task_id: null,
      notified_assignee_id: null,
      created_at: "2026-11-18T00:00:00.000Z",
      updated_at: "2026-11-18T00:00:00.000Z",
      steps: [],
    }));
    onTestFinished(() => create.mockRestore());
    const saved = vi.fn();
    renderWithHub(
      <TaskForm
        companyId={RBA.company.id}
        people={[rowan]}
        campaigns={[]}
        initial={{ assignee_id: rowan.id, goal_id: "goal-x" }}
        lockAssigneeTo={rowan.id}
        canSetCampaign={false}
        goalTitle="Lead the Friday toolbox talk"
        onSaved={saved}
        onClose={() => undefined}
      />,
      rbaManager,
    );
    expect(screen.getByText("Linked to Lead the Friday toolbox talk")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Pick the topic");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ assignee_id: rowan.id, goal_id: "goal-x" }));
  });
});

describe("a manager over a manager", () => {
  // Harper (manager) > Rowan, made a manager here > Kai (employee): the list the database hands
  // Harper once the managers in her chain are visible to her.
  function rowanManages() {
    const original = profilesService.listCompanyProfiles;
    const spy = vi.spyOn(profilesService, "listCompanyProfiles").mockImplementation(async (companyId) =>
      (await original(companyId)).filter((p) => team.includes(p.id)).map((p) => (p.id === rowan.id ? { ...p, role: "manager" as const } : p)),
    );
    onTestFinished(() => spy.mockRestore());
  }

  it("leads the employee two levels down: Add task and this month's GSR on their page", async () => {
    rowanManages();
    renderPerson(kai.id, rbaManager);
    expect(await screen.findByRole("button", { name: "Add task" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This month's GSR" })).toBeInTheDocument();
  });

  it("does not lead the manager between them", async () => {
    rowanManages();
    renderPerson(rowan.id, rbaManager);
    expect(await screen.findByRole("heading", { name: "Rowan Ellis" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This month's GSR" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Scorecard" }));
    expect(await screen.findByRole("heading", { name: "Personal KPIs" })).toBeInTheDocument();
  });
});

describe("copy on a team member's page", () => {
  it("never tells the manager 'your manager' about the person they lead", async () => {
    onlySees(team);
    // An admin set it, as the database stamps it (the mock hands back its stored row).
    const goal = await createGoal({ company_id: RBA.company.id, employee_id: rowan.id, title: "Earn the site lead ticket", kind: "professional", scope: "year", year: 2026 });
    Object.assign(goal, { created_by: rbaAdmin.profile.id });
    renderPerson(rowan.id, rbaManager, "gsr");
    expect(await screen.findByText("Earn the site lead ticket")).toBeInTheDocument();
    expect(screen.queryByText(/your manager/i)).not.toBeInTheDocument();
    // Their deliverables sit on Reviews.
    await userEvent.click(screen.getByRole("link", { name: "Reviews" }));
    expect(await screen.findByText("An admin sets these up with them.")).toBeInTheDocument();
    expect(screen.queryByText(/your manager/i)).not.toBeInTheDocument();
  });
});

describe("who reports to a person", () => {
  it("shows a manager their own team as a tree on their profile", async () => {
    onlySees(team);
    renderPerson(harper.id, rbaManager);
    const tree = await screen.findByRole("list", { name: "Who reports to you" });
    // Rowan reports to Harper, and Kai to Rowan: Kai sits under Rowan, not beside them. Direct
    // reports show; a branch below them is closed, and its "N below" is the control that opens it.
    expect(within(tree).getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}`);
    expect(screen.getByText("1 direct report, 2 in all.")).toBeInTheDocument();
    const opener = within(tree).getByRole("button", { name: "1 below Rowan Ellis" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveTextContent("1 below");
    expect(within(tree).queryByRole("list", { name: "Reports to Rowan Ellis" })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("link", { name: "Kai Bennett" })).not.toBeInTheDocument();
    await userEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    const underRowan = within(tree).getByRole("list", { name: "Reports to Rowan Ellis" });
    expect(opener).toHaveAttribute("aria-controls", underRowan.id);
    expect(within(underRowan).getByRole("link", { name: "Kai Bennett" })).toBeInTheDocument();
    expect(within(underRowan).getByText("Not signed in yet")).toBeInTheDocument();
    // And it closes again.
    await userEvent.click(opener);
    expect(within(tree).queryByRole("link", { name: "Kai Bennett" })).not.toBeInTheDocument();
  });

  it("shows an admin who reports to a manager, and says when nobody does", async () => {
    renderPerson(harper.id, rbaAdmin);
    expect(await screen.findByRole("list", { name: "Who reports to Harper" })).toBeInTheDocument();
  });

  it("warns when an employee has people reporting to them", async () => {
    renderPerson(rowan.id, rbaAdmin);
    expect(await screen.findByText(/Rowan is an employee, so they do not see these people/)).toBeInTheDocument();
  });

  it("leaves the section off for an employee with nobody under them", async () => {
    renderPerson(jamie.id, rbaAdmin);
    expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Who reports to/ })).not.toBeInTheDocument();
  });
});
