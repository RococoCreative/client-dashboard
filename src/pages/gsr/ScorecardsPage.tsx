// Scorecards, for leadership: every active person on one page, grouped by job role, with the
// chosen month's result on each of their role's metrics against target and the year to date.
// Filter by role; for the people allowed to see the split (an owner, Rococo, or someone given
// the view), a Combined / per-division switch and the division compare strip on top. A row opens
// the person, where results are entered. The numbers all come from lib/scorecard.ts.
import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import Chip from "../../components/ui/Chip.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import DivisionCompare from "../../components/people/DivisionCompare.tsx";
import DivisionSwitch from "../../components/people/DivisionSwitch.tsx";
import { COMBINED, divisionCompareRows, latestResultMonth, monthCycle, peopleInScope } from "../../components/scorecards/compare.ts";
import { monthLabel, scorecardYears } from "../../components/scorecards/months.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listJobRoles } from "../../services/jobRoles.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listCycleOmissions, listCycleReviews, listCycles } from "../../services/gsr.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { formatMetricValue, monthOf, monthResult, monthsOfYear, ytd, type MetricResult } from "../../lib/scorecard.ts";
import { canSeeDivisions } from "../../lib/people.ts";
import { displayName, pluralize } from "../../lib/format.ts";
import type { MetricEntry, Profile, RoleMetric } from "../../types/database.ts";

function toneOf(result: MetricResult): string {
  if (result.value === null) return "text-ink-3";
  return result.hit === null ? "text-ink" : result.hit ? "text-success" : "text-danger";
}

function verdict(result: MetricResult): string {
  if (result.value === null) return "no result";
  return result.hit === null ? "" : result.hit ? ", hit" : ", missed";
}

