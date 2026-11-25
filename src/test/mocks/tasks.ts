// The tasks service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/tasks.ts, and it plays the triggers of 0036 so a page sees what the database would
// decide: ticking the last step completes a task and unticking one reopens it, completing a
// repeating task opens one next copy dated forward from its due date past today in the company's
// own time zone (0037), a completed copy whose next one is open is locked, and deleting the open
// copy ends the series. tasks.test.ts pins all of it. It plays 0053 too: a task on an SOP needs a
// published SOP of its own company, and only the assignee's sign-off (or an admin) closes it.
import type { Task, TaskPriority, TaskRecurrence, TaskStep, TaskWithSteps } from "../../types/database.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { fromAll, personaFromLocation, personaIn } from "../fixtures.ts";
import { isCompanyAdminRole } from "../../lib/people.ts";
import { sopRow } from "./sops.ts";
import { signedSince } from "./sopSignoffs.ts";
import { clockNow } from "./clock.ts";
import { goalLinkProblem } from "./gsr.ts";
import { timeZoneOf } from "./companies.ts";
import { companyOf, onPersonDeleted } from "./profiles.ts";

const tasks: Task[] = fromAll((b) => b.tasks).map((x) => ({ ...x }));
const steps: TaskStep[] = fromAll((b) => b.taskSteps).map((x) => ({ ...x }));

// A deleted person's tasks stay, without their name (0049).
onPersonDeleted((profileId) => {
  for (const t of tasks) {
    // The goal link goes with the person it belonged to, as guard_task clears it (0039).
    if (t.assignee_id === profileId) {
      t.assignee_id = null;
      t.goal_id = null;
    }
    if (t.created_by === profileId) t.created_by = null;
    if (t.completed_by === profileId) t.completed_by = null;
    if (t.notified_assignee_id === profileId) t.notified_assignee_id = null;
  }
});

export type TaskInput = {
  company_id: string;
  title: string;
  assignee_id: string | null;
  description?: string | null;
  due_date?: string | null;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence | null;
  campaign_id?: string | null;
  goal_id?: string | null;
  sop_id?: string | null;
  steps?: string[];
};
export type TaskPatch = Partial<Pick<Task, "title" | "description" | "assignee_id" | "due_date" | "priority" | "recurrence" | "campaign_id" | "goal_id" | "sop_id">>;

const LOCKED = "The next one is already open.";
const DAYS: Partial<Record<TaskRecurrence, number>> = { daily: 1, weekly: 7, biweekly: 14 };
const MONTHS: Partial<Record<TaskRecurrence, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
let counter = 0;
const now = () => new Date().toISOString();
const me = () => personaFromLocation().profile.id;

function bySortOrder(a: TaskStep, b: TaskStep): number {
  return a.sort_order - b.sort_order || a.id.localeCompare(b.id);
}
// Earliest due date first, undated last, then oldest created: the order the service asks for.
function byDueThenCreated(a: Task, b: Task): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  return a.created_at.localeCompare(b.created_at);
}

function findTask(id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error("Task not found.");
  return task;
}
function findStep(id: string): TaskStep {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error("Step not found.");
  return step;
}
function read(task: Task): TaskWithSteps {
  return { ...task, steps: steps.filter((s) => s.task_id === task.id).sort(bySortOrder).map((s) => ({ ...s })) };
}

// Whether the acting person manages the company, as private.can_manage_company decides.
function canManage(companyId: string): boolean {
  const person = personaIn(companyId);
  return person.is_rococo_admin || isCompanyAdminRole(person.role);
}

// guard_task_sop (0053): the SOP must be here, the company's own, and published.
function checkSop(task: Pick<Task, "company_id" | "sop_id">, prevSopId: string | null): void {
  if (task.sop_id === null || task.sop_id === prevSopId) return;
  const sop = sopRow(task.sop_id);
  if (!sop) throw new Error("That SOP is not here any more.");
  if (sop.company_id !== task.company_id) throw new Error("That SOP belongs to another company.");
  if (sop.status !== "published") throw new Error("Only a published SOP can be assigned.");
}

