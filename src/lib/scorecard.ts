// How a role scorecard adds up, pure and tested. This file is the only implementation of scorecard
// math: the review page, the person page and the Scorecards report all read results through it.
//
// A metric is a percent (stored 0..100), a rating (1..scale_max) or a plain number, with an
// optional target. A month's value is the one entry for the month; a per-project metric has one
// entry per project, and its month value combines them the way the year does:
//
//   percent and rating: the average
//   number:             the sum
//
// Year to date averages the months entered for a percent or a rating (a month with no entry is
// left out, never read as zero), and sums a number. A number's target is per month, so its year
// to date target is the target times the months entered.
//
// hit is null when there is nothing to judge (no entry, or no target). gap is signed so that a
// positive gap is better than target whichever way the metric runs: value minus target when
// higher is better, target minus value when lower is better.
import type { MetricEntry, RoleMetric } from "../types/database.ts";

export type ScorecardMetric = Pick<RoleMetric, "kind" | "target" | "higher_is_better">;

export interface MetricResult {
  value: number | null;
  hit: boolean | null;
  gap: number | null;
}

export interface YtdResult extends MetricResult {
  // How many months have at least one entry.
  months: number;
  // The target the year to date is judged against: the metric's target for a percent or a
  // rating, the target times the months entered for a number. Null when the metric has none.
  target: number | null;
}

// Optimization rate is an ordinary percent metric, found by its name. Only the division compare
// strip singles it out.
export const OPTIMIZATION_METRIC_NAME = "Optimization rate";
export function isOptimizationMetric(metric: Pick<RoleMetric, "name" | "kind">): boolean {
  return metric.kind === "percent" && metric.name.trim().toLowerCase() === OPTIMIZATION_METRIC_NAME.toLowerCase();
}

