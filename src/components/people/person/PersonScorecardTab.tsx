// A person's Scorecard tab: their role scorecard (the month-by-month results an admin enters against
// the role's targets), the projects they are on, this year's personal KPIs, and, for an admin, their
// financial figures. A manager reads all of it except the financial figures, which are an admin's
// alone, so the page never asks for them on a manager's behalf. A Rococo admin's row has no role
// scorecard or projects, as their page never had.
import { useState } from "react";
import Notice from "../../ui/Notice.tsx";
import Section from "../../ui/Section.tsx";
import SkeletonRows from "../../ui/SkeletonRows.tsx";
import FinancialsTable from "../FinancialsTable.tsx";
import KpiList from "../KpiList.tsx";
import PersonProjects from "../PersonProjects.tsx";
import PersonScorecard from "../../scorecards/PersonScorecard.tsx";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listProjectAssignments } from "../../../services/projectAssignments.ts";
import { listProjects } from "../../../services/projects.ts";
import { listMetricEntries, listRoleMetrics } from "../../../services/scorecards.ts";
import { hasModule } from "../../../lib/modules.ts";
import { displayName } from "../../../lib/format.ts";
import type { Profile } from "../../../types/database.ts";
import type { PersonTabProps } from "../../../pages/people/personTabs.ts";

// The person's scorecard and their projects, loaded together because a per-project metric has a
// row for every project they are on: assigning one here gives it a row there straight away. The
// year's results load on their own, so changing the year leaves the rest standing.
function ScorecardAndProjects({
  companyId,
  person,
  roleName,
  canEdit,
  linkProjects,
  onError,
}: {
  companyId: string;
  person: Profile;
  roleName: string | null;
  canEdit: boolean;
  linkProjects: boolean;
  onError: (message: string) => void;
}) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const base = useAsync(async () => {
    const [metrics, assignments, projects] = await Promise.all([
      listRoleMetrics(companyId, true),
      listProjectAssignments(companyId, { employeeId: person.id }),
      listProjects(companyId, { includeArchived: true }),
    ]);
    return { metrics, assignments, projects };
  }, [companyId, person.id]);
  const results = useAsync(() => listMetricEntries(companyId, { employeeId: person.id, year }), [companyId, person.id, year]);

  if (base.error && !base.data) return <Notice tone="error">{base.error}</Notice>;
  if (!base.data) return <SkeletonRows rows={4} />;
  const { metrics, assignments, projects } = base.data;
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <>
      {results.error && !results.data ? <Notice tone="error">{results.error}</Notice> : null}
      <PersonScorecard
        companyId={companyId}
        employeeId={person.id}
        roleId={person.job_role_id}
        roleName={roleName}
        year={year}
        onYear={setYear}
        metrics={metrics}
        entries={results.data}
        projectIds={assignments.map((a) => a.project_id)}
        projectName={(id) => names.get(id) ?? "A project no longer listed"}
        canEdit={canEdit}
        onEntries={(update) => results.setData((prev) => (prev ? update(prev) : prev))}
        description={canEdit ? "The role's metrics, month by month, against target, with the year to date. Entered here by an admin; the person reads their own." : undefined}
      />
      <PersonProjects
        companyId={companyId}
        employeeId={person.id}
        firstName={displayName(person).split(" ")[0]}
        assignments={assignments}
        projects={projects}
        canEdit={canEdit}
        linkProjects={linkProjects}
        onAssignments={(update) => base.setData((prev) => (prev ? { ...prev, assignments: update(prev.assignments) } : prev))}
        onProjects={(update) => base.setData((prev) => (prev ? { ...prev, projects: update(prev.projects) } : prev))}
        onError={onError}
      />
    </>
  );
}

export default function PersonScorecardTab({ companyId, data, person, update, onError }: PersonTabProps) {
  const { company, isAdmin, can } = useHub();
  const year = new Date().getFullYear();
  // The role they are in, and whether it puts their figures on their dashboard. A retired role
  // stays on their record but carries nothing, which is how the dashboard reads it too.
  const jobRole = data.jobRoles.find((r) => r.id === person.job_role_id) ?? null;
  const roleRetired = jobRole !== null && !jobRole.is_active;
  const figuresOnDashboard = !roleRetired && (jobRole?.dashboard_modules.includes("financials") ?? false);
  return (
    <div className="space-y-6">
      {person.is_rococo_admin ? null : (
        <ScorecardAndProjects
          companyId={companyId}
          person={person}
          roleName={jobRole?.name ?? null}
          canEdit={isAdmin}
          linkProjects={hasModule(company, "production") && can("production_view")}
          onError={onError}
        />
      )}
      <div className={`grid grid-cols-1 gap-6 ${isAdmin ? "lg:grid-cols-2" : ""}`}>
        <Section eyebrow={String(year)} title="Personal KPIs" description="The numbers this person owns for the year. They show at the top of every review.">
          <KpiList companyId={companyId} employeeId={person.id} year={year} kpis={data.kpis} canEdit={isAdmin} onChange={(change) => update((prev) => ({ ...prev, kpis: change(prev.kpis) }))} onError={onError} />
        </Section>
        {isAdmin ? (
          <Section
            eyebrow={String(year)}
            title="Financial figures"
            description={
              figuresOnDashboard && jobRole
                ? `The numbers this person owns, against target. On their dashboard, because ${jobRole.name} carries the module.`
                : roleRetired && jobRole
                  ? `The numbers this person owns, against target. Not on their dashboard: ${jobRole.name} is retired. They come back once a current role that carries the module is set in Setup.`
                  : jobRole
                    ? `The numbers this person owns, against target. Not on their dashboard: ${jobRole.name} does not carry the module. Turn it on for the role in People, Roles.`
                    : "The numbers this person owns, against target. They reach their dashboard once a job role that carries the module is set in Setup."
            }
          >
            <FinancialsTable employeeId={person.id} year={year} rows={data.financials} canEdit onChange={(change) => update((prev) => ({ ...prev, financials: change(prev.financials) }))} onError={onError} />
          </Section>
        ) : null}
      </div>
    </div>
  );
}
