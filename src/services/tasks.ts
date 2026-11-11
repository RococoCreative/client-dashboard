// Tasks a company assigns to its people, each with an ordered checklist of steps (0036). RLS
// decides who sees and changes what; the triggers own completion and recurrence, so every write
// here reads the whole task back and a page always shows what the database decided.
import type { Task, TaskPriority, TaskRecurrence, TaskStep, TaskWithSteps } from "../types/database.ts";
import { invokeFunction } from "./invoke.ts";
import { db } from "./supabase.ts";

const TASK_COLUMNS = "id, company_id, title, description, assignee_id, created_by, due_date, priority, recurrence, campaign_id, completed_at, completed_by, next_task_id, notified_assignee_id, created_at, updated_at";
const SELECT = `${TASK_COLUMNS}, steps:task_steps(id, task_id, company_id, title, sort_order, done_at)`;

function bySortOrder(a: TaskStep, b: TaskStep): number {
  return a.sort_order - b.sort_order || a.id.localeCompare(b.id);
}
function withOrderedSteps(row: TaskWithSteps): TaskWithSteps {
  return { ...row, steps: [...(row.steps ?? [])].sort(bySortOrder) };
}

export type TaskInput = {
  company_id: string;
  title: string;
  assignee_id: string | null;
  description?: string | null;
  due_date?: string | null;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence | null;
  campaign_id?: string | null;
  steps?: string[];
};
export type TaskPatch = Partial<Pick<Task, "title" | "description" | "assignee_id" | "due_date" | "priority" | "recurrence" | "campaign_id">>;

// Earliest due date first, undated last, then oldest created. Open only unless asked.
export async function listTasks(companyId: string, opts?: { assigneeId?: string; campaignId?: string; status?: "open" | "done" | "all" }): Promise<TaskWithSteps[]> {
  let query = db().from("tasks").select(SELECT).eq("company_id", companyId);
  if (opts?.assigneeId) query = query.eq("assignee_id", opts.assigneeId);
  if (opts?.campaignId) query = query.eq("campaign_id", opts.campaignId);
  const status = opts?.status ?? "open";
  if (status === "open") query = query.is("completed_at", null);
  if (status === "done") query = query.not("completed_at", "is", null);
  const { data, error } = await query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
  if (error) throw error;
  return ((data as unknown as TaskWithSteps[]) ?? []).map(withOrderedSteps);
}

export async function getTask(id: string): Promise<TaskWithSteps> {
  const { data, error } = await db().from("tasks").select(SELECT).eq("id", id).single();
  if (error) throw error;
  return withOrderedSteps(data as unknown as TaskWithSteps);
}

export async function countOpenTasks(companyId: string, assigneeId: string): Promise<number> {
  const { count, error } = await db()
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("assignee_id", assigneeId)
    .is("completed_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function createTask(input: TaskInput): Promise<TaskWithSteps> {
  const { steps, ...fields } = input;
  const { data, error } = await db().from("tasks").insert(fields).select("id").single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const titles = (steps ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (titles.length > 0) {
    const rows = titles.map((title, i) => ({ task_id: id, company_id: input.company_id, title, sort_order: i + 1 }));
    const { error: stepsError } = await db().from("task_steps").insert(rows);
    if (stepsError) throw stepsError;
  }
  return getTask(id);
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskWithSteps> {
  const { error } = await db().from("tasks").update(patch).eq("id", id).select("id").single();
  if (error) throw error;
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await db().from("tasks").delete().eq("id", id);
  if (error) throw error;
}

// A repeating task opens its next copy in the database when this lands.
export async function completeTask(id: string): Promise<TaskWithSteps> {
  return updateCompletion(id, new Date().toISOString());
}

export async function reopenTask(id: string): Promise<TaskWithSteps> {
  return updateCompletion(id, null);
}

async function updateCompletion(id: string, completedAt: string | null): Promise<TaskWithSteps> {
  const { error } = await db().from("tasks").update({ completed_at: completedAt }).eq("id", id).select("id").single();
  if (error) throw error;
  return getTask(id);
}

export async function addStep(taskId: string, title: string): Promise<TaskWithSteps> {
  const task = await getTask(taskId);
  const last = Math.max(0, ...task.steps.map((s) => s.sort_order));
  const { error } = await db().from("task_steps").insert({ task_id: taskId, company_id: task.company_id, title: title.trim(), sort_order: last + 1 });
  if (error) throw error;
  return getTask(taskId);
}

// Changes one step and reads its task back.
async function updateStep(stepId: string, patch: Partial<Pick<TaskStep, "title" | "sort_order" | "done_at">>): Promise<string> {
  const { data, error } = await db().from("task_steps").update(patch).eq("id", stepId).select("task_id").single();
  if (error) throw error;
  return (data as { task_id: string }).task_id;
}

export async function renameStep(stepId: string, title: string): Promise<TaskWithSteps> {
  return getTask(await updateStep(stepId, { title: title.trim() }));
}

// Ticking the last step completes the task and unticking one reopens it, by trigger.
export async function setStepDone(stepId: string, done: boolean): Promise<TaskWithSteps> {
  return getTask(await updateStep(stepId, { done_at: done ? new Date().toISOString() : null }));
}

// Swaps places with the step above or below; at either end nothing moves.
export async function moveStep(stepId: string, direction: "up" | "down"): Promise<TaskWithSteps> {
  const { data, error } = await db().from("task_steps").select("task_id").eq("id", stepId).single();
  if (error) throw error;
  const task = await getTask((data as { task_id: string }).task_id);
  const index = task.steps.findIndex((s) => s.id === stepId);
  const neighbor = task.steps[direction === "up" ? index - 1 : index + 1];
  if (index === -1 || !neighbor) return task;
  const current = task.steps[index];
  await updateStep(current.id, { sort_order: neighbor.sort_order });
  await updateStep(neighbor.id, { sort_order: current.sort_order });
  return getTask(task.id);
}

export async function removeStep(stepId: string): Promise<TaskWithSteps> {
  const { data, error } = await db().from("task_steps").delete().eq("id", stepId).select("task_id").single();
  if (error) throw error;
  return getTask((data as { task_id: string }).task_id);
}

// Asks the notify function to email the assignee. It decides whether one is due and never sends
// twice for the same assignment.
export async function notifyAssignment(taskId: string): Promise<{ sent: boolean }> {
  return invokeFunction<{ sent: boolean }>("notify", { task_id: taskId });
}
