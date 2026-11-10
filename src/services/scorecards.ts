// Role scorecards (0035): the metrics a job role is scored on, and each person's monthly results.
// Members read a company's metrics; admins write them. Results are read by the company's admins
// and by the person they belong to, and written by admins only. company_id on a metric comes from
// its job role and on a result from its metric, by trigger, and the database checks each value
// against its metric's kind. The arithmetic is lib/scorecard.ts.
import type { MetricEntry, MetricKind, RoleMetric } from "../types/database.ts";
import { db } from "./supabase.ts";

const METRIC_COLUMNS =
  "id, company_id, job_role_id, name, description, kind, target, scale_max, higher_is_better, per_project, sort_order, is_active, created_at, updated_at";
const ENTRY_COLUMNS =
  "id, company_id, employee_id, metric_id, period_month, project_id, value, note, entered_by, created_at, updated_at";

// numeric columns can arrive as strings from PostgREST; the app reads numbers.
function normalizeMetric(row: RoleMetric): RoleMetric {
  return { ...row, target: row.target === null || row.target === undefined ? null : Number(row.target), scale_max: Number(row.scale_max ?? 5) };
}
function normalizeEntry(row: MetricEntry): MetricEntry {
  return { ...row, value: Number(row.value) };
}

// Metrics -----------------------------------------------------------------------------------

export async function listRoleMetrics(companyId: string, includeInactive = false): Promise<RoleMetric[]> {
  let query = db().from("role_metrics").select(METRIC_COLUMNS).eq("company_id", companyId);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("sort_order").order("name");
  if (error) throw error;
  return ((data as RoleMetric[]) ?? []).map(normalizeMetric);
}

export type RoleMetricInput = {
  job_role_id: string;
  name: string;
  kind: MetricKind;
  description?: string | null;
  target?: number | null;
  scale_max?: number;
  higher_is_better?: boolean;
  per_project?: boolean;
  sort_order?: number;
};

export async function createRoleMetric(input: RoleMetricInput): Promise<RoleMetric> {
  const { data, error } = await db().from("role_metrics").insert(input).select(METRIC_COLUMNS).single();
  if (error) throw error;
  return normalizeMetric(data as RoleMetric);
}

export type RoleMetricPatch = Partial<
  Pick<RoleMetric, "name" | "description" | "kind" | "target" | "scale_max" | "higher_is_better" | "per_project" | "sort_order" | "is_active">
>;

// The database refuses a change of kind or scale that results on file would fall outside, and a
// change of per_project once results exist.
export async function updateRoleMetric(id: string, patch: RoleMetricPatch): Promise<RoleMetric> {
  const { data, error } = await db().from("role_metrics").update(patch).eq("id", id).select(METRIC_COLUMNS).single();
  if (error) throw error;
  return normalizeMetric(data as RoleMetric);
}

// Refused once results are entered; untick Active (updateRoleMetric) to retire it instead.
export async function deleteRoleMetric(id: string): Promise<void> {
  const { error } = await db().from("role_metrics").delete().eq("id", id);
  if (error) throw error;
}

// Results -----------------------------------------------------------------------------------

// Every result in one calendar year, for one person or (admins) the whole company, oldest first.
export async function listMetricEntries(companyId: string, opts: { employeeId?: string; year: number }): Promise<MetricEntry[]> {
  let query = db()
    .from("metric_entries")
    .select(ENTRY_COLUMNS)
    .eq("company_id", companyId)
    .gte("period_month", `${opts.year}-01-01`)
    .lte("period_month", `${opts.year}-12-01`);
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  const { data, error } = await query.order("period_month").order("created_at");
  if (error) throw error;
  return ((data as MetricEntry[]) ?? []).map(normalizeEntry);
}

export type MetricEntryInput = {
  company_id: string;
  employee_id: string;
  metric_id: string;
  // YYYY-MM-01.
  period_month: string;
  // Required for a per-project metric, null otherwise.
  project_id?: string | null;
  value: number;
  note?: string | null;
};

// One result per person, metric, month and project: writes it or replaces the one there.
export async function upsertMetricEntry(input: MetricEntryInput): Promise<MetricEntry> {
  const row = { ...input, project_id: input.project_id ?? null, note: input.note ?? null };
  const { data, error } = await db()
    .from("metric_entries")
    .upsert(row, { onConflict: "employee_id,metric_id,period_month,project_id" })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeEntry(data as MetricEntry);
}

export async function deleteMetricEntry(id: string): Promise<void> {
  const { error } = await db().from("metric_entries").delete().eq("id", id);
  if (error) throw error;
}
