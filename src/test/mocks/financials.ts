import type { FinancialSnapshot, PeriodType, SnapshotSource } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const snapshots = fromAll((b) => b.snapshots).map((x) => ({ ...x }));
let counter = 0;
const now = () => new Date().toISOString();

export type SnapshotInput = { company_id: string; period_type: PeriodType; period_start: string; period_end: string; revenue: number; cogs: number; opex: number; net_profit?: number | null; cash_on_hand?: number | null; notes?: string | null; source?: SnapshotSource };

export async function listSnapshots(companyId: string): Promise<FinancialSnapshot[]> {
  return snapshots.filter((s) => s.company_id === companyId).sort((a, b) => b.period_start.localeCompare(a.period_start));
}
export async function createSnapshot(input: SnapshotInput): Promise<FinancialSnapshot> {
  const created: FinancialSnapshot = { id: `snapshot-new-${++counter}`, net_profit: null, cash_on_hand: null, notes: null, source: "manual", created_by: null, created_at: now(), updated_at: now(), ...input };
  snapshots.push(created);
  return created;
}
export async function updateSnapshot(id: string, patch: Partial<Omit<SnapshotInput, "company_id">>): Promise<FinancialSnapshot> {
  const index = snapshots.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("Snapshot not found.");
  snapshots[index] = { ...snapshots[index], ...patch, updated_at: now() } as FinancialSnapshot;
  return snapshots[index];
}
export async function deleteSnapshot(id: string): Promise<void> {
  const index = snapshots.findIndex((s) => s.id === id);
  if (index !== -1) snapshots.splice(index, 1);
}
export async function upsertSnapshots(rows: SnapshotInput[]): Promise<FinancialSnapshot[]> {
  const saved: FinancialSnapshot[] = [];
  for (const row of rows) {
    const existing = snapshots.find((s) => s.company_id === row.company_id && s.period_type === row.period_type && s.period_start === row.period_start);
    saved.push(existing ? await updateSnapshot(existing.id, row) : await createSnapshot(row));
  }
  return saved;
}
