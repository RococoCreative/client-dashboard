// A person's tasks on their person page, for an admin or a manager reading it: their open tasks,
// earliest due first, then their most recent finished ones folded away under "Done (N)", each
// linking to the task and back here. A task that serves one of their monthly GSR goals says which
// month. Whoever may assign this person work (an admin, or someone who leads them) adds a task here
// with the person already filled in, and the new task shows at once. It loads its own rows, and the
// page renders it only when the company has the tasks module, so a company without it asks for
// nothing. Someone who has not signed in yet has their tasks here too: tasks attach to the person,
// never to an account, and adding one for them says plainly that no email went. On the person's
// Overview it shows only the next few open tasks, with a link to the rest on their Tasks tab.
// Home shows the signed-in person their own next few the same way (self), coming back to Home, and
// with none open it is one quiet line rather than a card.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import TaskForm from "./TaskForm.tsx";
import TaskRow, { type TaskBackState } from "./TaskRow.tsx";
import { sendAssignmentEmail } from "./assignmentEmail.ts";
import { metaClass, secondaryClass } from "../ui/type.ts";
import { tapTargetClass } from "../ui/tap.ts";
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
  limit,
  moreHref,
  backTo,
  backLabel,
  self = false,
}: {
  companyId: string;
  person: Profile;
  // The viewer may assign this person work: an admin, or someone who leads them.
  canAdd?: boolean;
  viewerProfileId?: string | null;
  // How a task's GSR goal reads ("September 2026 GSR"), or null when the goal is not known here.
  goalLabel?: (goalId: string) => string | null;
  // Show only this many open tasks and leave the finished ones off, for a short summary.
  limit?: number;
  // Where all of them are, offered as "All tasks".
  moreHref?: string;
  // Where a task opened from here goes back to. Defaults to the person's Overview.
  backTo?: string;
  // What the way back is called. Defaults to the person's name.
  backLabel?: string;
  // The viewer is this person (Home): the copy speaks to them, and with nothing open the block is
  // one quiet line instead of a card.
  self?: boolean;
}) {
  // A short summary leaves finished tasks off, so it asks for open ones only: the same read as the
  // viewer's own list on Tasks.
  const status = limit === undefined ? "all" : "open";
  const state = useAsync(() => listTasks(companyId, { assigneeId: person.id, status }), [companyId, person.id, status]);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [notice, setNotice] = useState("");
  const today = todayIso();
  const name = displayName(person);
  const back: TaskBackState = { from: { to: backTo ?? `/people/${person.id}`, label: backLabel ?? name } };
  const all = state.data ?? [];
  const allOpen = sortTasks(all.filter((t) => !isDone(t)));
  const open = limit === undefined ? allOpen : allOpen.slice(0, limit);
  const done = limit !== undefined ? [] : all.filter(isDone).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const recentDone = done.slice(0, RECENT_DONE);

  const noteFor = (task: TaskWithSteps): string | null => (task.goal_id ? (goalLabel?.(task.goal_id) ?? "On a GSR goal") : null);

  async function created(task: TaskWithSteps) {
    setAdding(false);
    // Only this person's tasks belong here; the form is fixed to them, so this is a guard, not a filter.
    if (task.assignee_id === person.id) state.setData((prev) => (prev ? [...prev.filter((t) => t.id !== task.id), task] : [task]));
    setNotice(await sendAssignmentEmail(undefined, task, viewerProfileId, person));
  }

  const add = canAdd ? (
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
  ) : null;
  const action =
    add || moreHref ? (
      <>
        {moreHref ? (
          <Link to={moreHref} className={`text-link text-[13px] font-medium hover:underline ${tapTargetClass}`}>
            All tasks
          </Link>
        ) : null}
        {add}
      </>
    ) : undefined;

  if (self && state.data && allOpen.length === 0 && !adding && !notice) {
    return (
      <p className={secondaryClass}>
        You have no open tasks.{" "}
        {moreHref ? (
          <Link to={moreHref} className="text-link hover:underline">
            All tasks
          </Link>
        ) : null}
      </p>
    );
  }

  return (
    <Section
      title={self ? "Your tasks" : "Tasks"}
      description={
        limit !== undefined && state.data && allOpen.length > open.length
          ? `The next ${open.length} of ${allOpen.length} open tasks, earliest due first.`
          : self
            ? "Your open tasks, earliest due first."
            : "Open tasks assigned to this person, earliest due first."
      }
      padded={false}
      actions={action}
    >
      {notice ? <div className="px-4 pt-4 sm:px-6"><Notice tone="warning">{notice}</Notice></div> : null}
      {state.error && !state.data ? (
        <div className="p-4 sm:p-6"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-4 sm:p-6"><SkeletonRows rows={2} /></div>
      ) : (
        <>
          {open.length === 0 ? (
            <p className={`px-4 py-4 sm:px-6 ${metaClass}`}>No open tasks.</p>
          ) : (
            <ul aria-label={self ? "Your open tasks" : `Open tasks for ${name}`} className="divide-y divide-line">
              {open.map((task) => (
                <TaskRow key={task.id} task={task} assigneeName={name} today={today} showAssignee={false} note={noteFor(task)} linkState={back} />
              ))}
            </ul>
          )}
          {done.length > 0 ? (
            <div className="border-t border-line px-4 py-2 sm:px-6">
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
                <p className={`border-t border-line px-4 py-2.5 sm:px-6 ${metaClass}`}>
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