// "2026-09-01" for any date in September 2026. A string is read as written (its first seven
// characters), a Date in local time.
export function monthOf(date: string | Date): string {
  if (typeof date === "string") return `${date.slice(0, 7)}-01`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

// The twelve months of a year, January first.
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`);
}

function yearOf(month: string): number {
  return Number(month.slice(0, 4));
}

// Several values for one metric folded into one: the average for a percent or a rating, the sum
// for a number. Null for none.
export function combineValues(metric: Pick<RoleMetric, "kind">, values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, v) => total + v, 0);
  return metric.kind === "number" ? sum : sum / values.length;
}

// A value against a target.
export function judge(metric: Pick<RoleMetric, "higher_is_better">, value: number | null, target: number | null): Pick<MetricResult, "hit" | "gap"> {
  if (value === null || target === null) return { hit: null, gap: null };
  const gap = metric.higher_is_better ? value - target : target - value;
  return { hit: gap >= 0, gap };
}

// One month's result: from its entry, or from all of a per-project metric's entries for the month.
export function monthResult(
  metric: ScorecardMetric,
  entry: Pick<MetricEntry, "value"> | readonly Pick<MetricEntry, "value">[] | null | undefined,
): MetricResult {
  const list = entry === null || entry === undefined ? [] : Array.isArray(entry) ? entry : [entry as Pick<MetricEntry, "value">];
  const value = combineValues(metric, list.map((e) => Number(e.value)));
  return { value, ...judge(metric, value, metric.target) };
}

// The year to date for one metric from a person's entries. Entries for other metrics, people's
// other years, are ignored by metric and year; pass one person's entries.
export function ytd(metric: ScorecardMetric & Pick<RoleMetric, "id">, entries: readonly MetricEntry[], year: number): YtdResult {
  const byMonth = new Map<string, number[]>();
  for (const e of entries) {
    if (e.metric_id !== metric.id || yearOf(e.period_month) !== year) continue;
    const key = monthOf(e.period_month);
    byMonth.set(key, [...(byMonth.get(key) ?? []), Number(e.value)]);
  }
  const months = byMonth.size;
  if (months === 0) return { value: null, hit: null, gap: null, months: 0, target: metric.target };
  let value: number;
  let target: number | null;
  if (metric.kind === "number") {
    value = [...byMonth.values()].flat().reduce((total, v) => total + v, 0);
    target = metric.target === null ? null : metric.target * months;
  } else {
    const monthValues = [...byMonth.values()].map((values) => combineValues(metric, values) as number);
    value = monthValues.reduce((total, v) => total + v, 0) / monthValues.length;
    target = metric.target;
  }
  return { value, ...judge(metric, value, target), months, target };
}

export interface GridCell extends MetricResult {
  month: string;
  // The entry behind the cell, for editing in place: set on a metric row of a month-only metric
  // and on a project row; null on a per-project metric's combined row and where nothing is entered.
  entry: MetricEntry | null;
}

export interface GridRow {
  metric: RoleMetric;
  // "metric": the metric's own row (for a per-project metric, its projects combined).
  // "project": one project's row under a per-project metric.
  level: "metric" | "project";
  projectId: string | null;
  cells: GridCell[];
  ytd: YtdResult;
}

export interface YearGrid {
  year: number;
  months: string[];
  rows: GridRow[];
}

// One person's year: a row per metric, in the metric's order, with twelve month cells and the
// year to date. A per-project metric's row combines its projects and is followed by a row per
// project: the ones in projectIds (the person's assigned projects, so an empty row can be filled)
// and any other project they have an entry on that year. Active metrics are always listed; a
// retired one only when the person has entries on it that year.
export function buildYearGrid(input: {
  metrics: readonly RoleMetric[];
  entries: readonly MetricEntry[];
  employeeId: string;
  year: number;
  projectIds?: readonly string[];
}): YearGrid {
  const { year } = input;
  const months = monthsOfYear(year);
  const mine = input.entries.filter((e) => e.employee_id === input.employeeId && yearOf(e.period_month) === year);
  const listed = input.metrics
    .filter((m) => m.is_active || mine.some((e) => e.metric_id === m.id))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const rows: GridRow[] = [];
  for (const metric of listed) {
    const own = mine.filter((e) => e.metric_id === metric.id);
    const inMonth = (list: readonly MetricEntry[], month: string) => list.filter((e) => monthOf(e.period_month) === month);
    rows.push({
      metric,
      level: "metric",
      projectId: null,
      cells: months.map((month) => {
        const found = inMonth(own, month);
        return { month, ...monthResult(metric, found), entry: !metric.per_project && found.length === 1 ? found[0] : null };
      }),
      ytd: ytd(metric, own, year),
    });
    if (!metric.per_project) continue;
    const projectIds = [...(input.projectIds ?? [])];
    for (const e of own) if (e.project_id && !projectIds.includes(e.project_id)) projectIds.push(e.project_id);
    for (const projectId of projectIds) {
      const onProject = own.filter((e) => e.project_id === projectId);
      rows.push({
        metric,
        level: "project",
        projectId,
        cells: months.map((month) => {
          const found = inMonth(onProject, month);
          return { month, ...monthResult(metric, found), entry: found[0] ?? null };
        }),
        ytd: ytd(metric, onProject, year),
      });
    }
  }
  return { year, months, rows };
}

export interface ResultSummary {
  // The average of the values present.
  average: number | null;
  // The average gap of the results that have a target.
  averageGap: number | null;
  // How many results have a value.
  counted: number;
  // How many results were judged (value and target), and how many of those hit.
  judged: number;
  hits: number;
}

// Several people's results on one metric, for a team or division line (the compare strip). People
// with no entry are not counted.
export function summarizeResults(results: readonly MetricResult[]): ResultSummary {
  const present = results.filter((r) => r.value !== null);
  const judgedList = results.filter((r) => r.gap !== null);
  const avg = (values: number[]) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null);
  return {
    average: avg(present.map((r) => r.value as number)),
    averageGap: avg(judgedList.map((r) => r.gap as number)),
    counted: present.length,
    judged: judgedList.length,
    hits: judgedList.filter((r) => r.hit).length,
  };
}

// A value as the metric reads: 85%, 4.5 / 5, 1,250. One decimal at most; "-" for nothing.
export function formatMetricValue(metric: Pick<RoleMetric, "kind" | "scale_max">, value: number | null): string {
  if (value === null || Number.isNaN(value)) return "-";
  const shown = (Math.round(value * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (metric.kind === "percent") return `${shown}%`;
  if (metric.kind === "rating") return `${shown} / ${metric.scale_max}`;
  return shown;
}
