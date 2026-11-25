// Scorecards, for leadership: every active person on one page, grouped by job role, with the
// chosen month's result on each of their role's metrics against target and the year to date.
// A role dropdown narrows it; for the people allowed to see the split (an owner, Rococo, or someone
// given the view), a Combined / per-division switch and the division compare strip sit on top. A
// person's name opens their profile, where results are entered. The numbers all come from
// lib/scorecard.ts. The people are the ones the database shows the viewer, so a viewer who sees
// only some divisions reads the whole as "In your divisions". In a company whose GSRs are on demand
// (0047), the strip counts the GSRs done in the month instead of the month's GSR reviews.
import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { itemTitleClass, metaClass } from "../../components/ui/type.ts";
import { cellTextClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { tapStretchClass } from "../../components/ui/tap.ts";
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
import { listGsrsForLog } from "../../services/gsrOnDemand.ts";
import { windowRange } from "../../lib/gsr/onDemand.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { formatMetricValue, monthOf, monthResult, monthsOfYear, ytd, type MetricResult } from "../../lib/scorecard.ts";
import { canSeeDivisions, divisionLabel, isDivisionLimited, viewerDivisions } from "../../lib/people.ts";
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

// The role cell's own look: the column header style with the quiet caps turned off, because it
// holds the role name and a people count rather than a column label. Written out in full instead
// of layered over thClass, so no rule here depends on which stylesheet entry comes last.
const roleHeadClass =
  "border-b border-line px-3 py-2 text-left align-bottom text-[11px] font-normal normal-case tracking-normal text-ink-3";

// One role's block inside the shared table: a role heading with its people count, then that role's
// metric column headings and its people. Each block is its own table so a screen reader reads the
// right column headings for every cell. Below md the rows become stacked cards, each metric a label
// and value line, so nothing scrolls sideways on a phone.
function RoleBlock({
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
    <div className="border-b border-line last:border-b-0">
      <div className="relative md:overflow-x-auto">
        <table role="table" className={`${tableClass} max-md:block md:min-w-[36rem]`}>
          <thead role="rowgroup" className="bg-surface-2 max-md:block">
            <tr role="row" className="max-md:block">
              <th scope="col" role="columnheader" className={`${roleHeadClass} md:sticky md:left-0 md:z-10 md:min-w-[11rem] bg-surface-2 max-md:block max-md:border-b-0 max-md:px-4`}>
                <span className="sr-only">Person, </span>
                <h2 className={`${itemTitleClass} font-display normal-case tracking-normal`}>{title}</h2>
                <span className={`block normal-case tracking-normal ${metaClass}`}>{pluralize(people.length, "person", "people")}</span>
              </th>
              {metrics.map((m) => (
                <th key={m.id} scope="col" role="columnheader" className={`${thClass} text-right align-bottom md:min-w-[7.5rem] max-md:sr-only`}>
                  <span className="block normal-case tracking-normal text-[12px] text-ink-2">{m.name}</span>
                  <span className="tnum block">{m.target === null ? "No target" : `Target ${formatMetricValue(m, m.target)}`}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-md:block">
            {people.map((person) => {
              const own = entries.filter((e) => e.employee_id === person.id);
              const name = displayName(person);
              const division = divisionName(person);
              return (
                <tr key={person.id} role="row" className="hover:bg-surface-2/40 max-md:block max-md:border-b max-md:border-line max-md:px-4 max-md:py-3 max-md:last:border-b-0">
                  <th
                    scope="row"
                    role="rowheader"
                    className="relative border-b border-line bg-surface px-3 py-1.5 text-left align-middle font-normal md:sticky md:left-0 md:z-10 max-md:flex max-md:flex-col max-md:justify-center max-md:border-b-0 max-md:px-0 max-md:py-0 tap:min-h-11"
                  >
                    <Link to={`/people/${person.id}`} className={`block text-sm text-ink hover:text-link ${cellTextClass} ${tapStretchClass}`}>
                      {name}
                    </Link>
                    {division || person.title ? <p className={`${metaClass} ${cellTextClass}`}>{[division, person.title].filter(Boolean).join(" · ")}</p> : null}
                  </th>
                  {metrics.map((m) => {
                    const result = monthResult(m, own.filter((e) => e.metric_id === m.id && monthOf(e.period_month) === month));
                    const year2date = ytd(m, own, year);
                    return (
                      <td
                        key={m.id}
                        role="cell"
                        data-label={m.name}
                        className={`${tdClass} py-1.5 text-right max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:border-b-0 max-md:px-0 max-md:py-1 max-md:text-left max-md:before:text-[12.5px] max-md:before:text-ink-2 max-md:before:content-[attr(data-label)]`}
                      >
                        <span
                          className="inline-block max-md:text-right"
                          aria-label={`${name}, ${m.name}, ${monthLabel(month)}: ${result.value === null ? "" : formatMetricValue(m, result.value)}${verdict(result)}; year to date ${year2date.value === null ? "" : formatMetricValue(m, year2date.value)}${verdict(year2date)}`}
                        >
                          <span className={`tnum block text-[13px] font-medium max-md:inline ${toneOf(result)}`}>{formatMetricValue(m, result.value)}</span>
                          <span className="tnum block text-[11px] text-ink-3 max-md:ml-2 max-md:inline">
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
    </div>
  );
}

export default function ScorecardsPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const allowed = canSeeDivisions(profile);
  const limited = isDivisionLimited(profile);
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
  // A company on demand: the GSRs done in the strip's month, read only for those who see the strip.
  const gsrMonth = company!.gsr_mode === "on_demand" && allowed ? month : null;
  const monthGsrs = useAsync(
    () => (gsrMonth ? listGsrsForLog(companyId, windowRange("month", gsrMonth)).then((rows) => ({ rows, range: windowRange("month", gsrMonth) })) : Promise.resolve(null)),
    [companyId, gsrMonth],
  );

  function chooseYear(next: number) {
    setYear(next);
    setPicked(`${next}-${month.slice(5, 7)}-01`);
  }

  const header = (
    <PageHeader
      eyebrow="People"
      title="Scorecards"
      description={`Each person's role metrics for the month against target, with the year to date${limited ? ", for the people in your divisions" : ""}. Results are entered on each person's profile.`}
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

  const { people, jobRoles, metrics, divisions: allDivisions } = state.data;
  const divisions = viewerDivisions(profile, allDivisions);
  const combinedLabel = limited ? "In your divisions" : "Combined";
  const entries = results.data ?? [];
  const split = allowed && divisions.length > 0;
  const activeScope = split ? scope : COMBINED;
  const active = people.filter((p) => p.is_active);
  const inScope = peopleInScope(active, activeScope);
  const liveMetrics = metrics.filter((m) => m.is_active);
  const scoredRoles = jobRoles
    .filter((r) => r.is_active && liveMetrics.some((m) => m.job_role_id === r.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const allGroups = scoredRoles
    .map((role) => ({
      role,
      metrics: liveMetrics.filter((m) => m.job_role_id === role.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      people: inScope.filter((p) => p.job_role_id === role.id).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    }))
    .filter((g) => g.people.length > 0);
  // Only roles with someone in view are offered; a choice that no longer applies reads as all roles.
  const activeRole = allGroups.some((g) => g.role.id === roleFilter) ? roleFilter : "";
  const groups = allGroups.filter((g) => activeRole === "" || g.role.id === activeRole);
  const scoredRoleIds = new Set(scoredRoles.map((r) => r.id));
  const unscored = activeRole === "" ? inScope.filter((p) => !p.job_role_id || !scoredRoleIds.has(p.job_role_id)).sort((a, b) => displayName(a).localeCompare(displayName(b))) : [];
  const roleName = (id: string | null) => jobRoles.find((r) => r.id === id)?.name ?? null;
  const divisionName = (person: Profile) => (split && person.division_ids.length > 0 ? divisionLabel(person.division_ids, allDivisions) : null);
  const compare = split
    ? divisionCompareRows({ people, divisions, metrics, entries, month, cycle, reviews: monthReviews.data ?? [], omissions: state.data.omissions, combinedLabel, ...(gsrMonth ? { gsrs: monthGsrs.data } : {}) })
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
        {allGroups.length > 1 ? (
          <div>
            <label htmlFor="scorecards-role" className={labelClass}>Job role</label>
            <select id="scorecards-role" value={activeRole} onChange={(e) => setRoleFilter(e.target.value)} className={`${selectClass} w-auto`}>
              <option value="">All roles</option>
              {allGroups.map((g) => (
                <option key={g.role.id} value={g.role.id}>{g.role.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {split ? (
          <div className="sm:ml-auto">
            <p className={`${labelClass} mb-1.5`}>Division</p>
            <DivisionSwitch divisions={divisions} value={activeScope} onChange={setScope} combinedLabel={combinedLabel} />
          </div>
        ) : null}
      </div>

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
          body="An admin adds the metrics each job role is scored on in People, Roles. Then each person's monthly results are entered on their profile, and they gather here."
          action={<Link to="/people/roles"><Button variant="secondary">Open People, Roles</Button></Link>}
        />
      ) : !results.data && !results.error ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-6">
          {groups.length === 0 ? <p className="text-sm text-ink-2">Nobody in this view is in a role with a scorecard.</p> : null}
          {groups.length > 0 ? (
            <section aria-label="Scorecards by job role" className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
              {groups.map((g) => (
                <RoleBlock key={g.role.id} title={g.role.name} people={g.people} metrics={g.metrics} entries={entries} month={month} year={year} divisionName={divisionName} />
              ))}
            </section>
          ) : null}
          {unscored.length > 0 ? (
            <Section eyebrow="Not on a scorecard" title={pluralize(unscored.length, "person", "people")} description="Their job role has no scorecard metrics, or they have no job role yet." padded={false}>
              <ul className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
                {unscored.map((p) => (
                  <li key={p.id} className="relative min-w-0 tap:py-1">
                    <Link to={`/people/${p.id}`} className={`block truncate text-sm text-ink hover:text-link ${tapStretchClass}`}>
                      {displayName(p)}
                    </Link>
                    <span className={`block truncate ${metaClass}`}>{[divisionName(p), roleName(p.job_role_id) ?? "No job role"].filter(Boolean).join(" · ")}</span>
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
