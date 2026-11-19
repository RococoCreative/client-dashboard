// The employee's own scorecard on Home, read only, when their job role is scored.
import { useState } from "react";
import Notice from "../ui/Notice.tsx";
import PersonScorecard from "../scorecards/PersonScorecard.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listProjectAssignments } from "../../services/projectAssignments.ts";
import { listProjects } from "../../services/projects.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import type { JobRole } from "../../types/database.ts";

// The employee's own scorecard, when their (current) job role is scored: read only, the same grid
// an admin fills in on their profile. A role with no active metrics shows nothing at all.
export default function MyScorecard({ companyId, employeeId, jobRole }: { companyId: string; employeeId: string; jobRole: JobRole }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const base = useAsync(async () => {
    const metrics = await listRoleMetrics(companyId, true);
    if (!metrics.some((m) => m.job_role_id === jobRole.id && m.is_active)) return null;
    const [assignments, projects] = await Promise.all([listProjectAssignments(companyId, { employeeId }), listProjects(companyId, { includeArchived: true })]);
    return { metrics, assignments, projects };
  }, [companyId, employeeId, jobRole.id]);
  const scored = base.data !== null;
  const results = useAsync(() => (scored ? listMetricEntries(companyId, { employeeId, year }) : Promise.resolve([])), [companyId, employeeId, year, scored]);

  if (base.error && !base.data) return <Notice tone="error" className="lg:col-span-3">Your scorecard did not load. {base.error}</Notice>;
  if (!base.data) return null;
  const names = new Map(base.data.projects.map((p) => [p.id, p.name]));
  return (
    <div className="lg:col-span-3">
      {results.error && !results.data ? <Notice tone="error" className="mb-3">{results.error}</Notice> : null}
      <PersonScorecard
        companyId={companyId}
        employeeId={employeeId}
        roleId={jobRole.id}
        roleName={jobRole.name}
        year={year}
        onYear={setYear}
        metrics={base.data.metrics}
        entries={results.data}
        projectIds={base.data.assignments.map((a) => a.project_id)}
        projectName={(id) => names.get(id) ?? "A project no longer listed"}
        canEdit={false}
        onEntries={() => undefined}
        title="Your scorecard"
        description="What your role is scored on each month, against target, with the year to date. Your manager enters the results."
      />
    </div>
  );
}
