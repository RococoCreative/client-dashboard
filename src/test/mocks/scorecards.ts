// The scorecards service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/scorecards.ts. Like the database it takes a metric's company from its job role and a
// result's from its metric, keeps one result per person, metric, month and project, checks each
// value against its metric's kind with the same messages, and refuses to delete a metric with
// results on file.
import type { MetricEntry, MetricKind, RoleMetric } from "../../types/database.ts";
import { fromAll, personaFromLocation } from "../fixtures.ts";
import { companyOf } from "./profiles.ts";
import { getProject } from "./projects.ts";
import { listJobRoles } from "./jobRoles.ts";

const metrics = fromAll((b) => b.roleMetrics).map((x) => ({ ...x }));
const entries = fromAll((b) => b.metricEntries).map((x) => ({ ...x }));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-new-${++counter}`;
const now = () => new Date().toISOString();

function valueProblem(kind: MetricKind, scaleMax: number, value: number): string | null {
  if (kind === "percent" && (value < 0 || value > 100)) return "A percent is between 0 and 100.";
  if (kind === "rating" && (value < 1 || value > scaleMax)) return `A rating is between 1 and ${scaleMax}.`;
  if (Number.isNaN(value)) return "Enter a number.";
  return null;
}

async function roleCompany(jobRoleId: string): Promise<string> {
  for (const companyId of new Set(fromAll((b) => [b.company.id]))) {
    const roles = await listJobRoles(companyId, true);
    if (roles.some((r) => r.id === jobRoleId)) return companyId;
  }
  throw new Error("That job role does not exist.");
}

export async function listRoleMetrics(companyId: string, includeInactive = false): Promise<RoleMetric[]> {
  return metrics
    .filter((m) => m.company_id === companyId && (includeInactive || m.is_active))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((m) => ({ ...m }));
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
  if (metrics.some((m) => m.job_role_id === input.job_role_id && m.name === input.name)) {
    throw new Error('duplicate key value violates unique constraint "role_metrics_name_key"');
  }
  const created: RoleMetric = {
    id: nextId("metric"),
    company_id: await roleCompany(input.job_role_id),
    description: null,
    target: null,
    scale_max: 5,
    higher_is_better: true,
    per_project: false,
    sort_order: 0,
    is_active: true,
    created_at: now(),
    updated_at: now(),
    ...input,
  };
  metrics.push(created);
  return { ...created };
}

export type RoleMetricPatch = Partial<
  Pick<RoleMetric, "name" | "description" | "kind" | "target" | "scale_max" | "higher_is_better" | "per_project" | "sort_order" | "is_active">
>;

export async function updateRoleMetric(id: string, patch: RoleMetricPatch): Promise<RoleMetric> {
  const metric = metrics.find((m) => m.id === id);
  if (!metric) throw new Error("That is not here any more, or it is not yours to open.");
  const next = { ...metric, ...patch };
  const own = entries.filter((e) => e.metric_id === id);
  if ((next.kind !== metric.kind || next.scale_max !== metric.scale_max) && own.some((e) => valueProblem(next.kind, next.scale_max, e.value))) {
    throw new Error("Results already entered for this metric do not fit that scale.");
  }
  if (next.per_project !== metric.per_project && own.length > 0) {
    throw new Error("Results are already entered for this metric, so whether it is per project cannot change.");
  }
  Object.assign(metric, patch, { updated_at: now() });
  return { ...metric };
}

export async function deleteRoleMetric(id: string): Promise<void> {
  if (entries.some((e) => e.metric_id === id)) {
    throw new Error("This metric has results entered, so it cannot be deleted. Untick Active to retire it instead.");
  }
  const index = metrics.findIndex((m) => m.id === id);
  if (index !== -1) metrics.splice(index, 1);
}

export async function listMetricEntries(companyId: string, opts: { employeeId?: string; year: number }): Promise<MetricEntry[]> {
  return entries
    .filter((e) => e.company_id === companyId && e.period_month.startsWith(`${opts.year}-`) && (!opts.employeeId || e.employee_id === opts.employeeId))
    .sort((a, b) => a.period_month.localeCompare(b.period_month) || a.created_at.localeCompare(b.created_at))
    .map((e) => ({ ...e }));
}

export type MetricEntryInput = {
  company_id: string;
  employee_id: string;
  metric_id: string;
  period_month: string;
  project_id?: string | null;
  value: number;
  note?: string | null;
};

export async function upsertMetricEntry(input: MetricEntryInput): Promise<MetricEntry> {
  const metric = metrics.find((m) => m.id === input.metric_id);
  if (!metric) throw new Error("That metric does not exist.");
  const projectId = input.project_id ?? null;
  if (companyOf(input.employee_id) !== metric.company_id) throw new Error("That person is not on this company's team.");
  if (!/^\d{4}-\d{2}-01$/.test(input.period_month)) throw new Error('new row for relation "metric_entries" violates check constraint "metric_entries_period_check"');
  if (projectId && (await getProject(projectId)).company_id !== metric.company_id) throw new Error("That project belongs to another company.");
  if (metric.per_project && !projectId) throw new Error("This metric is entered per project. Choose the project.");
  if (!metric.per_project && projectId) throw new Error("This metric is entered once for the month, not per project.");
  const problem = valueProblem(metric.kind, metric.scale_max, Number(input.value));
  if (problem) throw new Error(problem);
  const note = input.note?.trim() || null;
  const enteredBy = personaFromLocation().profile.id;
  const existing = entries.find((e) => e.employee_id === input.employee_id && e.metric_id === input.metric_id && e.period_month === input.period_month && e.project_id === projectId);
  if (existing) {
    Object.assign(existing, { value: Number(input.value), note, entered_by: enteredBy, updated_at: now() });
    return { ...existing };
  }
  const created: MetricEntry = {
    id: nextId("entry"),
    company_id: metric.company_id,
    employee_id: input.employee_id,
    metric_id: input.metric_id,
    period_month: input.period_month,
    project_id: projectId,
    value: Number(input.value),
    note,
    entered_by: enteredBy,
    created_at: now(),
    updated_at: now(),
  };
  entries.push(created);
  return { ...created };
}

export async function deleteMetricEntry(id: string): Promise<void> {
  const index = entries.findIndex((e) => e.id === id);
  if (index !== -1) entries.splice(index, 1);
}
