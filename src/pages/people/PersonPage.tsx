// One person, for an admin, in one fixed order: Details (position, hire date, department, who
// they report to, their job role and division), then their role Scorecard (the month-by-month
// results an admin enters against the role's targets), their Goals for this year, next year and
// their BHAG (editable, so a manager can set goals in a one-on-one), the Projects they are on,
// their open Tasks (with the tasks module), this year's KPIs, financial figures and deliverables,
// their impact score, Compensation, and Review history. A goal's action steps and progress notes
// are the person's own and never show here; the month's goals live in the GSR. Each section
// header carries the one action it needs.
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import RatingInput from "../../components/ui/RatingInput.tsx";
import ScoreRing from "../../components/ui/ScoreRing.tsx";
import { bandClass } from "../../components/ui/bandClass.ts";
import Section from "../../components/ui/Section.tsx";
import Stat from "../../components/ui/Stat.tsx";
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import GsrQuarterLine from "../../components/gsr/GsrQuarterLine.tsx";
import CompensationTable from "../../components/people/CompensationTable.tsx";
import DeliverablesPanel from "../../components/people/DeliverablesPanel.tsx";
import FinancialsTable from "../../components/people/FinancialsTable.tsx";
import KpiList from "../../components/people/KpiList.tsx";
import PersonProjects from "../../components/people/PersonProjects.tsx";
import PersonScorecard from "../../components/scorecards/PersonScorecard.tsx";
import PersonTasks from "../../components/tasks/PersonTasks.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { checkboxClass, helpClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { REVIEW_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCriteria, listCycleOmissions, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listScoresForReviews, upsertImpactScore } from "../../services/gsr.ts";
import { listCompanyProfiles, updateProfile, type ProfilePatch } from "../../services/profiles.ts";
import { listCompensation, listEmployeeFinancials, listEmployeeKpis } from "../../services/employees.ts";
import { listJobRoles } from "../../services/jobRoles.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listProjectAssignments } from "../../services/projectAssignments.ts";
import { listProjects } from "../../services/projects.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { hasModule } from "../../lib/modules.ts";
import { averageScore, scoreProfile } from "../../lib/gsr/scoring.ts";
import { latestScoredReview, previousCompletedReview, reviewHistory } from "../../lib/gsr/history.ts";
import { omittedCycleIdsFor, reviewPath, scoredCycleInPlay } from "../../lib/gsr/cycles.ts";
import { scoreGsrMonths } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatMoney, formatPeriod, pluralize } from "../../lib/format.ts";
import { canGrantRole, canSetDivisionAccess, formatTenure, grantableRoles, hasAccount, totalAnnual } from "../../lib/people.ts";
import { REVIEW_STATUS_LABELS, ROLE_LABELS, type Profile, type Role } from "../../types/database.ts";

// The person's division, and for an owner or Rococo, whether they see the division split. Shown
// only once the company has divisions, so a company that does not split reads as it always has.
// A Rococo admin's row is theirs to change, not a company admin's (0029), so it reads only.
function DivisionFields({ companyId, person, me, onPatch }: { companyId: string; person: Profile; me: Profile; onPatch: (patch: ProfilePatch) => void }) {
  const state = useAsync(() => listDivisions(companyId), [companyId]);
  if (state.error && !state.data) return <p className="text-[12px] text-ink-3">Divisions did not load. {state.error}</p>;
  // Nothing until the divisions are in, so the picker never reads "No division" for a moment.
  if (!state.data) return null;
  const divisions = state.data;
  if (divisions.length === 0 && !person.division_id) return null;
  const current = divisions.find((d) => d.id === person.division_id) ?? null;
  if (person.is_rococo_admin) {
    return current ? (
      <div>
        <p className={labelClass}>Division</p>
        <p className="mt-1.5 text-sm text-ink">{current.name}</p>
      </div>
    ) : null;
  }
  const owner = person.role === "owner";
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor="person-division" className={labelClass}>Division</label>
        <select id="person-division" value={person.division_id ?? ""} onChange={(e) => onPatch({ division_id: e.target.value || null })} className={selectClass}>
          <option value="">No division</option>
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      {canSetDivisionAccess(me) ? (
        <div>
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className={`${checkboxClass} mt-0.5`}
              checked={owner || person.can_view_divisions}
              disabled={owner}
              onChange={(e) => onPatch({ can_view_divisions: e.target.checked })}
            />
            <span>Can view divisions</span>
          </label>
          <p className={helpClass}>
            {owner ? "Owners always see the split." : "Sees each division next to the combined company on the dashboard and the Scorecards report."}
          </p>
        </div>
      ) : person.can_view_divisions ? (
        <p className={helpClass}>Sees the division split. Only an owner or Rococo can change that.</p>
      ) : null}
    </div>
  );
}

