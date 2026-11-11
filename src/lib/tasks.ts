// The task display rules the Tasks pages share, kept pure so they are tested in one place.
// The database owns completion and recurrence; this file only computes what a screen shows:
// labels, step progress, overdue, the order a list is read in, the lock, who may edit, and when a
// save asks for the assignment email.
import type { Task, TaskPriority, TaskRecurrence, TaskStep } from "../types/database.ts";

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

// Whole-number percent of steps done; null when a task has no steps.
export function percentComplete(steps: Pick<TaskStep, "done_at">[]): number | null {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.done_at !== null).length;
  return Math.round((done / steps.length) * 100);
}

export function isDone(task: Pick<Task, "completed_at">): boolean {
  return task.completed_at !== null;
}

// today is YYYY-MM-DD; date-only strings compare correctly as text. Due today is not overdue.
export function isOverdue(task: Pick<Task, "due_date" | "completed_at">, today: string): boolean {
  return !isDone(task) && task.due_date !== null && task.due_date < today;
}

// Earliest due date first, undated last; on a tie high, medium, low; then oldest created first.
export function sortTasks<T extends Pick<Task, "due_date" | "priority" | "created_at">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date.localeCompare(b.due_date);
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at);
  });
}

// How a list of tasks is read: open ones in the order they are worked (sortTasks), then finished
// ones, most recently finished first.
export function readingOrder<T extends Pick<Task, "due_date" | "priority" | "created_at" | "completed_at">>(tasks: T[]): T[] {
  const open = sortTasks(tasks.filter((t) => !isDone(t)));
  const done = tasks.filter(isDone).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return [...open, ...done];
}

// A task that has spawned its next occurrence is read-only.
export function isLocked(task: Pick<Task, "next_task_id">): boolean {
  return task.next_task_id !== null;
}

export function canEditTask(
  task: Pick<Task, "created_by" | "assignee_id">,
  me: { profileId: string; isAdmin: boolean },
): boolean {
  // An employee edits only tasks they made for themselves; an admin edits any.
  return me.isAdmin || (task.created_by === me.profileId && task.assignee_id === me.profileId);
}

export function campaignProgress(tasks: Pick<Task, "completed_at">[]): { done: number; total: number } {
  return { done: tasks.filter(isDone).length, total: tasks.length };
}

// The one line a page shows when a task saved but its assignment email did not.
export const EMAIL_NOT_SENT = "The task was saved. The email did not send.";

// Whether a save asks for the assignment email: the task is now someone's, that someone is not the
// person saving, and on an edit the assignee changed. previous is undefined for a new task. The
// Edge Function makes the final call (an account, active, not already told); this only keeps a
// page from asking when it plainly should not.
export function shouldNotifyAssignee(
  previousAssigneeId: string | null | undefined,
  savedAssigneeId: string | null,
  viewerProfileId: string | null,
): boolean {
  return savedAssigneeId !== null && savedAssigneeId !== viewerProfileId && savedAssigneeId !== previousAssigneeId;
}
