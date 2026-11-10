// The scorecard arithmetic: a month's result, the year to date, the year grid and the summary a
// division line reads. Pure, so these are the whole contract the screens build on.
import { describe, expect, it } from "vitest";
import type { MetricEntry, RoleMetric } from "../types/database.ts";
import { buildYearGrid, combineValues, formatMetricValue, isOptimizationMetric, judge, monthOf, monthResult, monthsOfYear, summarizeResults, ytd } from "./scorecard.ts";

function metric(over: Partial<RoleMetric> = {}): RoleMetric {
  return {
    id: "m-opt",
    company_id: "co",
    job_role_id: "role",
    name: "Optimization rate",
    description: null,
    kind: "percent",
    target: 80,
    scale_max: 5,
    higher_is_better: true,
    per_project: false,
    sort_order: 1,
    is_active: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

let n = 0;
function entry(metricId: string, month: string, value: number, over: Partial<MetricEntry> = {}): MetricEntry {
  n += 1;
  return {
    id: `e-${n}`,
    company_id: "co",
    employee_id: "p1",
    metric_id: metricId,
    period_month: month,
    project_id: null,
    value,
    note: null,
    entered_by: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("monthResult", () => {
  it("judges a percent against its target, gap positive when better", () => {
    expect(monthResult(metric(), { value: 85 })).toEqual({ value: 85, hit: true, gap: 5 });
    expect(monthResult(metric(), { value: 72 })).toEqual({ value: 72, hit: false, gap: -8 });
  });

  it("lands exactly on target as a hit", () => {
    expect(monthResult(metric(), { value: 80 })).toEqual({ value: 80, hit: true, gap: 0 });
  });

  it("reads nothing entered as nothing, never zero", () => {
    expect(monthResult(metric(), null)).toEqual({ value: null, hit: null, gap: null });
    expect(monthResult(metric(), [])).toEqual({ value: null, hit: null, gap: null });
  });

  it("shows a metric with no target without judging it", () => {
    expect(monthResult(metric({ target: null }), { value: 64 })).toEqual({ value: 64, hit: null, gap: null });
  });

  it("flips the gap when lower is better", () => {
    expect(monthResult(metric({ higher_is_better: false, target: 10 }), { value: 7 })).toEqual({ value: 7, hit: true, gap: 3 });
    expect(monthResult(metric({ higher_is_better: false, target: 10 }), { value: 12 })).toEqual({ value: 12, hit: false, gap: -2 });
  });

  it("averages a per-project percent's projects and sums a number's", () => {
    expect(monthResult(metric({ per_project: true, target: 30 }), [{ value: 28 }, { value: 34 }])).toEqual({ value: 31, hit: true, gap: 1 });
    expect(monthResult(metric({ kind: "number", target: 10 }), [{ value: 4 }, { value: 5 }])).toEqual({ value: 9, hit: false, gap: -1 });
  });
});

describe("ytd", () => {
  it("averages the months entered for a percent, leaving out months with no entry", () => {
    const m = metric();
    const entries = [entry("m-opt", "2026-07-01", 70), entry("m-opt", "2026-08-01", 90), entry("m-opt", "2026-09-01", 86)];
    expect(ytd(m, entries, 2026)).toEqual({ value: 82, hit: true, gap: 2, months: 3, target: 80 });
  });

  it("averages a per-project metric month by month, so a busy month does not count twice", () => {
    const m = metric({ id: "m-gp", per_project: true, target: 30 });
    const entries = [
      entry("m-gp", "2026-08-01", 20, { project_id: "a" }),
      entry("m-gp", "2026-08-01", 40, { project_id: "b" }),
      entry("m-gp", "2026-09-01", 36, { project_id: "a" }),
    ];
    // August is 30, September 36: the year reads 33, not (20 + 40 + 36) / 3 = 32.
    expect(ytd(m, entries, 2026).value).toBe(33);
  });

  it("sums a number and judges it against the target times the months entered", () => {
    const m = metric({ id: "m-num", kind: "number", target: 10 });
    const entries = [entry("m-num", "2026-08-01", 12), entry("m-num", "2026-09-01", 7)];
    expect(ytd(m, entries, 2026)).toEqual({ value: 19, hit: false, gap: -1, months: 2, target: 20 });
  });

  it("ignores other metrics and other years", () => {
    const m = metric();
    const entries = [entry("m-opt", "2025-12-01", 10), entry("m-other", "2026-09-01", 10), entry("m-opt", "2026-09-01", 90)];
    expect(ytd(m, entries, 2026)).toMatchObject({ value: 90, months: 1 });
  });

  it("reads an empty year as nothing", () => {
    expect(ytd(metric(), [], 2026)).toEqual({ value: null, hit: null, gap: null, months: 0, target: 80 });
    expect(ytd(metric({ kind: "number", target: 5 }), [], 2026).target).toBe(5);
  });
});

describe("buildYearGrid", () => {
  const opt = metric();
  const sat = metric({ id: "m-sat", name: "Client journey satisfaction", kind: "rating", target: 4, sort_order: 2 });
  const gp = metric({ id: "m-gp", name: "Job cost: gross profit", per_project: true, target: 30, sort_order: 3 });
  const retired = metric({ id: "m-old", name: "Old metric", is_active: false, sort_order: 0 });
  const retiredUnused = metric({ id: "m-old2", name: "Never used", is_active: false, sort_order: 0 });
  const entries = [
    entry("m-opt", "2026-08-01", 82),
    entry("m-opt", "2026-09-01", 78),
    entry("m-sat", "2026-09-01", 5),
    entry("m-gp", "2026-09-01", 28, { project_id: "lakeside" }),
    entry("m-gp", "2026-09-01", 34, { project_id: "harbour" }),
    entry("m-old", "2026-03-01", 50),
    entry("m-opt", "2026-09-01", 10, { employee_id: "someone-else" }),
  ];
  const grid = buildYearGrid({ metrics: [gp, sat, opt, retired, retiredUnused], entries, employeeId: "p1", year: 2026, projectIds: ["lakeside", "island"] });

  it("lists twelve months and a row per metric in order, a retired one only when used", () => {
    expect(grid.months).toEqual(monthsOfYear(2026));
    expect(grid.rows.filter((r) => r.level === "metric").map((r) => r.metric.id)).toEqual(["m-old", "m-opt", "m-sat", "m-gp"]);
  });

  it("fills each cell from the person's own entry and keeps the entry for editing", () => {
    const row = grid.rows.find((r) => r.metric.id === "m-opt")!;
    expect(row.cells[8]).toMatchObject({ month: "2026-09-01", value: 78, hit: false, gap: -2 });
    expect(row.cells[8].entry?.value).toBe(78);
    expect(row.cells[0]).toMatchObject({ value: null, hit: null, entry: null });
    expect(row.ytd).toMatchObject({ value: 80, hit: true, months: 2 });
  });

  it("breaks a per-project metric out by project, assigned ones first, then any other with an entry", () => {
    const projectRows = grid.rows.filter((r) => r.metric.id === "m-gp" && r.level === "project");
    expect(projectRows.map((r) => r.projectId)).toEqual(["lakeside", "island", "harbour"]);
    expect(projectRows[0].cells[8]).toMatchObject({ value: 28, hit: false });
    expect(projectRows[1].cells[8]).toMatchObject({ value: null, entry: null });
    const combined = grid.rows.find((r) => r.metric.id === "m-gp" && r.level === "metric")!;
    expect(combined.cells[8]).toMatchObject({ value: 31, hit: true, entry: null });
  });
});

describe("helpers", () => {
  it("names the month of a date", () => {
    expect(monthOf("2026-09-15")).toBe("2026-09-01");
    expect(monthOf(new Date(2026, 0, 31))).toBe("2026-01-01");
  });

  it("combines and judges", () => {
    expect(combineValues({ kind: "rating" }, [3, 4, 5])).toBe(4);
    expect(combineValues({ kind: "number" }, [])).toBeNull();
    expect(judge({ higher_is_better: true }, 5, null)).toEqual({ hit: null, gap: null });
  });

  it("finds Optimization rate by name, on a percent only", () => {
    expect(isOptimizationMetric({ name: " optimization rate ", kind: "percent" })).toBe(true);
    expect(isOptimizationMetric({ name: "Optimization rate", kind: "number" })).toBe(false);
  });

  it("summarizes a division's results, leaving out people with no entry", () => {
    const summary = summarizeResults([
      { value: 85, hit: true, gap: 5 },
      { value: 70, hit: false, gap: -20 },
      { value: 60, hit: null, gap: null },
      { value: null, hit: null, gap: null },
    ]);
    expect(summary).toEqual({ average: 215 / 3, averageGap: -7.5, counted: 3, judged: 2, hits: 1 });
    expect(summarizeResults([])).toEqual({ average: null, averageGap: null, counted: 0, judged: 0, hits: 0 });
  });

  it("formats a value the way its metric reads", () => {
    expect(formatMetricValue({ kind: "percent", scale_max: 5 }, 82.25)).toBe("82.3%");
    expect(formatMetricValue({ kind: "rating", scale_max: 5 }, 4)).toBe("4 / 5");
    expect(formatMetricValue({ kind: "number", scale_max: 5 }, 1250)).toBe("1,250");
    expect(formatMetricValue({ kind: "number", scale_max: 5 }, null)).toBe("-");
  });
});
