// One task: what it is, who it is for and from, when it is due, and its checklist. The assignee,
// admins and whoever leads the assignee tick steps, mark it complete and reopen it; whoever may edit
// the task (an admin, a leader of the assignee, or an employee on a task they made for themselves)
// edits it, and deletes it when the database would let them. A finished copy of a repeating task
// whose next one is open is locked, and the page links to the next one. A task on a monthly GSR
// goal says whose goal and which month, and links to that GSR when it is known; one on a goal of a
// GSR on demand links to its GSR. Loaded by the id in
// the URL, so it must belong to the active company (lib/tenancy.ts). Who it is for and who assigned
// it are named from the company directory, which everyone reads, so an employee sees the name of
// the admin who assigned their task; the assignee picker stays on the profiles the viewer may see.
// The back link returns to the screen the task was opened from when that screen said where it is
// (a person's page), and to Tasks otherwise.
import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import StepList from "../../components/tasks/StepList.tsx";
import TaskForm from "../../components/tasks/TaskForm.tsx";
import type { TaskBackState } from "../../components/tasks/TaskRow.tsx";
import { sendAssignmentEmail } from "../../components/tasks/assignmentEmail.ts";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { labelClass } from "../../components/ui/forms.ts";
import { secondaryClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDate, todayIso } from "../../lib/format.ts";
import { directoryById, ledBy, nameFromDirectory } from "../../lib/people.ts";
import { reviewPath } from "../../lib/gsr/cycles.ts";
import {
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  canDeleteTask,
  canEditTask,
  canWorkTask,
  isDone,
  isLocked,
  isOverdue,
  percentComplete,
} from "../../lib/tasks.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { listDirectory } from "../../services/directory.ts";
import { listCycles, listEmployeeReviews, listGoals } from "../../services/gsr.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { completeTask, deleteTask, getTask, reopenTask } from "../../services/tasks.ts";
import type { MarketingCampaign, TaskWithSteps } from "../../types/database.ts";

