// Data layer for financial snapshots. Admin-only by RLS. upsertSnapshots is what the CSV
// import calls: the unique (company, period type, period start) key means re-uploading a
// corrected export overwrites the same rows instead of duplicating them.
import { db } from "./supabase.ts";
import type { FinancialSnapshot, PeriodType, SnapshotSource } from "../types/database.ts";

const COLUMNS =
  "id, company_id, period_type, period_start, period_end, revenue, cogs, opex, net_profit, cash_on_hand, notes, source, created_by, created_at, updated_at";

export async function listSnapshots(companyId: string): Promise<FinancialSnapshot[]> {
  const { data, error } = await db()
    .from("financial_snapshots")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data as FinancialSnapshot[]) ?? [];
}

export type SnapshotInput = {
  company_id: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  opex: number;
  net_profit?: number | null;
  cash_on_hand?: number | null;
  notes?: string | null;
  source?: SnapshotSource;
};

export async function createSnapshot(input: SnapshotInput): Promise<FinancialSnapshot> {
  const { data, error } = await db().from("financial_snapshots").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as FinancialSnapshot;
}

export async function updateSnapshot(id: string, patch: Partial<Omit<SnapshotInput, "company_id">>): Promise<FinancialSnapshot> {
  const { data, error } = await db().from("financial_snapshots").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as FinancialSnapshot;
}

export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await db().from("financial_snapshots").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertSnapshots(rows: SnapshotInput[]): Promise<FinancialSnapshot[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db()
    .from("financial_snapshots")
    .upsert(rows, { onConflict: "company_id,period_type,period_start" })
    .select(COLUMNS);
  if (error) throw error;
  return (data as FinancialSnapshot[]) ?? [];
}
