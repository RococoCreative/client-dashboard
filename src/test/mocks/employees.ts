import type { CompensationItem, EmployeeKpi } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const kpis = fromAll((b) => b.kpis).map((x) => ({ ...x }));
const compensation = fromAll((b) => b.compensation).map((x) => ({ ...x }));

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

export async function listEmployeeKpis(companyId: string, employeeId: string, year: number): Promise<EmployeeKpi[]> {
  return kpis.filter((k) => k.company_id === companyId && k.employee_id === employeeId && k.year === year).sort((a, b) => a.sort_order - b.sort_order);
}
export type EmployeeKpiInput = Pick<EmployeeKpi, "company_id" | "employee_id" | "year" | "name"> & Partial<Pick<EmployeeKpi, "target_display" | "current_display" | "target_numeric" | "current_numeric" | "is_hit" | "sort_order">>;
export async function createEmployeeKpi(input: EmployeeKpiInput): Promise<EmployeeKpi> {
  const created: EmployeeKpi = { id: nextId("kpi"), target_display: null, current_display: null, target_numeric: null, current_numeric: null, is_hit: false, sort_order: 0, created_at: now(), updated_at: now(), ...input };
  kpis.push(created);
  return created;
}
export async function updateEmployeeKpi(id: string, patch: Partial<Omit<EmployeeKpiInput, "company_id" | "employee_id">>): Promise<EmployeeKpi> {
  return patchIn(kpis, id, { ...patch, updated_at: now() } as Partial<EmployeeKpi>);
}
export async function deleteEmployeeKpi(id: string): Promise<void> {
  removeFrom(kpis, id);
}

export async function listCompensation(companyId: string, employeeId: string): Promise<CompensationItem[]> {
  return compensation.filter((c) => c.company_id === companyId && c.employee_id === employeeId).sort((a, b) => a.sort_order - b.sort_order);
}
export type CompensationInput = Pick<CompensationItem, "company_id" | "employee_id" | "name"> & Partial<Pick<CompensationItem, "annual_amount" | "note" | "sort_order">>;
export async function createCompensationItem(input: CompensationInput): Promise<CompensationItem> {
  const created: CompensationItem = { id: nextId("comp"), annual_amount: 0, note: null, sort_order: 0, created_at: now(), updated_at: now(), ...input };
  compensation.push(created);
  return created;
}
export async function updateCompensationItem(id: string, patch: Partial<Omit<CompensationInput, "company_id" | "employee_id">>): Promise<CompensationItem> {
  return patchIn(compensation, id, { ...patch, updated_at: now() } as Partial<CompensationItem>);
}
export async function deleteCompensationItem(id: string): Promise<void> {
  removeFrom(compensation, id);
}