// The checks the table constraints and guard_task make on any write.
function check(task: Pick<Task, "company_id" | "title" | "assignee_id" | "due_date" | "recurrence" | "goal_id">, prevGoalId: string | null = null): void {
  if (task.title.trim() === "") throw new Error("A task needs a title.");
  if (task.recurrence !== null && task.due_date === null) throw new Error("A repeating task needs a due date.");
  if (task.assignee_id !== null) {
    const company = companyOf(task.assignee_id);
    if (company !== null && company !== task.company_id) throw new Error("That person belongs to another company.");
  }
  // guard_task (0039): linking checks the goal; an unchanged link only checks that its person
  // still matches the assignee, and unlinking always passes.
  if (task.goal_id !== null) {
    const problem = goalLinkProblem(task);
    const onlyFrozen = problem !== null && problem.startsWith("That month is closed");
    if (problem && !(onlyFrozen && task.goal_id === prevGoalId)) throw new Error(problem);
  }
}
// guard_task_step: a completed copy whose next one is open keeps its steps as they are.
function assertUnlocked(task: Task): void {
  if (task.next_task_id !== null) throw new Error(LOCKED);
}

// Date-only arithmetic in UTC, so the local time zone never shifts a day. Months clamp to the
// last day of a shorter month, as Postgres date + interval does.
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
}
function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))));
}

