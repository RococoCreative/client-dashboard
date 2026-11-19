// One task in a list, linking to its own page. It reads the way a person scans a to-do list: the
// title, then who it is for (when the list spans people), when it is due, whether it repeats, how
// far along its steps are, its priority, and a mark when it is overdue or done. A list that knows
// more about a task (the GSR month it serves, on a person page) passes it as a note, and a list
// that wants the task page to lead back to it passes where back is as link state. On a phone every
// row reads the same way: the title at full width, then the meta with the badges on its line.
import { Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import Badge, { type BadgeTone } from "../ui/Badge.tsx";
import { itemTitleClass, itemTitleSizeClass } from "../ui/type.ts";
import { formatDate } from "../../lib/format.ts";
import { PRIORITY_LABELS, RECURRENCE_LABELS, isDone, isOverdue, percentComplete } from "../../lib/tasks.ts";
import type { TaskPriority, TaskWithSteps } from "../../types/database.ts";

const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = { high: "warning", medium: "neutral", low: "neutral" };

function Dot() {
  return <span className="text-ink-3" aria-hidden>·</span>;
}

// A done task's title: the item title's size in the secondary ink, composed rather than stacked on
// the ink, so which colour wins never depends on stylesheet order.
const DONE_TITLE = `${itemTitleSizeClass} text-ink-2`;

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
      <Link to={`/tasks/${task.id}`} state={linkState} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-surface-2/60 sm:gap-y-1.5 sm:px-6">
        {/* Below sm this box steps aside (contents), so the title, the meta and the badges share the
            row's own line wrapping: the title takes a full line and the badges follow the meta. */}
        <div className="min-w-0 flex-1 basis-40 max-sm:contents">
          <p className={`line-clamp-2 break-words max-sm:basis-full sm:line-clamp-1 sm:truncate ${done ? `${DONE_TITLE} line-through` : itemTitleClass}`}>{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-2 max-sm:mt-0 max-sm:min-w-0 max-sm:flex-1">
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
