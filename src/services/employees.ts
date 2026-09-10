// Data layer for what an admin manages about one person beyond the profile row: personal
// KPIs for the year and the compensation table. Both live in their own tables so RLS can
// keep them to the person and their company's admins. Plain async functions that throw.
import { db } from "./supabase.ts";
import type { CompensationItem, EmployeeKpi } from "../types/database.ts";

const KPI_COLUMNS =
  "id, company_id, employee_id, year, name, target_display, current_display, target_numeric, current_numeric, is_hit, sort_order, created_at, updated_at";
const COMPENSATION_COLUMNS = "id, company_id, employee_id, name, annual_amount, note, sort_order, created_at, updated_at";

export async function listEmployeeKpis(companyId: string, employeeId: string, year: number): Promise<EmployeeKpi[]> {
  const { data, error } = await db()
    .from("employee_kpis")
    .select(KPI_COLUMNS)
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("year", year)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as EmployeeKpi[]) ?? [];
}

export type EmployeeKpiInput = Pick<EmployeeKpi, "company_id" | "employee_id" | "year" | "name"> &
  Partial<Pick<EmployeeKpi, "target_display" | "current_display" | "target_numeric" | "current_numeric" | "is_hit" | "sort_order">>;

export async function createEmployeeKpi(input: EmployeeKpiInput): Promise<EmployeeKpi> {
  const { data, error } = await db().from("employee_kpis").insert(input).select(KPI_COLUMNS).single();
  if (error) throw error;
  return data as EmployeeKpi;
}

export async function updateEmployeeKpi(id: string, patch: Partial<Omit<EmployeeKpiInput, "company_id" | "employee_id">>): Promise<EmployeeKpi> {
  const { data, error } = await db().from("employee_kpis").update(patch).eq("id", id).select(KPI_COLUMNS).single();
  if (error) throw error;
  return data as EmployeeKpi;
}

export async function deleteEmployeeKpi(id: string): Promise<void> {
  const { error } = await db().from("employee_kpis").delete().eq("id", id);
  if (error) throw error;
}

export async function listCompensation(companyId: string, employeeId: string): Promise<CompensationItem[]> {
  const { data, error } = await db()
    .from("compensation_items")
    .select(COMPENSATION_COLUMNS)
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return ((data as CompensationItem[]) ?? []).map((item) => ({ ...item, annual_amount: Number(item.annual_amount) }));
}

export type CompensationInput = Pick<CompensationItem, "company_id" | "employee_id" | "name"> &
  Partial<Pick<CompensationItem, "annual_amount" | "note" | "sort_order">>;

export async function createCompensationItem(input: CompensationInput): Promise<CompensationItem> {
  const { data, error } = await db().from("compensation_items").insert(input).select(COMPENSATION_COLUMNS).single();
  if (error) throw error;
  const item = data as CompensationItem;
  return { ...item, annual_amount: Number(item.annual_amount) };
}

export async function updateCompensationItem(id: string, patch: Partial<Omit<CompensationInput, "company_id" | "employee_id">>): Promise<CompensationItem> {
  const { data, error } = await db().from("compensation_items").update(patch).eq("id", id).select(COMPENSATION_COLUMNS).single();
  if (error) throw error;
  const item = data as CompensationItem;
  return { ...item, annual_amount: Number(item.annual_amount) };
}

export async function deleteCompensationItem(id: string): Promise<void> {
  const { error } = await db().from("compensation_items").delete().eq("id", id);
  if (error) throw error;
}