// Today's date (YYYY-MM-DD) in a named time zone: the (now() at time zone tz)::date of 0037.
function todayIn(timeZone: string): string {
  const fields = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => fields.find((f) => f.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// recur_task: whole intervals forward from the due date until the date falls after today, where
// today is the day in the task's company time zone, not the browser's or UTC's.
function nextDueDate(task: Task): string {
  const from = task.due_date!;
  const today = todayIn(timeZoneOf(task.company_id));
  const days = DAYS[task.recurrence!];
  if (days !== undefined) {
    const [fy, fm, fd] = parts(from);
    const [ty, tm, td] = parts(today);
    const elapsed = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
    return addDays(from, Math.max(1, Math.trunc(elapsed / days) + 1) * days);
  }
  const months = MONTHS[task.recurrence!] ?? 12;
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(today);
  let n = Math.max(1, Math.trunc(((ty - fy) * 12 + tm - fm - 1) / months));
  let due = addMonths(from, n * months);
  while (due <= today) due = addMonths(from, ++n * months);
  return due;
}

function recur(task: Task): void {
  const next: Task = {
    id: `task-new-${++counter}`,
    company_id: task.company_id,
    title: task.title,
    description: task.description,
    assignee_id: task.assignee_id,
    created_by: task.created_by,
    due_date: nextDueDate(task),
    priority: task.priority,
    recurrence: task.recurrence,
    campaign_id: task.campaign_id,
    // A new copy belongs to a later month, so it does not carry the goal link (0039).
    goal_id: null,
    // It keeps its SOP while that SOP is still published (0053).
    sop_id: task.sop_id && sopRow(task.sop_id)?.status === "published" ? task.sop_id : null,
    assigned_at: clockNow(),
    completed_at: null,
    completed_by: null,
    next_task_id: null,
    notified_assignee_id: task.assignee_id,
    created_at: now(),
    updated_at: now(),
  };
  tasks.push(next);
  steps
    .filter((s) => s.task_id === task.id)
    .sort(bySortOrder)
    .forEach((s) => steps.push({ id: `task-step-new-${++counter}`, task_id: next.id, company_id: next.company_id, title: s.title, sort_order: s.sort_order, done_at: null }));
  task.next_task_id = next.id;
}

// What an update of completed_at does: the guard refuses to reopen a locked copy and stamps who
// completed it; completing a repeating task that has no next copy yet opens one.
// internal: a write the database makes itself (a step ticked, a sign-off), not a person's.
function setCompletion(task: Task, completedAt: string | null, internal = false, by?: string): void {
  const wasOpen = task.completed_at === null;
  if (wasOpen && completedAt !== null && task.sop_id !== null) {
    const signed = task.assignee_id !== null && signedSince(task.sop_id, task.assignee_id, task.assigned_at);
    if (!signed) {
      // Ticking every step does not finish an SOP task; the sign-off does.
      if (internal) return;
      if (!canManage(task.company_id)) throw new Error("This task finishes when the SOP is signed off.");
    }
  }
  if (!wasOpen && completedAt === null) assertUnlocked(task);
  task.completed_at = completedAt;
  if (completedAt === null) task.completed_by = null;
  else if (wasOpen) task.completed_by = by ?? me();
  task.updated_at = now();
  if (wasOpen && completedAt !== null && task.recurrence !== null && task.next_task_id === null) recur(task);
}

export async function listTasks(companyId: string, opts?: { assigneeId?: string; campaignId?: string; status?: "open" | "done" | "all" }): Promise<TaskWithSteps[]> {
  const status = opts?.status ?? "open";
  return tasks
    .filter((t) => t.company_id === companyId)
    .filter((t) => !opts?.assigneeId || t.assignee_id === opts.assigneeId)
    .filter((t) => !opts?.campaignId || t.campaign_id === opts.campaignId)
    .filter((t) => status === "all" || (status === "open") === (t.completed_at === null))
    .sort(byDueThenCreated)
    .map(read);
}

export async function getTask(id: string): Promise<TaskWithSteps> {
  return read(findTask(id));
}

export async function countOpenTasks(companyId: string, assigneeId: string): Promise<number> {
  return tasks.filter((t) => t.company_id === companyId && t.assignee_id === assigneeId && t.completed_at === null).length;
}

export async function createTask(input: TaskInput): Promise<TaskWithSteps> {
  const created: Task = {
    id: `task-new-${++counter}`,
    company_id: input.company_id,
    title: input.title,
    description: input.description ?? null,
    assignee_id: input.assignee_id,
    created_by: me(),
    due_date: input.due_date ?? null,
    priority: input.priority ?? "medium",
    recurrence: input.recurrence ?? null,
    campaign_id: input.campaign_id ?? null,
    goal_id: input.goal_id ?? null,
    sop_id: input.sop_id ?? null,
    assigned_at: clockNow(),
    completed_at: null,
    completed_by: null,
    next_task_id: null,
    notified_assignee_id: null,
    created_at: now(),
    updated_at: now(),
  };
  check(created);
  checkSop(created, null);
  tasks.push(created);
  (input.steps ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .forEach((title, i) => steps.push({ id: `task-step-new-${++counter}`, task_id: created.id, company_id: created.company_id, title, sort_order: i + 1, done_at: null }));
  return read(created);
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskWithSteps> {
  const task = findTask(id);
  const { title, description, assignee_id, due_date, priority, recurrence, campaign_id, goal_id, sop_id } = { ...task, ...patch };
  const next = { ...task, title, description, assignee_id, due_date, priority, recurrence, campaign_id, goal_id, sop_id };
  check(next, task.goal_id);
  if (sop_id !== task.sop_id && !canManage(task.company_id) && task.created_by !== me()) {
    throw new Error("Only the person who assigned this task can change its SOP.");
  }
  checkSop(next, task.sop_id);
  // guard_task_sop (0053): a new person or a new SOP is a new assignment.
  if (next.assignee_id !== task.assignee_id || next.sop_id !== task.sop_id) next.assigned_at = clockNow();
  Object.assign(task, next, { updated_at: now() });
  return read(task);
}

// Every task on one SOP, newest first.
export async function listTasksForSop(companyId: string, sopId: string): Promise<TaskWithSteps[]> {
  return tasks
    .filter((t) => t.company_id === companyId && t.sop_id === sopId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(read);
}

// close_tasks_on_signoff (0053): the person's open tasks on the SOP assigned at or before it.
export function closeTasksOnSignoff(sopId: string, profileId: string, signedAt: string): void {
  for (const task of tasks) {
    if (task.sop_id === sopId && task.assignee_id === profileId && task.completed_at === null && task.assigned_at <= signedAt) {
      setCompletion(task, signedAt, true, profileId);
    }
  }
}

// Whether a task on this SOP was assigned to the person after a moment and is still open.
export function openSopTaskSince(sopId: string, profileId: string, since: string): boolean {
  return tasks.some((t) => t.sop_id === sopId && t.assignee_id === profileId && t.completed_at === null && t.assigned_at > since);
}

// Deleting the open copy of a series ends the series on the copy before it.
export async function listTasksForGoals(companyId: string, goalIds: readonly string[]): Promise<TaskWithSteps[]> {
  const wanted = new Set(goalIds);
  return tasks
    .filter((t) => t.company_id === companyId && t.goal_id !== null && wanted.has(t.goal_id))
    .sort(byDueThenCreated)
    .map(read);
}

export async function linkTaskToGoal(taskId: string, goalId: string | null): Promise<TaskWithSteps> {
  return updateTask(taskId, { goal_id: goalId });
}

export async function deleteTask(id: string): Promise<void> {
  if (!tasks.some((t) => t.id === id)) throw new Error(NOT_CHANGED_MESSAGE);
  tasks.splice(tasks.findIndex((t) => t.id === id), 1);
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].task_id === id) steps.splice(i, 1);
  for (const t of tasks) {
    if (t.next_task_id === id) Object.assign(t, { next_task_id: null, recurrence: null, updated_at: now() });
  }
}

export async function completeTask(id: string): Promise<TaskWithSteps> {
  const task = findTask(id);
  setCompletion(task, now());
  return read(task);
}

export async function reopenTask(id: string): Promise<TaskWithSteps> {
  const task = findTask(id);
  setCompletion(task, null);
  return read(task);
}

export async function addStep(taskId: string, title: string): Promise<TaskWithSteps> {
  const task = findTask(taskId);
  assertUnlocked(task);
  if (title.trim() === "") throw new Error("A step needs a title.");
  const last = Math.max(0, ...steps.filter((s) => s.task_id === taskId).map((s) => s.sort_order));
  steps.push({ id: `task-step-new-${++counter}`, task_id: taskId, company_id: task.company_id, title: title.trim(), sort_order: last + 1, done_at: null });
  return read(task);
}

export async function renameStep(stepId: string, title: string): Promise<TaskWithSteps> {
  const step = findStep(stepId);
  const task = findTask(step.task_id);
  assertUnlocked(task);
  if (title.trim() === "") throw new Error("A step needs a title.");
  step.title = title.trim();
  return read(task);
}

// sync_task_completion: ticking the last unticked step completes the task; unticking reopens it.
export async function setStepDone(stepId: string, done: boolean): Promise<TaskWithSteps> {
  const step = findStep(stepId);
  const task = findTask(step.task_id);
  assertUnlocked(task);
  const wasDone = step.done_at !== null;
  step.done_at = done ? now() : null;
  if (!wasDone && done) {
    const allDone = steps.every((s) => s.task_id !== task.id || s.done_at !== null);
    if (allDone && task.completed_at === null) setCompletion(task, now(), true);
  } else if (wasDone && !done && task.completed_at !== null) {
    setCompletion(task, null);
  }
  return read(task);
}

export async function moveStep(stepId: string, direction: "up" | "down"): Promise<TaskWithSteps> {
  const step = findStep(stepId);
  const task = findTask(step.task_id);
  const ordered = steps.filter((s) => s.task_id === task.id).sort(bySortOrder);
  const index = ordered.indexOf(step);
  const neighbor = ordered[direction === "up" ? index - 1 : index + 1];
  if (!neighbor) return read(task);
  assertUnlocked(task);
  [step.sort_order, neighbor.sort_order] = [neighbor.sort_order, step.sort_order];
  return read(task);
}

export async function removeStep(stepId: string): Promise<TaskWithSteps> {
  const step = findStep(stepId);
  const task = findTask(step.task_id);
  assertUnlocked(task);
  steps.splice(steps.indexOf(step), 1);
  return read(task);
}

export async function notifyAssignment(taskId: string): Promise<{ sent: boolean }> {
  findTask(taskId);
  return { sent: true };
}
