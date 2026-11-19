// One task in a list, linking to its own page. It reads the way a person scans a to-do list: the
// title, then who it is for (when the list spans people), when it is due, whether it repeats, how
// far along its steps are, its priority, and a mark when it is overdue or done. A list that knows
// more about a task (the GSR month it serves, on a person page) passes it as a note, and a list
// that wants the task page to lead back to it passes where back is as link state.
import { Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import Badge, { type BadgeTone } from "../ui/Badge.tsx";
import { formatDate } from "../../lib/format.ts";
import { PRIORITY_LABELS, RECURRENCE_LABELS, isDone, isOverdue, percentComplete } from "../../lib/tasks.ts";
import type { TaskPriority, TaskWithSteps } from "../../types/database.ts";

const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = { high: "warning", medium: "neutral", low: "neutral" };

function Dot() {
  return <span className="text-ink-3" aria-hidden>·</span>;
}

// What a task page reads to send the person back where they came from.
export type TaskBackState = { from: { to: string; label: string } };

export default function TaskRow({
  task,
  assigneeName,
  today,
  showAssignee,
  note,
  linkState,
}: {
  task: TaskWithSteps;
  assigneeName: string | null;
  today: string;
  showAssignee: boolean;
  note?: string | null;
  linkState?: TaskBackState;
}) {
  const done = isDone(task);
  const overdue = isOverdue(task, today);
  const percent = percentComplete(task.steps);
  const who = task.assignee_id === null ? "Unassigned" : assigneeName;
  return (
    <li>
      <Link to={`/tasks/${task.id}`} state={linkState} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
        <div className="min-w-0 flex-1 basis-40">
          <p className={`line-clamp-2 break-words text-[15px] leading-snug sm:line-clamp-1 sm:truncate font-medium ${done ? "text-ink-2 line-through" : "text-ink"}`}>{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-2">
            {showAssignee && who ? (
              <>
                <span>{who}</span>
                <Dot />
              </>
            ) : null}
            <span className={`whitespace-nowrap ${overdue ? "text-danger" : ""}`}>{task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}</span>
            {task.recurrence ? (
              <>
                <Dot />
                <span className="inline-flex items-center gap-1">
                  <Repeat size={12} aria-hidden />
                  {RECURRENCE_LABELS[task.recurrence]}
                </span>
              </>
            ) : null}
            {note ? (
              <>
                <Dot />
                <span>{note}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {percent !== null ? <span className="text-[12px] tabular-nums text-ink-2" title="Steps done">{percent}%</span> : null}
          <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
          {done ? <Badge tone="success">Done</Badge> : null}
        </div>
      </Link>
    </li>
  );
}
