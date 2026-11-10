// What the division compare strip shows, worked out once for the dashboard and the Scorecards
// report: for the whole company and for each of its divisions, the month's optimization rate
// against target, how many people that covers, and how many of the month's reviews are complete.
// The arithmetic is lib/scorecard.ts (results) and lib/gsr/cycles.ts (who a cycle covers); this
// file only groups people. Divisions are the company's own rows, never names known to the code.
import { isOptimizationMetric, monthOf, monthResult, summarizeResults, type ResultSummary } from "../../lib/scorecard.ts";
import { cycleProgress, cycleRoster } from "../../lib/gsr/cycles.ts";
import type { CompanyDivision, CycleOmission, MetricEntry, Profile, Review, ReviewCycle, RoleMetric } from "../../types/database.ts";

// The switch value for the whole company.
export const COMBINED = "";

export interface CompareRow {
  // COMBINED, a division id, or NO_DIVISION.
  key: string;
  label: string;
  // Active people in the group.
  people: number;
  // Their optimization results for the month. People with no entry are not counted.
  optimization: ResultSummary;
  // The month's reviews in the group, or null when no month is open for it.
  reviews: { complete: number; total: number } | null;
}

// People not placed in any division: counted in Combined, and shown as their own group only when
// there are some, so the divisions and the remainder add up to the whole.
export const NO_DIVISION = "none";

// The people a switch value covers. Combined is everybody.
export function peopleInScope<P extends Pick<Profile, "division_id">>(people: readonly P[], scope: string): P[] {
  if (scope === COMBINED) return [...people];
  if (scope === NO_DIVISION) return people.filter((p) => p.division_id === null);
  return people.filter((p) => p.division_id === scope);
}

// The month's Goal Setting Review: the monthly cycle whose period starts in that month.
export function monthCycle(cycles: readonly ReviewCycle[], month: string): ReviewCycle | null {
  return cycles.find((c) => c.cadence === "monthly" && monthOf(c.period_start) === month) ?? null;
}

// The month a summary opens on: the latest one up to this month that has any result in, so early
// in a month, before anything is entered, the page shows last month's numbers rather than
// blanks. This month when nothing is entered yet.
export function latestResultMonth(entries: readonly Pick<MetricEntry, "period_month">[], upTo: string): string {
  let latest: string | null = null;
  for (const e of entries) {
    const m = monthOf(e.period_month);
    if (m <= upTo && (latest === null || m > latest)) latest = m;
  }
  return latest ?? upTo;
}

// One person's optimization result for a month: the optimization metric on their own job role.
function optimizationOf(person: Pick<Profile, "id" | "job_role_id">, metrics: readonly RoleMetric[], entries: readonly MetricEntry[], month: string) {
  const metric = metrics.find((m) => m.job_role_id === person.job_role_id && isOptimizationMetric(m));
  if (!metric || !person.job_role_id) return monthResult({ kind: "percent", target: null, higher_is_better: true }, null);
  const own = entries.filter((e) => e.employee_id === person.id && e.metric_id === metric.id && monthOf(e.period_month) === month);
  return monthResult(metric, own);
}

export function divisionCompareRows(input: {
  people: readonly Profile[];
  divisions: readonly CompanyDivision[];
  metrics: readonly RoleMetric[];
  entries: readonly MetricEntry[];
  month: string;
  cycle: ReviewCycle | null;
  reviews: readonly Review[];
  omissions: readonly CycleOmission[];
}): CompareRow[] {
  const { people, divisions, metrics, entries, month, cycle, reviews, omissions } = input;
  const row = (key: string, label: string): CompareRow => {
    const group = peopleInScope(people, key);
    const active = group.filter((p) => p.is_active);
    const reviewList = [...reviews];
    return {
      key,
      label,
      people: active.length,
      optimization: summarizeResults(active.map((p) => optimizationOf(p, metrics, entries, month))),
      reviews: cycle ? cycleProgress(cycleRoster(group, reviewList, cycle.id, [...omissions]), reviewList, cycle.id) : null,
    };
  };
  const rows = [row(COMBINED, "Combined"), ...divisions.map((d) => row(d.id, d.name))];
  if (people.some((p) => p.is_active && p.division_id === null)) rows.push(row(NO_DIVISION, "No division"));
  return rows;
}
