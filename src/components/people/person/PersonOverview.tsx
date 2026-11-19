// A person's Overview tab, the one their page opens on: who they are at a glance (a read-only strip
// of their details, with a way into Setup for an admin), this month's GSR, their next open tasks,
// who reports to them, and their latest score and average. Everything here is read; changing a
// detail is a deliberate step on Setup. A Rococo admin's row has no GSR, tasks or team block, as
// their page never had.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Section from "../../ui/Section.tsx";
import Stat from "../../ui/Stat.tsx";
import { bandClass } from "../../ui/bandClass.ts";
import { labelClass } from "../../ui/forms.ts";
import PersonTasks from "../../tasks/PersonTasks.tsx";
import PersonTeam from "../PersonTeam.tsx";
import { ThisMonthGsr } from "./PersonGsrGoals.tsx";
import { useHub } from "../../../context/HubContext.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { listDivisions } from "../../../services/divisions.ts";
import { hasModule } from "../../../lib/modules.ts";
import { averageScore } from "../../../lib/gsr/scoring.ts";
import { latestScoredReview, reviewHistory } from "../../../lib/gsr/history.ts";
import { formatDate, pluralize } from "../../../lib/format.ts";
import { divisionLabel, formatTenure, ledBy } from "../../../lib/people.ts";
import { ROLE_LABELS, type Goal } from "../../../types/database.ts";
import { reportsTo, type PersonTabProps } from "../../../pages/people/personTabs.ts";
import { tapTargetClass } from "../../ui/tap.ts";

// One label and its value in the details strip.
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function PersonOverview({ companyId, data, person }: PersonTabProps) {
  const { company, profile: me, isAdmin } = useHub();
  const { people, reviews, cycles, pillars, scores, jobRoles, goals } = data;
  const rococo = person.is_rococo_admin;
  const self = person.id === me.id;
  const divisions = useAsync(() => listDivisions(companyId), [companyId]);
  const placed = divisions.data && (divisions.data.length > 0 || person.division_ids.length > 0) ? divisionLabel(person.division_ids, divisions.data) : null;
  const jobRole = jobRoles.find((r) => r.id === person.job_role_id) ?? null;
  const manager = reportsTo(data, person);
  const tenure = formatTenure(person.hire_date);
  const rows = reviewHistory(reviews, cycles, pillars, scores);
  const latestScored = latestScoredReview(rows);
  const average = averageScore(rows.map((r) => r.result?.overall ?? null));
  // The viewer runs the record (an admin), or leads this person (a manager over their chain).
  const isLeader = isAdmin || ledBy(me, people).some((p) => p.id === person.id);
  // How a task's GSR goal reads on the Tasks list: the month it belongs to.
  const goalById = new Map<string, Goal>(goals.map((g) => [g.id, g]));
  const goalLabel = (goalId: string): string | null => {
    const goal = goalById.get(goalId);
    const cycle = goal?.cycle_id ? cycles.find((c) => c.id === goal.cycle_id) : undefined;
    return cycle ? `${cycle.name} GSR` : null;
  };
  const roleName = jobRole ? `${jobRole.name}${jobRole.is_active ? "" : " (retired)"}` : null;

  return (
    <div className="space-y-6">
      <Section
        eyebrow="Profile"
        title="Details"
        actions={isAdmin ? <Link to={`/people/${person.id}/setup`} className={`text-link text-[13px] font-medium hover:underline ${tapTargetClass}`}>Edit in Setup</Link> : undefined}
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Email">{person.email}</Detail>
          <Detail label="Hired">{person.hire_date ? `${formatDate(person.hire_date)}${tenure ? ` · ${tenure}` : ""}` : "Not set"}</Detail>
          <Detail label="Job role">
            {jobRole && roleName ? (
              isAdmin ? <Link to={`/people/roles/${jobRole.id}`} className={`text-link hover:underline ${tapTargetClass}`}>{roleName}</Link> : roleName
            ) : (
              "Not set"
            )}
          </Detail>
          {placed !== null ? <Detail label="Division">{placed}</Detail> : null}
          <Detail label="Reports to">{manager.name ? `${manager.name}${manager.inactive ? " (inactive)" : ""}` : "Nobody"}</Detail>
          <Detail label="Hub access">{rococo ? "Rococo Creative" : ROLE_LABELS[person.role]}</Detail>
          <Detail label="Department">{person.department || "Not set"}</Detail>
          <Detail label="Phone">{person.phone || "Not set"}</Detail>
        </dl>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ThisMonthGsr companyId={companyId} data={data} person={person} />
          {hasModule(company, "tasks") && !rococo ? (
            <PersonTasks companyId={companyId} person={person} canAdd={isLeader} viewerProfileId={me.id} goalLabel={goalLabel} limit={3} moreHref={`/people/${person.id}/tasks`} />
          ) : null}
          {rococo ? null : <PersonTeam companyId={companyId} person={person} people={people} self={self} isAdmin={isAdmin} />}
        </div>
        <div className="grid grid-cols-2 content-start gap-3 sm:gap-4 lg:grid-cols-1">
          <Stat label="Latest score" value={<span className={bandClass(latestScored?.result?.overall ?? null)}>{latestScored?.result?.overall ?? "-"}</span>} hint={latestScored?.cycle?.name ?? "Not scored yet"} />
          <Stat label="Average" value={average ?? "-"} hint={pluralize(rows.length, "review")} />
        </div>
      </div>
    </div>
  );
}