// Where the back link goes: the screen the task was opened from, when it said, else Tasks.
function backFrom(state: unknown): { to: string; label: string } {
  const from = (state as Partial<TaskBackState> | null)?.from;
  if (from && typeof from.to === "string" && from.to.startsWith("/") && typeof from.label === "string") return from;
  return { to: "/tasks", label: "Tasks" };
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function TaskPage() {
  const { taskId = "" } = useParams<{ taskId: string }>();
  const { company, profile, isAdmin } = useHub();
  const navigate = useNavigate();
  const location = useLocation();
  const back = backFrom(location.state);
  const companyId = company!.id;
  const profileId = profile.id;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const state = useAsync(async () => {
    const task = await getTask(taskId);
    // Every action here is live, and a Rococo admin's switcher changes company without
    // navigating, so the task must be this company's before anything of it is shown.
    assertInCompany(task, companyId, "task");
    // Campaigns are admin-only in the database too, so an employee never asks for them.
    const [people, campaigns, directory] = await Promise.all([
      listCompanyProfiles(companyId),
      isAdmin ? listCampaigns(companyId) : Promise.resolve([] as MarketingCampaign[]),
      listDirectory(companyId),
    ]);
    return { task, people, campaigns, directory };
  }, [taskId, companyId, isAdmin]);

  // The GSR goal the task serves, read as the viewer may read it. Best effort: a goal the viewer
  // cannot read, or a failed read, leaves the plain line, never an error on the task.
  const goalId = state.data?.task.goal_id ?? null;
  const goalPerson = state.data?.task.assignee_id ?? null;
  const linked = useAsync(async () => {
    if (!goalId || !goalPerson) return null;
    try {
      const [goals, cycles, reviews] = await Promise.all([listGoals(companyId, goalPerson), listCycles(companyId), listEmployeeReviews(companyId, goalPerson)]);
      const goal = goals.find((g) => g.id === goalId) ?? null;
      if (!goal) return null;
      const cycle = goal.cycle_id ? (cycles.find((c) => c.id === goal.cycle_id) ?? null) : null;
      const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
      return { goal, cycle, review };
    } catch {
      return null;
    }
  }, [companyId, goalId, goalPerson]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { task, people, campaigns } = state.data;
  const names = directoryById(state.data.directory);
  const done = isDone(task);
  const locked = isLocked(task);
  const overdue = isOverdue(task, todayIso());
  const percent = percentComplete(task.steps);
  // The people the viewer leads, out of those the database lets them see. An admin's reach is
  // the whole list already, so it is only worked out for everyone else.
  const led = isAdmin ? [] : ledBy(profile, people);
  const viewer = { profileId, isAdmin, ledIds: led.map((p) => p.id) };
  // Ticking, completing and reopening: the assignee, admins, and the assignee's leaders.
  const canAct = canWorkTask(task, viewer);
  const canEdit = canEditTask(task, viewer);
  const canDelete = canDeleteTask(task, viewer);
  const campaign = campaigns.find((c) => c.id === task.campaign_id);
  // An employee's own task keeps its assignee; an admin picks from the roster and a leader from
  // the people they lead and themselves. A Rococo admin is an admin here, so they get the picker.
  const leadsSomeone = led.length > 0;
  const lockAssigneeTo = isAdmin || leadsSomeone ? undefined : profileId;
  const formPeople = isAdmin ? people : people.filter((p) => p.id === profileId || led.some((l) => l.id === p.id));
  const assigneeName = task.assignee_id ? nameFromDirectory(names, task.assignee_id, "Not on the roster") : null;
  const goalOwner = task.assignee_id === profileId ? "your" : assigneeName ? `${assigneeName}'s` : "a";

  const setTask = (next: TaskWithSteps) => state.setData((prev) => (prev ? { ...prev, task: next } : prev));

  async function act(change: () => Promise<TaskWithSteps>) {
    setBusy(true);
    setError("");
    try {
      setTask(await change());
    } catch (err) {
      setError(errorMessage(err, "That did not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaved(saved: TaskWithSteps) {
    const previous = task.assignee_id;
    setEditing(false);
    setNotice("");
    setTask(saved);
    const line = await sendAssignmentEmail(previous, saved, profileId, people.find((p) => p.id === saved.assignee_id) ?? null);
    if (line) setNotice(line);
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await deleteTask(task.id);
      navigate(back.to);
    } catch (err) {
      setError(errorMessage(err, "The task was not deleted. Try again."));
      setBusy(false);
    }
  }

  const actions = (
    <>
      {canAct && !done ? (
        <Button size="sm" disabled={busy} onClick={() => void act(() => completeTask(task.id))}>Mark complete</Button>
      ) : null}
      {canAct && done && !locked ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => reopenTask(task.id))}>Reopen</Button>
      ) : null}
      {canEdit ? (
        <IconButton label="Edit task" disabled={busy} onClick={() => setEditing(true)}>
          <Pencil size={15} aria-hidden />
        </IconButton>
      ) : null}
      {canDelete ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(true)}>Delete</Button> : null}
    </>
  );

  return (
    <>
      <PageHeader backTo={back.to} backLabel={back.label} eyebrow="Task" title={task.title} actions={actions} />
      {notice ? <Notice tone="warning" className="mb-4">{notice}</Notice> : null}
      {error && !deleting ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {locked ? (
        <Notice className="mb-4">
          <span>This one is done. The next one is already open.</span>{" "}
          <Link to={`/tasks/${task.next_task_id}`} className="text-link font-medium hover:underline">Open the next one</Link>
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          eyebrow="Checklist"
          title={percent === null ? "No steps" : `${percent}% complete`}
          padded={false}
        >
          <StepList task={task} canEdit={canEdit} locked={locked} canTick={canAct} onChange={setTask} />
        </Section>

        <Section eyebrow="Details" title={done ? "Done" : "Open"}>
          {task.description ? <p className={`mb-4 whitespace-pre-line ${secondaryClass}`}>{task.description}</p> : null}
          <dl className="space-y-3">
            <Detail label="Assignee">{assigneeName ?? "Unassigned"}</Detail>
            {/* A creator missing from the company's directory is a Rococo admin who stepped in to assign it. */}
            <Detail label="Assigned by">{task.created_by ? nameFromDirectory(names, task.created_by, "Hub admin") : "Not recorded"}</Detail>
            <Detail label="Due">
              {task.due_date ? formatDate(task.due_date) : "No due date"}
              {overdue ? <Badge tone="danger">Overdue</Badge> : null}
            </Detail>
            <Detail label="Priority">{PRIORITY_LABELS[task.priority]}</Detail>
            <Detail label="Repeat">{task.recurrence ? RECURRENCE_LABELS[task.recurrence] : "Does not repeat"}</Detail>
            {isAdmin ? <Detail label="Campaign">{campaign ? campaign.name : "None"}</Detail> : null}
            {done ? <Detail label="Completed">{formatDate(task.completed_at)}</Detail> : null}
            {task.goal_id ? (
              <Detail label="GSR goal">
                {linked.data ? (
                  <span>
                    On {goalOwner} GSR goal: {linked.data.goal.title}
                    {linked.data.cycle ? `, ${linked.data.cycle.name}` : ""}
                    {linked.data.review && linked.data.cycle ? (
                      <>
                        {" "}
                        <Link to={reviewPath(linked.data.review.id, linked.data.cycle.cadence)} className="text-link hover:underline">Open the GSR</Link>
                      </>
                    ) : null}
                    {/* A goal on a GSR on demand names its GSR itself (goals.review_id, 0047). */}
                    {company?.gsr_mode === "on_demand" && !linked.data.cycle && linked.data.goal.review_id ? (
                      <>
                        {" "}
                        <Link to={`/gsr/reviews/${linked.data.goal.review_id}`} className="text-link hover:underline">Open the GSR</Link>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>On a GSR goal</span>
                )}
              </Detail>
            ) : null}
          </dl>
        </Section>
      </div>

      {editing ? (
        <TaskForm
          companyId={companyId}
          people={formPeople}
          campaigns={campaigns}
          initial={task}
          lockAssigneeTo={lockAssigneeTo}
          allowUnassigned={isAdmin}
          canSetCampaign={isAdmin}
          goalTitle={linked.data?.goal.title ?? null}
          onSaved={(saved) => void handleSaved(saved)}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this task?"
          body={task.recurrence && !locked ? "The task and its steps go for good, and it stops repeating." : "The task and its steps go for good."}
          confirmLabel="Delete task"
          busy={busy}
          error={error}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            setDeleting(false);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}
