// A person's tasks on their person page, for an admin or a manager reading it: their open tasks,
// earliest due first, then their most recent finished ones folded away under "Done (N)", each
// linking to the task and back here. A task that serves one of their monthly GSR goals says which
// month. Whoever may assign this person work (an admin, or someone who leads them) adds a task here
// with the person already filled in, and the new task shows at once. It loads its own rows, and the
// page renders it only when the company has the tasks module, so a company without it asks for
// nothing. Someone who has not signed in yet has their tasks here too: tasks attach to the person,
// never to an account, and adding one for them says plainly that no email went.
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import TaskForm from "./TaskForm.tsx";
import TaskRow, { type TaskBackState } from "./TaskRow.tsx";
import { sendAssignmentEmail } from "./assignmentEmail.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { displayName, todayIso } from "../../lib/format.ts";
import { isDone, sortTasks } from "../../lib/tasks.ts";
import { listTasks } from "../../services/tasks.ts";
import type { Profile, TaskWithSteps } from "../../types/database.ts";

// How many finished tasks the page keeps in view. The Tasks page has the rest.
const RECENT_DONE = 5;

export default function PersonTasks({
  companyId,
  person,
  canAdd = false,
  viewerProfileId = null,
  goalLabel,
}: {
  companyId: string;
  person: Profile;
  // The viewer may assign this person work: an admin, or someone who leads them.
  canAdd?: boolean;
  viewerProfileId?: string | null;
  // How a task's GSR goal reads ("September 2026 GSR"), or null when the goal is not known here.
  goalLabel?: (goalId: string) => string | null;
}) {
  const state = useAsync(() => listTasks(companyId, { assigneeId: person.id, status: "all" }), [companyId, person.id]);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [notice, setNotice] = useState("");
  const today = todayIso();
  const name = displayName(person);
  const back: TaskBackState = { from: { to: `/people/${person.id}`, label: name } };
  const all = state.data ?? [];
  const open = sortTasks(all.filter((t) => !isDone(t)));
  const done = all.filter(isDone).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const recentDone = done.slice(0, RECENT_DONE);

  const noteFor = (task: TaskWithSteps): string | null => (task.goal_id ? (goalLabel?.(task.goal_id) ?? "On a GSR goal") : null);

  async function created(task: TaskWithSteps) {
    setAdding(false);
    // Only this person's tasks belong here; the form is fixed to them, so this is a guard, not a filter.
    if (task.assignee_id === person.id) state.setData((prev) => (prev ? [...prev.filter((t) => t.id !== task.id), task] : [task]));
    setNotice(await sendAssignmentEmail(undefined, task, viewerProfileId, person));
  }

  const action = canAdd ? (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        setNotice("");
        setAdding(true);
      }}
    >
      <Plus size={14} aria-hidden /> Add task
    </Button>
  ) : undefined;

  return (
    <Section title="Tasks" description="Open tasks assigned to this person, earliest due first." padded={false} actions={action}>
      {notice ? <div className="px-5 pt-4"><Notice tone="warning">{notice}</Notice></div> : null}
      {state.error && !state.data ? (
        <div className="p-5"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-5"><SkeletonRows rows={2} /></div>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-3">No open tasks.</p>
          ) : (
            <ul aria-label={`Open tasks for ${name}`} className="divide-y divide-line">
              {open.map((task) => (
                <TaskRow key={task.id} task={task} assigneeName={name} today={today} showAssignee={false} note={noteFor(task)} linkState={back} />
              ))}
            </ul>
          )}
          {done.length > 0 ? (
            <div className="border-t border-line px-5 py-2">
              <Button variant="row" size="sm" aria-expanded={showDone} onClick={() => setShowDone((was) => !was)}>
                <ChevronRight size={13} aria-hidden className={`shrink-0 text-ink-3 transition-transform duration-150 ${showDone ? "rotate-90" : ""}`} />
                <span className="tnum">Done ({done.length})</span>
              </Button>
            </div>
          ) : null}
          {showDone && done.length > 0 ? (
            <>
              <ul aria-label={`Done tasks for ${name}`} className="divide-y divide-line border-t border-line">
                {recentDone.map((task) => (
                  <TaskRow key={task.id} task={task} assigneeName={name} today={today} showAssignee={false} note={noteFor(task)} linkState={back} />
                ))}
              </ul>
              {done.length > recentDone.length ? (
                <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3">
                  The {RECENT_DONE} most recent. The rest are on Tasks.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {adding ? (
        <TaskForm
          companyId={companyId}
          people={[person]}
          campaigns={[]}
          initial={{ assignee_id: person.id }}
          lockAssigneeTo={person.id}
          canSetCampaign={false}
          onSaved={(task) => void created(task)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}
