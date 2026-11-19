// The tasks behind one monthly goal, on the Goal Setting Review. A goal says what the month is for;
// its tasks are the work toward it, each with its live state wherever the goal shows, past months
// included. While the month is open to the viewer they can link one of the person's open tasks, add
// a new task for the person already on the goal, or unlink one. A past or locked month lists its
// tasks read only, so a GSR on record keeps the work that was behind it. The database allows an
// unlink at any time (0039); the screen offers it only on an editable month for that reason.
// Completion is information only: a done task never moves the goal's completion or any score.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Link2, Plus, Unlink } from "lucide-react";
import TaskForm from "../tasks/TaskForm.tsx";
import { sendAssignmentEmail } from "../tasks/assignmentEmail.ts";
import Button from "../ui/Button.tsx";
import IconButton from "../ui/IconButton.tsx";
import { selectClass } from "../ui/forms.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { hasAccount } from "../../lib/people.ts";
import { isDone } from "../../lib/tasks.ts";
import { linkTaskToGoal, listTasks } from "../../services/tasks.ts";
import type { Goal, Profile, TaskWithSteps } from "../../types/database.ts";
import { eyebrowLabelClass as eyebrowClass } from "../ui/type.ts";

type TasksUpdate = (update: (tasks: TaskWithSteps[]) => TaskWithSteps[]) => void;

function TaskRow({ task, canUnlink, busy, onUnlink }: { task: TaskWithSteps; canUnlink: boolean; busy: boolean; onUnlink: () => void }) {
  const done = isDone(task);
  return (
    <li className="flex items-center gap-2 py-1.5">
      {done ? <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden /> : <Circle size={13} className="shrink-0 text-ink-3" aria-hidden />}
      <Link to={`/tasks/${task.id}`} className={`min-w-0 flex-1 truncate text-[13px] hover:underline ${done ? "text-ink-2" : "text-ink"}`}>
        {task.title}
      </Link>
      <span className="tnum shrink-0 text-[12px] text-ink-3">
        {done ? "Done" : "Open"}
        {task.due_date ? ` · Due ${formatDate(task.due_date)}` : ""}
      </span>
      {canUnlink ? (
        <IconButton label={`Unlink ${task.title}`} onClick={onUnlink} disabled={busy} className="h-7 w-7">
          <Unlink size={13} aria-hidden />
        </IconButton>
      ) : null}
    </li>
  );
}

export default function GoalTasks({
  goal,
  tasks,
  people,
  canEdit,
  viewerProfileId,
  onTasks,
  onError,
  onSaved,
}: {
  goal: Pick<Goal, "id" | "title" | "company_id" | "employee_id">;
  // The tasks linked to this goal, open and done.
  tasks: TaskWithSteps[];
  // The profiles the viewer may see, for the task form; the goal's person is among them.
  people: Profile[];
  // The month is open to the viewer: link, add and unlink. Otherwise the list reads only.
  canEdit: boolean;
  viewerProfileId: string;
  // Updates the caller's list of every linked task on the page.
  onTasks: TasksUpdate;
  onError: (message: string) => void;
  onSaved?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<TaskWithSteps[] | null>(null);
  const [choice, setChoice] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const person = people.find((p) => p.id === goal.employee_id) ?? null;

  if (!canEdit && tasks.length === 0) return null;

  const replace = (task: TaskWithSteps) => onTasks((list) => [...list.filter((t) => t.id !== task.id), task]);

  // The person's open tasks that serve no goal yet. Read when the picker opens, so it is current.
  async function openPicker() {
    if (busy) return;
    setPicking(true);
    setCandidates(null);
    setChoice("");
    setNotice("");
    try {
      const open = await listTasks(goal.company_id, { assigneeId: goal.employee_id });
      const free = open.filter((t) => t.goal_id === null);
      setCandidates(free);
      setChoice(free[0]?.id ?? "");
    } catch (err) {
      setPicking(false);
      onError(errorMessage(err));
    }
  }

  async function link() {
    if (!choice || busy) return;
    setBusy(true);
    try {
      replace(await linkTaskToGoal(choice, goal.id));
      setPicking(false);
      onSaved?.();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(task: TaskWithSteps) {
    if (busy) return;
    setBusy(true);
    try {
      await linkTaskToGoal(task.id, null);
      onTasks((list) => list.filter((t) => t.id !== task.id));
      onSaved?.();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // The form saves the task with the goal on it. If it came back without the link, it is linked
  // here, so the task never lands somewhere the goal cannot see it.
  async function created(task: TaskWithSteps) {
    setAdding(false);
    let saved = task;
    if (saved.goal_id !== goal.id) {
      try {
        saved = await linkTaskToGoal(saved.id, goal.id);
      } catch (err) {
        onError(`The task was added, but it is not linked to this goal. ${errorMessage(err)}`);
        return;
      }
    }
    replace(saved);
    onSaved?.();
    if (saved.assignee_id && saved.assignee_id !== viewerProfileId && person && !hasAccount(person)) {
      setNotice(`The task was saved. ${displayName(person)} has not signed in yet, so no email went.`);
      return;
    }
    setNotice(await sendAssignmentEmail(undefined, saved, viewerProfileId));
  }

  return (
    <div className="mt-3">
      <p className={eyebrowClass}>Tasks</p>
      {tasks.length > 0 ? (
        <ul aria-label={`Tasks for ${goal.title}`} className="mt-0.5 divide-y divide-line">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} canUnlink={canEdit} busy={busy} onUnlink={() => void unlink(task)} />
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-[12.5px] text-ink-3">No tasks on this goal yet.</p>
      )}
      {canEdit && picking ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {candidates === null ? (
            <span className="text-[12.5px] text-ink-3">Reading open tasks...</span>
          ) : candidates.length === 0 ? (
            <span className="text-[12.5px] text-ink-2">No open tasks to link. Add a new one instead.</span>
          ) : (
            <>
              <select value={choice} aria-label={`Task to link to ${goal.title}`} onChange={(e) => setChoice(e.target.value)} className={`${selectClass} mt-0 w-auto min-w-0 max-w-full flex-1 py-1 text-[13px]`}>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.due_date ? `${t.title} · Due ${formatDate(t.due_date)}` : t.title}</option>
                ))}
              </select>
              <Button size="sm" variant="secondary" disabled={!choice || busy} onClick={() => void link()}>
                Link
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
        </div>
      ) : canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openPicker()} aria-label={`Link a task to ${goal.title}`}>
            <Link2 size={13} aria-hidden /> Link a task
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setNotice(""); setAdding(true); }} aria-label={`New task for ${goal.title}`}>
            <Plus size={13} aria-hidden /> New task
          </Button>
        </div>
      ) : null}
      {notice ? <p role="status" className="mt-1.5 text-[12.5px] text-warning">{notice}</p> : null}
      {adding ? (
        <TaskForm
          companyId={goal.company_id}
          people={people}
          campaigns={[]}
          initial={{ assignee_id: goal.employee_id, goal_id: goal.id }}
          lockAssigneeTo={goal.employee_id}
          goalTitle={goal.title}
          canSetCampaign={false}
          onSaved={(task) => void created(task)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
