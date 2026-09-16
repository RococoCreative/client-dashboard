import type { DeliverableCategory, DeliverableTask, EmployeeDeliverable } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { companyOf } from "./profiles.ts";

const categories = fromAll((b) => b.deliverableCategories).map((x) => ({ ...x }));
const deliverables = fromAll((b) => b.deliverables).map((x) => ({ ...x }));
const tasks = fromAll((b) => b.deliverableTasks).map((x) => ({ ...x }));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-new-${++counter}`;
const now = () => new Date().toISOString();

function patchIn<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T {
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Not found.");
  list[index] = { ...list[index], ...patch };
  return list[index];
}

function removeFrom<T extends { id: string }>(list: T[], id: string): void {
  const index = list.findIndex((x) => x.id === id);
  if (index !== -1) list.splice(index, 1);
}

export async function listDeliverableCategories(companyId: string): Promise<DeliverableCategory[]> {
  return categories.filter((c) => c.company_id === companyId).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
export async function createDeliverableCategory(input: { company_id: string; name: string; sort_order?: number }): Promise<DeliverableCategory> {
  const created: DeliverableCategory = { id: nextId("dcat"), sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
  categories.push(created);
  return created;
}
export async function updateDeliverableCategory(id: string, patch: Partial<Pick<DeliverableCategory, "name" | "sort_order" | "is_active">>): Promise<DeliverableCategory> {
  return patchIn(categories, id, { ...patch, updated_at: now() });
}
export async function deleteDeliverableCategory(id: string): Promise<void> {
  // The database sets category_id to null rather than deleting the headings; so does this.
  for (const d of deliverables) if (d.category_id === id) d.category_id = null;
  removeFrom(categories, id);
}

export async function listEmployeeDeliverables(employeeId: string, year: number): Promise<EmployeeDeliverable[]> {
  return deliverables.filter((d) => d.employee_id === employeeId && d.year === year).sort((a, b) => a.sort_order - b.sort_order);
}
export async function createEmployeeDeliverable(input: {
  employee_id: string;
  category_id: string | null;
  year: number;
  name: string;
  sort_order?: number;
}): Promise<EmployeeDeliverable> {
  // inherit_company_from_employee takes the company from the person and refuses a person who has
  // not been placed with one. The mock does the same, so a page relying on it behaves here the way
  // it will in production rather than quietly inventing a company.
  const company = companyOf(input.employee_id);
  if (!company) throw new Error("This person is not placed with a company yet.");
  const created: EmployeeDeliverable = { id: nextId("deliv"), company_id: company, sort_order: 0, created_at: now(), updated_at: now(), ...input };
  deliverables.push(created);
  return created;
}
export async function updateEmployeeDeliverable(id: string, patch: Partial<Pick<EmployeeDeliverable, "name" | "category_id" | "sort_order">>): Promise<EmployeeDeliverable> {
  return patchIn(deliverables, id, { ...patch, updated_at: now() });
}
export async function deleteEmployeeDeliverable(id: string): Promise<void> {
  for (const t of tasks.filter((t) => t.deliverable_id === id)) removeFrom(tasks, t.id);
  removeFrom(deliverables, id);
}

export async function listDeliverableTasks(employeeId: string, year: number): Promise<DeliverableTask[]> {
  const own = new Set(deliverables.filter((d) => d.employee_id === employeeId && d.year === year).map((d) => d.id));
  return tasks.filter((t) => own.has(t.deliverable_id)).sort((a, b) => a.sort_order - b.sort_order);
}
export async function createDeliverableTask(input: {
  deliverable_id: string;
  name: string;
  note?: string | null;
  rating?: number | null;
  sort_order?: number;
}): Promise<DeliverableTask> {
  const parent = deliverables.find((d) => d.id === input.deliverable_id);
  if (!parent) throw new Error("That deliverable does not exist.");
  const created: DeliverableTask = {
    id: nextId("dtask"),
    company_id: parent.company_id,
    employee_id: parent.employee_id,
    note: null,
    rating: null,
    sort_order: 0,
    created_at: now(),
    updated_at: now(),
    ...input,
  };
  tasks.push(created);
  return created;
}
export async function updateDeliverableTask(id: string, patch: Partial<Pick<DeliverableTask, "name" | "note" | "rating" | "sort_order">>): Promise<DeliverableTask> {
  return patchIn(tasks, id, { ...patch, updated_at: now() });
}
export async function deleteDeliverableTask(id: string): Promise<void> {
  removeFrom(tasks, id);
}
