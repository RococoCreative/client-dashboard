// The 0035 sample data keeps the database's rules, so screens built on it never show a state the
// database cannot hold: every result fits its metric's kind and sits in its metric's company, a
// per-project metric's results name a project and the others none, one result per person, metric,
// month and project, a person's division and assignments are their own company's.
import { describe, expect, it } from "vitest";
import { ALL_PROFILES, fromAll } from "./fixtures.ts";

const metrics = fromAll((b) => b.roleMetrics);
const entries = fromAll((b) => b.metricEntries);
const projects = fromAll((b) => b.projects);
const divisions = fromAll((b) => b.divisions);
const assignments = fromAll((b) => b.projectAssignments);
const roles = fromAll((b) => b.jobRoles);
const companyOf = (profileId: string) => ALL_PROFILES.find((p) => p.id === profileId)?.company_id;

describe("0035 fixtures", () => {
  it("has RBA's scorecards and Klasik's calendar to build on", () => {
    expect(metrics.length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
    expect(fromAll((b) => b.focusTopics).map((t) => t.month)).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("keeps every metric on a role of its own company", () => {
    for (const m of metrics) expect(roles.find((r) => r.id === m.job_role_id)?.company_id).toBe(m.company_id);
  });

  it("keeps every result inside its metric's rules", () => {
    for (const e of entries) {
      const m = metrics.find((x) => x.id === e.metric_id)!;
      expect(e.company_id).toBe(m.company_id);
      expect(companyOf(e.employee_id)).toBe(m.company_id);
      expect(e.period_month).toMatch(/^\d{4}-\d{2}-01$/);
      if (m.kind === "percent") expect(e.value >= 0 && e.value <= 100).toBe(true);
      if (m.kind === "rating") expect(e.value >= 1 && e.value <= m.scale_max).toBe(true);
      expect(Boolean(e.project_id)).toBe(m.per_project);
      if (e.project_id) expect(projects.find((p) => p.id === e.project_id)?.company_id).toBe(m.company_id);
    }
    const keys = entries.map((e) => [e.employee_id, e.metric_id, e.period_month, e.project_id].join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps divisions and assignments inside the person's company", () => {
    for (const p of ALL_PROFILES.filter((x) => x.division_id)) expect(divisions.find((d) => d.id === p.division_id)?.company_id).toBe(p.company_id);
    for (const a of assignments) {
      expect(projects.find((p) => p.id === a.project_id)?.company_id).toBe(a.company_id);
      expect(companyOf(a.employee_id)).toBe(a.company_id);
    }
  });
});