// One role's people against its metrics for the month, with the year to date under each figure.
function RoleTable({
  title,
  people,
  metrics,
  entries,
  month,
  year,
  divisionName,
}: {
  title: string;
  people: Profile[];
  metrics: RoleMetric[];
  entries: readonly MetricEntry[];
  month: string;
  year: number;
  divisionName: (person: Profile) => string | null;
}) {
  return (
    <Section eyebrow="Job role" title={title} description={`${pluralize(people.length, "person", "people")} · ${monthLabel(month)}`} padded={false}>
      <div className="overflow-x-auto">
        <table className={`${tableClass} min-w-[36rem]`}>
          <thead>
            <tr>
              <th className={`${thClass} sticky left-0 z-10 min-w-[11rem] bg-surface`}>Person</th>
              {metrics.map((m) => (
                <th key={m.id} className={`${thClass} min-w-[7.5rem] text-right align-bottom`}>
                  <span className="block normal-case tracking-normal text-[12px] text-ink-2">{m.name}</span>
                  <span className="tnum block">{m.target === null ? "No target" : `Target ${formatMetricValue(m, m.target)}`}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const own = entries.filter((e) => e.employee_id === person.id);
              const name = displayName(person);
              const division = divisionName(person);
              return (
                <tr key={person.id} className="hover:bg-surface-2/40">
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left align-middle font-normal">
                    <Link to={`/people/${person.id}`} className="block truncate text-sm text-ink hover:text-accent">
                      {name}
                    </Link>
                    {division || person.title ? <p className="truncate text-[12px] text-ink-3">{[division, person.title].filter(Boolean).join(" · ")}</p> : null}
                  </th>
                  {metrics.map((m) => {
                    const result = monthResult(m, own.filter((e) => e.metric_id === m.id && monthOf(e.period_month) === month));
                    const year2date = ytd(m, own, year);
                    return (
                      <td key={m.id} className={`${tdClass} py-2 text-right`}>
                        <span
                          className="inline-block"
                          aria-label={`${name}, ${m.name}, ${monthLabel(month)}: ${result.value === null ? "" : formatMetricValue(m, result.value)}${verdict(result)}; year to date ${year2date.value === null ? "" : formatMetricValue(m, year2date.value)}${verdict(year2date)}`}
                        >
                          <span className={`tnum block text-[13px] font-medium ${toneOf(result)}`}>{formatMetricValue(m, result.value)}</span>
                          <span className="tnum block text-[11px] text-ink-3">
                            YTD <span className={year2date.value === null ? "" : toneOf(year2date)}>{formatMetricValue(m, year2date.value)}</span>
                          </span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function ScorecardsPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const allowed = canSeeDivisions(profile);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  // Null until someone picks one: then the latest month with results in (see latestResultMonth).
  const [picked, setPicked] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [scope, setScope] = useState(COMBINED);

  const state = useAsync(async () => {
    const [people, jobRoles, metrics, divisions, cycles, omissions] = await Promise.all([
      listCompanyProfiles(companyId),
      listJobRoles(companyId, true),
      listRoleMetrics(companyId, true),
      // The split and what the compare strip needs are read only for the people who see them.
      allowed ? listDivisions(companyId) : Promise.resolve([]),
      allowed ? listCycles(companyId) : Promise.resolve([]),
      allowed ? listCycleOmissions(companyId) : Promise.resolve([]),
    ]);
    return { people, jobRoles, metrics, divisions, cycles, omissions };
  }, [companyId, allowed]);
  const results = useAsync(() => listMetricEntries(companyId, { year }), [companyId, year]);
  const thisMonth = monthOf(new Date());
  const month = picked ?? (year === currentYear ? latestResultMonth(results.data ?? [], thisMonth) : `${year}-12-01`);
  const cycle = state.data && allowed ? monthCycle(state.data.cycles, month) : null;
  const cycleId = cycle?.id ?? null;
  const monthReviews = useAsync(() => (cycleId ? listCycleReviews(cycleId) : Promise.resolve([])), [cycleId]);

  function chooseYear(next: number) {
    setYear(next);
    setPicked(`${next}-${month.slice(5, 7)}-01`);
  }

  const header = (
    <PageHeader
      eyebrow="Reviews"
      title="Scorecards"
      description="Each person's role metrics for the month against target, with the year to date. Results are entered on each person's profile."
    />
  );

  if (state.error && !state.data) {
    return (
      <>
        {header}
        <Notice tone="error">{state.error}</Notice>
      </>
    );
  }
  if (!state.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={6} />
      </>
    );
  }

  const { people, jobRoles, metrics, divisions } = state.data;
  const entries = results.data ?? [];
  const split = allowed && divisions.length > 0;
  const activeScope = split ? scope : COMBINED;
  const active = people.filter((p) => p.is_active);
  const inScope = peopleInScope(active, activeScope);
  const liveMetrics = metrics.filter((m) => m.is_active);
  const scoredRoles = jobRoles
    .filter((r) => r.is_active && liveMetrics.some((m) => m.job_role_id === r.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const groups = scoredRoles
    .filter((r) => roleFilter === "" || r.id === roleFilter)
    .map((role) => ({
      role,
      metrics: liveMetrics.filter((m) => m.job_role_id === role.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      people: inScope.filter((p) => p.job_role_id === role.id).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    }))
    .filter((g) => g.people.length > 0);
  const scoredRoleIds = new Set(scoredRoles.map((r) => r.id));
  const unscored = roleFilter === "" ? inScope.filter((p) => !p.job_role_id || !scoredRoleIds.has(p.job_role_id)).sort((a, b) => displayName(a).localeCompare(displayName(b))) : [];
  const roleName = (id: string | null) => jobRoles.find((r) => r.id === id)?.name ?? null;
  const divisionName = (person: Profile) => (split ? (divisions.find((d) => d.id === person.division_id)?.name ?? null) : null);
  const compare = split
    ? divisionCompareRows({ people, divisions, metrics, entries, month, cycle, reviews: monthReviews.data ?? [], omissions: state.data.omissions })
    : [];

  return (
    <>
      {header}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="scorecards-month" className={labelClass}>Month</label>
          <select id="scorecards-month" value={month} onChange={(e) => setPicked(e.target.value)} className={`${selectClass} w-auto`}>
            {monthsOfYear(year).map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="scorecards-year" className={labelClass}>Year</label>
          <select id="scorecards-year" value={year} onChange={(e) => chooseYear(Number(e.target.value))} className={`${selectClass} w-auto`}>
            {scorecardYears(currentYear).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {split ? (
          <div className="sm:ml-auto">
            <p className={`${labelClass} mb-1.5`}>Division</p>
            <DivisionSwitch divisions={divisions} value={activeScope} onChange={setScope} />
          </div>
        ) : null}
      </div>

      {scoredRoles.length > 1 ? (
        <div role="group" aria-label="Job role" className="mb-4 flex flex-wrap gap-1.5">
          <Chip active={roleFilter === ""} onClick={() => setRoleFilter("")}>All roles</Chip>
          {scoredRoles.map((r) => (
            <Chip key={r.id} active={roleFilter === r.id} onClick={() => setRoleFilter(r.id)}>
              {r.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {split ? (
        <div className="mb-6">
          <DivisionCompare rows={compare} monthLabel={monthLabel(month)} active={activeScope} />
        </div>
      ) : null}

      {results.error && !results.data ? <Notice tone="error" className="mb-4">{results.error}</Notice> : null}

      {scoredRoles.length === 0 ? (
        <EmptyState
          eyebrow="Scorecards"
          title="No scorecard metrics yet"
          body="An admin adds the metrics each job role is scored on in Settings, Roles. Then each person's monthly results are entered on their profile, and they gather here."
          action={<Link to="/settings/roles"><Button variant="secondary">Open Settings, Roles</Button></Link>}
        />
      ) : !results.data && !results.error ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-6">
          {groups.length === 0 ? <p className="text-sm text-ink-2">Nobody in this view is in a role with a scorecard.</p> : null}
          {groups.map((g) => (
            <RoleTable key={g.role.id} title={g.role.name} people={g.people} metrics={g.metrics} entries={entries} month={month} year={year} divisionName={divisionName} />
          ))}
          {unscored.length > 0 ? (
            <Section eyebrow="Not on a scorecard" title={pluralize(unscored.length, "person", "people")} description="Their job role has no scorecard metrics, or they have no job role yet." padded={false}>
              <ul className="divide-y divide-line">
                {unscored.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-5 py-2.5">
                    <Link to={`/people/${p.id}`} className="truncate text-sm text-ink hover:text-accent">
                      {displayName(p)}
                    </Link>
                    <span className="text-[12px] text-ink-3">{[divisionName(p), roleName(p.job_role_id) ?? "No job role"].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </>
  );
}
