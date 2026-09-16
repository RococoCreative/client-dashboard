// Data layer for deliverables: the categories a company defines, the headings each person
// carries for the year, and the support tasks the rating actually sits on. Three tables because
// the shape is three levels deep; the database derives company and person on the child rows, so
// nothing here sends them. Plain async functions that throw.
import { db } from "./supabase.ts";
import type { DeliverableCategory, DeliverableTask, EmployeeDeliverable } from "../types/database.ts";

const CATEGORY_COLUMNS = "id, company_id, name, sort_order, is_active, created_at, updated_at";
const DELIVERABLE_COLUMNS = "id, company_id, employee_id, category_id, year, name, sort_order, created_at, updated_at";
const TASK_COLUMNS = "id, company_id, employee_id, deliverable_id, name, note, rating, sort_order, created_at, updated_at";

export async function listDeliverableCategories(companyId: string): Promise<DeliverableCategory[]> {
  const { data, error } = await db()
    .from("deliverable_categories")
    .select(CATEGORY_COLUMNS)
    .eq("company_id", companyId)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data as DeliverableCategory[]) ?? [];
}

export async function createDeliverableCategory(input: {
  company_id: string;
  name: string;
  sort_order?: number;
}): Promise<DeliverableCategory> {
  const { data, error } = await db().from("deliverable_categories").insert(input).select(CATEGORY_COLUMNS).single();
  if (error) throw error;
  return data as DeliverableCategory;
}

export async function updateDeliverableCategory(
  id: string,
  patch: Partial<Pick<DeliverableCategory, "name" | "sort_order" | "is_active">>,
): Promise<DeliverableCategory> {
  const { data, error } = await db().from("deliverable_categories").update(patch).eq("id", id).select(CATEGORY_COLUMNS).single();
  if (error) throw error;
  return data as DeliverableCategory;
}

export async function deleteDeliverableCategory(id: string): Promise<void> {
  const { error } = await db().from("deliverable_categories").delete().eq("id", id);
  if (error) throw error;
}

export async function listEmployeeDeliverables(employeeId: string, year: number): Promise<EmployeeDeliverable[]> {
  const { data, error } = await db()
    .from("employee_deliverables")
    .select(DELIVERABLE_COLUMNS)
    .eq("employee_id", employeeId)
    .eq("year", year)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as EmployeeDeliverable[]) ?? [];
}

// company_id is left off on purpose: a trigger takes it from the person, so it cannot be forged.
export async function createEmployeeDeliverable(input: {
  employee_id: string;
  category_id: string | null;
  year: number;
  name: string;
  sort_order?: number;
}): Promise<EmployeeDeliverable> {
  const { data, error } = await db().from("employee_deliverables").insert(input).select(DELIVERABLE_COLUMNS).single();
  if (error) throw error;
  return data as EmployeeDeliverable;
}

export async function updateEmployeeDeliverable(
  id: string,
  patch: Partial<Pick<EmployeeDeliverable, "name" | "category_id" | "sort_order">>,
): Promise<EmployeeDeliverable> {
  const { data, error } = await db().from("employee_deliverables").update(patch).eq("id", id).select(DELIVERABLE_COLUMNS).single();
  if (error) throw error;
  return data as EmployeeDeliverable;
}

export async function deleteEmployeeDeliverable(id: string): Promise<void> {
  const { error } = await db().from("employee_deliverables").delete().eq("id", id);
  if (error) throw error;
}

export async function listDeliverableTasks(employeeId: string, year: number): Promise<DeliverableTask[]> {
  // Tasks carry the person, so one query covers every heading on the page rather than one per
  // deliverable. The year lives on the parent, so it is filtered through the relationship.
  const { data, error } = await db()
    .from("deliverable_tasks")
    .select(`${TASK_COLUMNS}, employee_deliverables!inner(year)`)
    .eq("employee_id", employeeId)
    .eq("employee_deliverables.year", year)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  // The join is only there to filter by the parent's year; it must not reach the caller.
  return ((data as Array<DeliverableTask & { employee_deliverables?: unknown }>) ?? []).map((row) => {
    const task = { ...row };
    delete task.employee_deliverables;
    return task as DeliverableTask;
  });
}

// company_id and employee_id are both left off: a trigger takes them from the deliverable, so a
// task can never belong to a different person from the heading it sits under.
export async function createDeliverableTask(input: {
  deliverable_id: string;
  name: string;
  note?: string | null;
  rating?: number | null;
  sort_order?: number;
}): Promise<DeliverableTask> {
  const { data, error } = await db().from("deliverable_tasks").insert(input).select(TASK_COLUMNS).single();
  if (error) throw error;
  return data as DeliverableTask;
}

export async function updateDeliverableTask(
  id: string,
  patch: Partial<Pick<DeliverableTask, "name" | "note" | "rating" | "sort_order">>,
): Promise<DeliverableTask> {
  const { data, error } = await db().from("deliverable_tasks").update(patch).eq("id", id).select(TASK_COLUMNS).single();
  if (error) throw error;
  return data as DeliverableTask;
}

export async function deleteDeliverableTask(id: string): Promise<void> {
  const { error } = await db().from("deliverable_tasks").delete().eq("id", id);
  if (error) throw error;
}
