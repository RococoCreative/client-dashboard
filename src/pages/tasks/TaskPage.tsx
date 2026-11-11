// One task: what it is, who it is for and from, when it is due, and its checklist. The assignee
// and admins tick steps, mark it complete and reopen it; whoever may edit the task (an admin, or an
// employee on a task they made for themselves) edits it and deletes it. A finished copy of a
// repeating task whose next one is open is locked, and the page links to the next one. Loaded by
// the id in the URL, so it must belong to the active company (lib/tenancy.ts).
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StepList from "../../components/tasks/StepList.tsx";
import TaskForm from "../../components/tasks/TaskForm.tsx";
import { sendAssignmentEmail } from "../../components/tasks/assignmentEmail.ts";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { labelClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, todayIso } from "../../lib/format.ts";
import {
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  canEditTask,
  isDone,
  isLocked,
  isOverdue,
  percentComplete,
} from "../../lib/tasks.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { completeTask, deleteTask, getTask, reopenTask } from "../../services/tasks.ts";
import type { MarketingCampaign, TaskWithSteps } from "../../types/database.ts";

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
    const [people, campaigns] = await Promise.all([listCompanyProfiles(companyId), isAdmin ? listCampaigns(companyId) : Promise.resolve([] as MarketingCampaign[])]);
    return { task, people, campaigns };
  }, [taskId, companyId, isAdmin]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { task, people, campaigns } = state.data;
  const names = new Map(people.map((p) => [p.id, displayName(p)]));
  const done = isDone(task);
  const locked = isLocked(task);
  const overdue = isOverdue(task, todayIso());
  const percent = percentComplete(task.steps);
  // Ticking, completing and reopening are for the assignee and admins.
  const canAct = isAdmin || task.assignee_id === profileId;
  const canEdit = canEditTask(task, { profileId, isAdmin });
  const campaign = campaigns.find((c) => c.id === task.campaign_id);
  // An employee's own task keeps its assignee; an admin picks from the roster. A Rococo admin is
  // an admin here, so they get the picker too.
  const lockAssigneeTo = isAdmin ? undefined : profileId;

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
    const line = await sendAssignmentEmail(previous, saved, profileId);
    if (line) setNotice(line);
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await deleteTask(task.id);
      navigate("/tasks");
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
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(true)}>Delete</Button>
        </>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader backTo="/tasks" backLabel="Tasks" eyebrow="Task" title={task.title} actions={actions} />
      {notice ? <Notice tone="warning" className="mb-4">{notice}</Notice> : null}
      {error && !deleting ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {locked ? (
        <Notice className="mb-4">
          <span>This one is done. The next one is already open.</span>{" "}
          <Link to={`/tasks/${task.next_task_id}`} className="font-medium underline">Open the next one</Link>
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
          {task.description ? <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-ink-2">{task.description}</p> : null}
          <dl className="space-y-3">
            <Detail label="Assignee">{task.assignee_id ? (names.get(task.assignee_id) ?? "Not on the roster") : "Unassigned"}</Detail>
            {/* A creator missing from the company's roster is a Rococo admin who stepped in to assign it. */}
            <Detail label="Assigned by">{task.created_by ? (names.get(task.created_by) ?? "Hub admin") : "Not recorded"}</Detail>
            <Detail label="Due">
              {task.due_date ? formatDate(task.due_date) : "No due date"}
              {overdue ? <Badge tone="danger">Overdue</Badge> : null}
            </Detail>
            <Detail label="Priority">{PRIORITY_LABELS[task.priority]}</Detail>
            <Detail label="Repeat">{task.recurrence ? RECURRENCE_LABELS[task.recurrence] : "Does not repeat"}</Detail>
            {isAdmin ? <Detail label="Campaign">{campaign ? campaign.name : "None"}</Detail> : null}
            {done ? <Detail label="Completed">{formatDate(task.completed_at)}</Detail> : null}
          </dl>
        </Section>
      </div>

      {editing ? (
        <TaskForm
          companyId={companyId}
          people={people}
          campaigns={campaigns}
          initial={task}
          lockAssigneeTo={lockAssigneeTo}
          canSetCampaign={isAdmin}
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