// The person's scorecard and their projects, loaded together because a per-project metric has a
// row for every project they are on: assigning one here gives it a row there straight away. The
// year's results load on their own, so changing the year leaves the rest standing. Whatever sits
// between the two on the page (their goals) is passed in, so the page keeps its one order.
function ScorecardAndProjects({
  companyId,
  person,
  roleName,
  canEdit,
  linkProjects,
  between,
  onError,
}: {
  companyId: string;
  person: Profile;
  roleName: string | null;
  canEdit: boolean;
  linkProjects: boolean;
  between: ReactNode;
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

  if (base.error && !base.data) {
    return (
      <>
        <Notice tone="error">{base.error}</Notice>
        {between}
      </>
    );
  }
  if (!base.data) {
    return (
      <>
        <SkeletonRows rows={4} />
        {between}
      </>
    );
  }
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
      {between}
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

export default function PersonPage() {
  const { profileId = "" } = useParams();
  const { company, profile: me, isAdmin, refreshProfile } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();
  const [error, setError] = useState("");

  const state = useAsync(async () => {
    const [people, reviews, cycles, pillars, criteria, impact, kpis, compensation, financials, jobRoles, goals, omissions] = await Promise.all([
      listCompanyProfiles(companyId),
      listEmployeeReviews(companyId, profileId),
      listCycles(companyId),
      listPillars(companyId),
      listCriteria(companyId),
      listImpactScores(companyId, profileId),
      listEmployeeKpis(companyId, profileId, year),
      listCompensation(companyId, profileId),
      listEmployeeFinancials(companyId, profileId, year),
      // Retired roles too, so a person still in one shows it rather than a blank.
      listJobRoles(companyId, true),
      // Their goals, for where this quarter's GSRs stand when the company scores them.
      listGoals(companyId, profileId),
      // The months they are omitted from never count toward that (0034).
      listCycleOmissions(companyId),
    ]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { people, person: people.find((p) => p.id === profileId) ?? null, reviews, cycles, pillars, criteria, impact, scores, kpis, compensation, financials, jobRoles, goals, omittedCycleIds: omittedCycleIdsFor(omissions, reviews, profileId) };
  }, [companyId, profileId, year]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;
  const { people, person, reviews, cycles, pillars, criteria, impact, scores, kpis, compensation, financials, jobRoles, goals, omittedCycleIds } = state.data;
  if (!person) return <Notice tone="error">That person is not in this company.</Notice>;
  // For a company that scores its GSRs: where the locked-in months inside the open scored review
  // stand. The same scored cycle the person's own dashboard reads, found among scored cycles first.
  const gsrPillar = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active) ?? null;
  const scoredCycle = scoredCycleInPlay(cycles);
  const gsrQuarter = gsrPillar && scoredCycle ? scoreGsrMonths(scoredCycle, cycles, goals, reviews, gsrPillar.required_goals, omittedCycleIds) : null;
  // The role they are in, and whether it puts their figures on their dashboard. A retired role
  // stays on their record but carries nothing, which is how the dashboard reads it too.
  const jobRole = jobRoles.find((r) => r.id === person.job_role_id) ?? null;
  const roleRetired = jobRole !== null && !jobRole.is_active;
  const figuresOnDashboard = !roleRetired && (jobRole?.dashboard_modules.includes("financials") ?? false);

  const rows = reviewHistory(reviews, cycles, pillars, scores);
  // The newest review and the newest scored review are different rows once a monthly Goal
  // Setting Review, which carries no scores, sits inside a scored quarter. The score figures
  // read the scored one so a finished review is not hidden behind a blank monthly card.
  const latestScored = latestScoredReview(rows);
  // The impact score: the person's current ratings, set here and trued up before each review.
  // The baseline for "up two, down one" is the last signed-off review's frozen ratings.
  const profileScore = scoreProfile(pillars, criteria, impact);
  const baseline = previousCompletedReview(rows);
  const baselineRating = (criterionId: string): number | null =>
    baseline ? (scores.find((s) => s.review_id === baseline.review.id && s.criterion_id === criterionId)?.rating ?? null) : null;
  const ratingPillars = pillars.filter((p) => p.scoring_type === "rating" && p.is_active);
  const impactByCriterion = new Map(impact.map((i) => [i.criterion_id, i]));
  const deltas = criteria
    .filter((c) => c.is_active)
    .map((c) => {
      const current = impactByCriterion.get(c.id)?.rating ?? null;
      const was = baselineRating(c.id);
      return { criterion: c, current, was, delta: current !== null && was !== null ? current - was : null };
    });
  const moved = deltas.filter((d) => d.delta !== null && d.delta !== 0).sort((a, b) => (b.delta as number) - (a.delta as number));
  const biggestGain = moved.find((d) => (d.delta as number) > 0) ?? null;
  const slipped = [...moved].reverse().find((d) => (d.delta as number) < 0) ?? null;

  async function setRating(criterionId: string, rating: number | null) {
    if (rating === null) return;
    setError("");
    try {
      const saved = await upsertImpactScore({ employee_id: person!.id, criterion_id: criterionId, rating, set_by: me.id });
      state.setData((prev) => (prev ? { ...prev, impact: prev.impact.some((i) => i.id === saved.id) ? prev.impact.map((i) => (i.id === saved.id ? saved : i)) : [...prev.impact, saved] } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function setImpactNote(criterionId: string, note: string | null) {
    const current = impactByCriterion.get(criterionId);
    if (!current) return;
    setError("");
    try {
      const saved = await upsertImpactScore({ employee_id: person!.id, criterion_id: criterionId, rating: current.rating, note, set_by: me.id });
      state.setData((prev) => (prev ? { ...prev, impact: prev.impact.map((i) => (i.id === saved.id ? saved : i)) } : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const average = averageScore(rows.map((r) => r.result?.overall ?? null));
  const self = person.id === me.id;
  // A Rococo admin placed on a company roster keeps their role and access with Rococo: the
  // database refuses a company admin's change to their row (0029), so no role control is offered,
  // the same as their row on the People list.
  const rococo = person.is_rococo_admin;
  const canChangeRole = canGrantRole(me, person.role);
  const tenure = formatTenure(person.hire_date);
  const manager = person.reports_to ? people.find((p) => p.id === person.reports_to) ?? null : null;

  const goalsBlock = (
    <section aria-labelledby="person-goals-heading">
      <div className="mb-3">
        <p className="eyebrow">Goals</p>
        <h2 id="person-goals-heading" className="mt-1 font-display text-lg text-heading">This year, next year and the BHAG</h2>
      </div>
      <GoalsPanel companyId={companyId} employeeId={person.id} canEdit ownerName={displayName(person).split(" ")[0]} />
    </section>
  );

  async function patch(patchValue: Parameters<typeof updateProfile>[1]) {
    setError("");
    try {
      const next: Profile = await updateProfile(person!.id, patchValue);
      state.setData((prev) => (prev ? { ...prev, person: next, people: prev.people.map((p) => (p.id === next.id ? next : p)) } : prev));
      // HubContext holds the sign-in snapshot of who you are, and the sidebar footer renders it
      // from a layout route that never remounts. Editing your own name or title here otherwise
      // left the old one in the corner of every screen until the next sign-in.
      if (next.id === me.id) await refreshProfile();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        backTo="/people"
        backLabel="People"
        eyebrow={person.title ?? ROLE_LABELS[person.role]}
        title={displayName(person)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {person.email}
            {!hasAccount(person) ? (
              <Badge tone="warning">Not signed in yet</Badge>
            ) : (
              <Badge tone={person.is_active ? "success" : "neutral"}>{person.is_active ? "Active" : "Inactive"}</Badge>
            )}
            {person.hire_date ? <span className="text-ink-3">Hired {formatDate(person.hire_date)}{tenure ? ` · ${tenure}` : ""}</span> : null}
            {manager ? <span className="text-ink-3">Reports to {displayName(manager)}</span> : null}
          </span>
        }
      />
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Section eyebrow="Profile" title="Details">
            <div className="flex items-center gap-3">
              <Avatar person={person} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{displayName(person)}</p>
                <p className="truncate text-[12px] text-ink-3">{person.email}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="person-name" className={labelClass}>Name</label>
                <BlurInput id="person-name" value={person.full_name ?? ""} placeholder="Full name" onSave={(next) => void patch({ full_name: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-title" className={labelClass}>Title</label>
                <BlurInput id="person-title" value={person.title ?? ""} placeholder="Their position" onSave={(next) => void patch({ title: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-department" className={labelClass}>Department</label>
                <BlurInput id="person-department" value={person.department ?? ""} placeholder="Their department" onSave={(next) => void patch({ department: next.trim() || null })} />
              </div>
              <div>
                <label htmlFor="person-hire-date" className={labelClass}>Hire date</label>
                <BlurInput id="person-hire-date" type="date" value={person.hire_date ?? ""} onSave={(next) => void patch({ hire_date: next || null })} />
                {tenure ? <p className="mt-1 text-[12px] text-ink-3">{tenure}</p> : null}
              </div>
              <div>
                <label htmlFor="person-reports-to" className={labelClass}>Reports to</label>
                <select id="person-reports-to" value={person.reports_to ?? ""} onChange={(e) => void patch({ reports_to: e.target.value || null })} className={selectClass}>
                  <option value="">Nobody</option>
                  {people.filter((p) => p.id !== person.id && p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>{displayName(p)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="person-job-role" className={labelClass}>Job role</label>
                <select id="person-job-role" value={person.job_role_id ?? ""} onChange={(e) => void patch({ job_role_id: e.target.value || null })} className={selectClass}>
                  <option value="">Not set</option>
                  {jobRoles.filter((r) => r.is_active || r.id === person.job_role_id).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.is_active ? "" : " (retired)"}</option>
                  ))}
                </select>
                {jobRoles.length === 0 ? (
                  <p className="mt-1 text-[12px] text-ink-3">
                    No job roles yet. Admins add them in <Link to="/settings/roles" className="text-accent hover:underline">Settings, Roles</Link>.
                  </p>
                ) : null}
                {roleRetired && jobRole ? (
                  <p className="mt-1 text-[12px] text-warning">
                    {jobRole.name} is retired, so it no longer puts its modules on their dashboard or offers its role goals. Pick a current role.
                  </p>
                ) : null}
              </div>
              <DivisionFields companyId={companyId} person={person} me={me} onPatch={(next) => void patch(next)} />
              <div>
                <label htmlFor="person-phone" className={labelClass}>Phone</label>
                <BlurInput id="person-phone" value={person.phone ?? ""} placeholder="(555) 010-0000" onSave={(next) => void patch({ phone: next.trim() || null })} />
              </div>
              {rococo ? (
                <div>
                  <p className={labelClass}>Role</p>
                  <div className="mt-1.5">
                    <Badge>Rococo Creative</Badge>
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="person-role" className={labelClass}>Role</label>
                  <select id="person-role" value={person.role} disabled={self || !canChangeRole} onChange={(e) => void patch({ role: e.target.value as Role })} className={selectClass}>
                    {(canChangeRole ? grantableRoles(me) : [person.role]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  {!canChangeRole && !self ? <p className="mt-1 text-[12px] text-ink-3">Only an owner or Rococo can change this person's role.</p> : null}
                </div>
              )}
            </div>
          </Section>
          <div className="grid gap-4">
            <Stat label="Annual compensation" value={formatMoney(totalAnnual(compensation))} hint={compensation.length > 0 ? `${formatMoney(totalAnnual(compensation) / 12)} a month` : "Not recorded"} />
            <Stat label="Latest score" value={<span className={bandClass(latestScored?.result?.overall ?? null)}>{latestScored?.result?.overall ?? "-"}</span>} hint={latestScored?.cycle?.name ?? "Not scored yet"} />
            <Stat label="Average" value={average ?? "-"} hint={pluralize(rows.length, "review")} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {rococo ? goalsBlock : (
            <ScorecardAndProjects
              companyId={companyId}
              person={person}
              roleName={jobRole?.name ?? null}
              canEdit={isAdmin}
              linkProjects={hasModule(company, "production")}
              between={goalsBlock}
              onError={setError}
            />
          )}
          {hasModule(company, "tasks") && !rococo ? <PersonTasks companyId={companyId} person={person} /> : null}
          <Section eyebrow={String(year)} title="Personal KPIs" description="The numbers this person owns for the year. They show at the top of every review.">
            <KpiList companyId={companyId} employeeId={person.id} year={year} kpis={kpis} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, kpis: update(prev.kpis) } : prev))} onError={setError} />
          </Section>
          <Section
            eyebrow={String(year)}
            title="Financial figures"
            description={
              figuresOnDashboard && jobRole
                ? `The numbers this person owns, against target. On their dashboard, because ${jobRole.name} carries the module.`
                : roleRetired && jobRole
                  ? `The numbers this person owns, against target. Not on their dashboard: ${jobRole.name} is retired. They come back once a current role that carries the module is set above.`
                  : jobRole
                    ? `The numbers this person owns, against target. Not on their dashboard: ${jobRole.name} does not carry the module. Turn it on for the role in Settings, Roles.`
                    : "The numbers this person owns, against target. They reach their dashboard once a job role that carries the module is set above."
            }
          >
            <FinancialsTable employeeId={person.id} year={year} rows={financials} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, financials: update(prev.financials) } : prev))} onError={setError} />
          </Section>
          <Section
            eyebrow={String(year)}
            title="Deliverables"
            description="What this person owns, grouped the way the company thinks about it. Each heading is scored by the tasks under it: two points a task, so a Hit on every one lands on target."
          >
            <DeliverablesPanel companyId={companyId} employeeId={person.id} year={year} canEdit />
          </Section>
          {ratingPillars.length > 0 ? (
            <Section
              eyebrow="Impact score"
              title={profileScore.overall > 0 || impact.length > 0 ? String(profileScore.overall) : "Not rated yet"}
              description={
                baseline
                  ? `Set here and trued up before each review; frozen into the review at sign-off. Compared with ${baseline.cycle?.name ?? "the last review"}.`
                  : "Set here and trued up before each review; frozen into the review at sign-off."
              }
            >
              {biggestGain || slipped ? (
                <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
                  {biggestGain ? (
                    <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-ink">
                      Biggest gain: {biggestGain.criterion.name} +{biggestGain.delta}
                    </span>
                  ) : null}
                  {slipped ? (
                    <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-0.5 text-ink">
                      Slipped: {slipped.criterion.name} {slipped.delta}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-5">
                {ratingPillars.map((pillar) => {
                  const summary = profileScore.pillars.find((p) => p.pillarId === pillar.id);
                  const own = deltas.filter((d) => d.criterion.pillar_id === pillar.id);
                  return (
                    <div key={pillar.id}>
                      <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                        <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">{pillar.name}</p>
                        <span className={`tnum text-sm ${summary?.score === null || summary?.score === undefined ? "text-ink-3" : "text-heading"}`}>
                          {summary?.score === null || summary?.score === undefined ? "-" : Math.round(summary.score)}
                        </span>
                      </div>
                      {own.length === 0 ? (
                        <p className="mt-2 text-[12.5px] text-ink-3">
                          No criteria yet. Admins add them per pillar in <Link to="/settings/reviews" className="text-accent hover:underline">Settings, Reviews</Link>.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {own.map(({ criterion, current, was, delta }) => (
                            <li key={criterion.id} className="py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0 max-w-md">
                                  <p className="text-sm text-ink">{criterion.name}</p>
                                  {criterion.description ? <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{criterion.description}</p> : null}
                                </div>
                                <div className="flex items-center gap-3">
                                  {was !== null ? (
                                    <span
                                      aria-label={`Change for ${criterion.name}`}
                                      className={`tnum text-[12px] ${delta === null || delta === 0 ? "text-ink-3" : delta > 0 ? "text-success" : "text-danger"}`}
                                    >
                                      {delta === null ? `was ${was}` : delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "no change"}
                                    </span>
                                  ) : null}
                                  <RatingInput label={`${criterion.name} rating`} value={current} max={pillar.rating_scale_max} onChange={(next) => void setRating(criterion.id, next)} />
                                </div>
                              </div>
                              {current !== null ? (
                                <BlurInput
                                  value={impactByCriterion.get(criterion.id)?.note ?? ""}
                                  placeholder="Why this rating"
                                  ariaLabel={`Note on ${criterion.name}`}
                                  onSave={(next) => void setImpactNote(criterion.id, next.trim() || null)}
                                  className={`${inputClass} mt-2 text-[12.5px]`}
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
              {gsrQuarter && scoredCycle ? <GsrQuarterLine cycle={scoredCycle} figure={gsrQuarter} /> : null}
            </Section>
          ) : null}
          <Section eyebrow="Compensation" title="Compensation" description="Annual amounts; the monthly figure is derived. Company admins only." padded={false}>
            <CompensationTable companyId={companyId} employeeId={person.id} items={compensation} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, compensation: update(prev.compensation) } : prev))} onError={setError} />
          </Section>
          <Section
            eyebrow="Reviews"
            title="Review history"
            padded={false}
            actions={<Link to="/reviews" className="text-[13px] text-accent hover:underline">Review cycles</Link>}
          >
            {rows.length === 0 ? (
              <p className="p-5 text-sm text-ink-2">
                No reviews yet. An admin opens a cycle in <Link to="/reviews" className="text-accent hover:underline">Reviews</Link> or <Link to="/gsr" className="text-accent hover:underline">Monthly GSRs</Link>, and everyone on the roster gets one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Cycle</th>
                      <th className={thClass}>Period</th>
                      <th className={thClass}>Status</th>
                      <th className={`${thClass} text-right`}>Score</th>
                      <th className={thClass}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ review, cycle, result }) => (
                      <tr key={review.id} className="hover:bg-surface-2/60">
                        <td className={tdClass}>{cycle?.name ?? "Review"}</td>
                        <td className={`${tdClass} text-ink-2`}>{cycle ? formatPeriod(cycle.period_start, cycle.period_end) : "-"}</td>
                        <td className={tdClass}><Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge></td>
                        <td className={`${tdClass} tnum text-right font-medium ${bandClass(result?.overall ?? null)}`}>{result?.overall ?? "-"}</td>
                        <td className={`${tdClass} text-right`}><Link to={cycle ? reviewPath(review.id, cycle.cadence) : `/gsr/reviews/${review.id}`} className="text-[13px] text-accent hover:underline">Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {latestScored?.result ? (
            <Section eyebrow="Latest scored review" title={latestScored.cycle?.name ?? "Scores"}>
              <div className="flex items-center gap-5">
                <ScoreRing score={latestScored.result.overall} size={80} />
                <ul className="flex-1 space-y-1 text-sm">
                  {latestScored.result.pillars.map((p) => (
                    <li key={p.pillarId} className="flex justify-between gap-3">
                      <span className="text-ink-2">{p.name}</span>
                      <span className="tnum text-ink">{p.score === null ? "-" : Math.round(p.score)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
