// One person, for an admin or a manager, in one fixed order: Details (position, hire date,
// department, who they report to, their job role and divisions), this month's GSR, their role
// Scorecard (the month-by-month results an admin enters against the role's targets), their Goals for
// this year, next year and their BHAG, the Projects they are on, their Tasks, this year's KPIs,
// financial figures and deliverables, their impact score, Compensation, and Review history. A goal's
// action steps and progress notes are the person's own and never show here; the month's goals live
// in the GSR. Each section header carries the one action it needs.
//
// An admin runs the record. A manager reads it for the people they lead or may see: the profile,
// scorecard, goals, KPIs, deliverables and ratings read only; they add and edit the person's tasks
// and open or start this month's GSR. Pay and financial figures are an admin's alone, so a manager's
// page never asks for them, and profile fields read as plain text. Everything is read by the active
// company, so a person the database does not show the viewer (another division, another company, a
// stale id after the switcher moved) reads as no access rather than leaking a record.
//
// Profile writes go out one at a time in the order they were made, so an older answer never lands
// over a newer one, and an answer for a person or company the page has since left is dropped. A
// rating and its note on the same criterion share a queue for the same reason.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PencilLine } from "lucide-react";
import Avatar from "../../components/ui/Avatar.tsx";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
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
import { ensureReview, listCriteria, listCycleOmissions, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listScoresForReviews, upsertImpactScore } from "../../services/gsr.ts";
import { listDirectory } from "../../services/directory.ts";
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
import { gsrCycleInPlay, omittedCycleIdsFor, reviewPath, scoredCycleInPlay } from "../../lib/gsr/cycles.ts";
import { scoreGsrMonths } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatMoney, formatPeriod, pluralize } from "../../lib/format.ts";
import { canGrantRole, canSetDivisionAccess, canViewDivision, directoryById, divisionLabel, formatTenure, grantableRoles, hasAccount, ledBy, nameFromDirectory, totalAnnual } from "../../lib/people.ts";
import { REVIEW_STATUS_LABELS, ROLE_LABELS, type CompanyDivision, type Goal, type ImpactScore, type Profile, type Review, type ReviewCycle, type Role } from "../../types/database.ts";

type Patch = (patch: ProfilePatch) => Promise<boolean>;

// A label and a value, for a field the viewer reads but does not change.
function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <p className="mt-1.5 text-sm text-ink">{children}</p>
    </div>
  );
}

// Ids in the company's division order, with anything not one of its divisions kept at the end, so a
// write never drops an id the viewer was not shown.
function inDivisionOrder(ids: readonly string[], divisions: readonly CompanyDivision[]): string[] {
  const known = divisions.map((d) => d.id).filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

// Toggles one id in a list kept in the company's division order.
function toggled(ids: readonly string[], id: string, on: boolean, divisions: readonly CompanyDivision[]): string[] {
  return inDivisionOrder(on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id), divisions);
}

// A list being saved: what the boxes show while writes are in flight, so two quick ticks build on
// each other, and the stored value again once every write has settled.
function usePendingList(stored: readonly string[]) {
  const [pending, setPending] = useState<string[] | null>(null);
  const inflight = useRef(0);
  async function save(next: string[], write: () => Promise<boolean>) {
    setPending(next);
    inflight.current += 1;
    try {
      await write();
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setPending(null);
    }
  }
  return { value: pending ?? [...stored], save };
}

// What a manager or an admin may see beyond where they work, set by an owner or Rococo only: every
// division, chosen divisions, or none. Kept apart from membership on purpose, and from the
// dashboard split toggle below it, which only changes the figures they see.
function ViewAccessFields({ person, divisions, onPatch }: { person: Profile; divisions: CompanyDivision[]; onPatch: Patch }) {
  const [choosing, setChoosing] = useState(false);
  const [pendingAll, setPendingAll] = useState<boolean | null>(null);
  const ids = usePendingList(person.view_division_ids);
  const all = pendingAll ?? person.view_all_divisions;
  const mode = all ? "all" : ids.value.length > 0 || choosing ? "chosen" : "none";
  const first = displayName(person).split(" ")[0];
  const group = `view-access-${person.id}`;

  async function setAll(next: boolean, extra: ProfilePatch = {}) {
    setPendingAll(next);
    try {
      await onPatch({ view_all_divisions: next, ...extra });
    } finally {
      setPendingAll(null);
    }
  }

  function pick(next: "all" | "chosen" | "none") {
    if (next === mode) return;
    setChoosing(next === "chosen");
    if (next === "all") void setAll(true);
    else if (next === "chosen") {
      if (all) void setAll(false);
    }
    else void ids.save([], () => setAll(false, { view_division_ids: [] }).then(() => true));
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className={labelClass}>Can view</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["all", "All divisions"],
            ["chosen", "Chosen divisions"],
            ["none", "None"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
            <input type="radio" name={group} value={value} checked={mode === value} onChange={() => pick(value)} />
            {label}
          </label>
        ))}
      </div>
      {mode === "chosen" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => (
            <label key={d.id} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input
                type="checkbox"
                className={checkboxClass}
                aria-label={`Can view ${d.name}`}
                checked={ids.value.includes(d.id)}
                onChange={(e) => {
                  const next = toggled(ids.value, d.id, e.target.checked, divisions);
                  void ids.save(next, () => onPatch({ view_division_ids: next }));
                }}
              />
              {d.name}
            </label>
          ))}
        </div>
      ) : null}
      <p className={helpClass}>
        Whose records {first} may open, apart from where they work. They always see the people who report to them and the people below those.{" "}
        {person.role === "admin" ? "As an admin they also see everyone not placed in a division." : "As a manager they see only employees in these divisions."}{" "}
        A role change made by anyone but an owner or Rococo clears this.
      </p>
    </fieldset>
  );
}

// The divisions a person works in, then, for an owner or Rococo, what an admin or a manager may see
// and whether they see the division split. Shown only once the company has divisions, so a company
// that does not split reads as it always has. An admin places people only in divisions they can
// view; any other division a person is in shows, ticked and locked. A Rococo admin's row is theirs
// to change, not a company admin's (0029), and a manager reads all of it, so both read only.
function DivisionFields({ companyId, person, me, canEdit, onPatch }: { companyId: string; person: Profile; me: Profile; canEdit: boolean; onPatch: Patch }) {
  const state = useAsync(() => listDivisions(companyId), [companyId]);
  const membership = usePendingList(person.division_ids);
  if (state.error && !state.data) return <p className="text-[12px] text-ink-3">Divisions did not load. {state.error}</p>;
  // Nothing until the divisions are in, so the field never reads "No division" for a moment.
  if (!state.data) return null;
  const divisions = state.data;
  if (divisions.length === 0 && person.division_ids.length === 0) return null;
  const current = membership.value;
  if (!canEdit || person.is_rococo_admin) {
    return <ReadOnlyField label="Division">{divisionLabel(current, divisions)}</ReadOnlyField>;
  }
  const owner = person.role === "owner";
  const leadsPeople = person.role === "admin" || person.role === "manager";
  const setsAccess = canSetDivisionAccess(me);
  const locked = divisions.filter((d) => !canViewDivision(me, d.id));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className={labelClass}>Divisions</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {divisions.map((d) => {
            const canPlace = canViewDivision(me, d.id);
            return (
              <label key={d.id} className={`inline-flex items-center gap-1.5 text-[13px] ${canPlace ? "text-ink" : "text-ink-3"}`}>
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={current.includes(d.id)}
                  disabled={!canPlace}
                  onChange={(e) => {
                    const next = toggled(current, d.id, e.target.checked, divisions);
                    void membership.save(next, () => onPatch({ division_ids: next }));
                  }}
                />
                {d.name}
              </label>
            );
          })}
        </div>
        <p className={helpClass}>
          Works in: {divisionLabel(current, divisions)}.{divisions.length === 2 ? " Tick both for Both." : ""}
          {locked.length > 0 ? ` ${locked.map((d) => d.name).join(", ")} is outside the divisions you can view, so it stays as it is.` : ""}
        </p>
      </fieldset>
      {leadsPeople && setsAccess ? (
        <ViewAccessFields person={person} divisions={divisions} onPatch={onPatch} />
      ) : leadsPeople ? (
        <p className={helpClass}>
          Can view {person.view_all_divisions ? "all divisions" : person.view_division_ids.length > 0 ? divisionLabel(person.view_division_ids, divisions) : "no divisions beyond their own team"}. Only an owner or Rococo can change that.
        </p>
      ) : null}
      {setsAccess ? (
        <div>
          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className={`${checkboxClass} mt-0.5`}
              checked={owner || person.can_view_divisions}
              disabled={owner}
              onChange={(e) => void onPatch({ can_view_divisions: e.target.checked })}
            />
            <span>Can view divisions</span>
          </label>
          <p className={helpClass}>
            {owner
              ? "Owners always see the split."
              : "The division split on the dashboard and the Scorecards report: each division next to the combined company. It changes the figures they see, not whose records they can open."}
          </p>
        </div>
      ) : person.can_view_divisions ? (
        <p className={helpClass}>Sees the division split on the dashboard. Only an owner or Rococo can change that.</p>
      ) : null}
    </div>
  );
}

// This month's Goal Setting Review for the person, for an admin or someone who leads them: a link
// into it when it is open, or a way to start it. Starting is an insert that ignores a duplicate
// (ensureReview), so two people starting at once land on the same review. A company that has never
// run a monthly GSR gets nothing here; one with no month open, or a person left out of it, gets a
// line saying so.
function ThisMonthGsr({
  companyId,
  person,
  cycles,
  reviews,
  omittedCycleIds,
}: {
  companyId: string;
  person: Profile;
  cycles: ReviewCycle[];
  reviews: Review[];
  omittedCycleIds: string[];
}) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  if (!cycles.some((c) => c.cadence === "monthly")) return null;
  const cycle = gsrCycleInPlay(cycles);
  const review = cycle ? (reviews.find((r) => r.cycle_id === cycle.id) ?? null) : null;
  const first = displayName(person).split(" ")[0];

  async function start() {
    if (!cycle || starting) return;
    setStarting(true);
    setError("");
    try {
      const opened = await ensureReview(cycle.id, companyId, person.id);
      navigate(reviewPath(opened.id, cycle.cadence));
    } catch (err) {
      setError(errorMessage(err));
      setStarting(false);
    }
  }

  let body: ReactNode;
  if (!cycle) {
    body = <p className="text-[13px] text-ink-2">No month is open for GSRs. An admin opens each month in Monthly GSRs.</p>;
  } else if (review) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-ink">
          {cycle.name}
          <Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge>
        </span>
        <Link to={reviewPath(review.id, cycle.cadence)} className="text-[13px] font-medium text-accent hover:underline">Open {cycle.name} GSR</Link>
      </div>
    );
  } else if (omittedCycleIds.includes(cycle.id)) {
    body = <p className="text-[13px] text-ink-2">{first} is left out of the {cycle.name} GSRs, so there is nothing to start.</p>;
  } else if (!person.is_active) {
    body = <p className="text-[13px] text-ink-2">{first} is inactive, so they are not in the {cycle.name} GSRs.</p>;
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">{cycle.name} is open. {first}'s GSR has not been started.</span>
        <Button size="sm" disabled={starting} onClick={() => void start()}>
          <PencilLine size={14} aria-hidden /> {starting ? "Starting..." : "Start this month's GSR"}
        </Button>
      </div>
    );
  }
  return (
    <Section eyebrow="Goal Setting Review" title="This month's GSR">
      {body}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
    </Section>
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

// The key a write belongs to: the person and the company the page showed when it was made.
const keyOf = (companyId: string, profileId: string) => `${companyId}:${profileId}`;

export default function PersonPage() {
  const { profileId = "" } = useParams();
  const { company, profile: me, isAdmin, isRococo, refreshProfile } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();
  const [error, setError] = useState("");
  // Where the page is now, so a write that lands after the person or company changed is dropped
  // instead of being painted onto another record (D14).
  const pageKey = keyOf(companyId, profileId);
  const keyRef = useRef(pageKey);
  useEffect(() => {
    keyRef.current = pageKey;
  }, [pageKey]);
  // Profile writes, one after another in the order they were made (D5).
  const profileQueue = useRef<Promise<unknown>>(Promise.resolve());
  // Ratings and notes, one queue per person and criterion, with what the latest click and note
  // want, read when each write runs (B9).
  const impactQueues = useRef(new Map<string, Promise<unknown>>());
  const impactWanted = useRef(new Map<string, { rating: number | null; note: string | null }>());

  const state = useAsync(async () => {
    const [people, directory, reviews, cycles, pillars, criteria, impact, kpis, compensation, financials, jobRoles, goals, omissions] = await Promise.all([
      listCompanyProfiles(companyId),
      // Names for whoever the viewer cannot see, such as the manager of someone in their view.
      // Only a name, so a failed read leaves a fallback rather than an error.
      listDirectory(companyId).catch(() => []),
      listEmployeeReviews(companyId, profileId),
      listCycles(companyId),
      listPillars(companyId),
      listCriteria(companyId),
      listImpactScores(companyId, profileId),
      listEmployeeKpis(companyId, profileId, year),
      // Pay and financial figures are an admin's alone; the database returns a manager nothing,
      // so a manager's page does not ask.
      isAdmin ? listCompensation(companyId, profileId) : Promise.resolve([]),
      isAdmin ? listEmployeeFinancials(companyId, profileId, year) : Promise.resolve([]),
      // Retired roles too, so a person still in one shows it rather than a blank.
      listJobRoles(companyId, true),
      // Their goals, for where this quarter's GSRs stand when the company scores them.
      listGoals(companyId, profileId),
      // The months they are omitted from never count toward that (0034).
      listCycleOmissions(companyId),
    ]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { people, directory, person: people.find((p) => p.id === profileId) ?? null, reviews, cycles, pillars, criteria, impact, scores, kpis, compensation, financials, jobRoles, goals, omittedCycleIds: omittedCycleIdsFor(omissions, reviews, profileId) };
  }, [companyId, profileId, year, isAdmin]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;
  const { people, directory, person, reviews, cycles, pillars, criteria, impact, scores, kpis, compensation, financials, jobRoles, goals, omittedCycleIds } = state.data;
  // A Rococo admin reads every row, so a missing person is not in this company. Anyone else may
  // simply not be shown them, and the page says that instead of guessing why.
  if (!person) return <Notice tone="error">{isRococo ? "That person is not in this company." : "You do not have access to this person."}</Notice>;
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
  const personId = person.id;
  const writeKey = pageKey;

  // Writes one criterion's rating and note through its queue. Each write sends what the latest
  // click and note want when it runs, so a note saved after a new rating never puts the old
  // rating back.
  function writeImpact(criterionId: string, change: { rating?: number; note?: string | null }): Promise<boolean> {
    const key = `${personId}:${criterionId}`;
    const stored = impactByCriterion.get(criterionId);
    const base = impactWanted.current.get(key) ?? { rating: stored?.rating ?? null, note: stored?.note ?? null };
    impactWanted.current.set(key, { ...base, ...change });
    const run = (impactQueues.current.get(key) ?? Promise.resolve()).then(async () => {
      const want = impactWanted.current.get(key);
      if (!want || want.rating === null) return false;
      try {
        const saved: ImpactScore = await upsertImpactScore({ employee_id: personId, criterion_id: criterionId, rating: want.rating, note: want.note, set_by: me.id });
        // Nothing newer waiting, so the next click starts from what the database now holds.
        if (impactQueues.current.get(key) === run) impactWanted.current.delete(key);
        if (keyRef.current !== writeKey) return true;
        setError("");
        state.setData((prev) =>
          prev && prev.person?.id === personId
            ? { ...prev, impact: prev.impact.some((i) => i.id === saved.id) ? prev.impact.map((i) => (i.id === saved.id ? saved : i)) : [...prev.impact, saved] }
            : prev,
        );
        return true;
      } catch (err) {
        // The next write starts again from what the database holds.
        impactWanted.current.delete(key);
        if (keyRef.current === writeKey) setError(errorMessage(err));
        return false;
      }
    });
    impactQueues.current.set(key, run);
    return run;
  }

  const average = averageScore(rows.map((r) => r.result?.overall ?? null));
  const self = person.id === me.id;
  // A Rococo admin placed on a company roster keeps their role and access with Rococo: the
  // database refuses a company admin's change to their row (0029), so no role control is offered,
  // the same as their row on the People list.
  const rococo = person.is_rococo_admin;
  const canChangeRole = canGrantRole(me, person.role);
  const tenure = formatTenure(person.hire_date);
  // Who they report to: from the people the viewer sees, else the company directory, so a manager
  // who is inactive or outside the viewer's divisions still reads by name (D6).
  const names = directoryById(directory);
  const manager = person.reports_to ? (people.find((p) => p.id === person.reports_to) ?? null) : null;
  const managerEntry = person.reports_to ? (names.get(person.reports_to) ?? null) : null;
  const managerName = person.reports_to ? (manager ? displayName(manager) : nameFromDirectory(names, person.reports_to, "Someone outside your view")) : null;
  const managerInactive = manager ? !manager.is_active : managerEntry ? !managerEntry.is_active : false;
  const managerChoices = people.filter((p) => p.id !== person.id && p.is_active);
  const keepCurrentManager = person.reports_to !== null && !managerChoices.some((p) => p.id === person.reports_to);
  // A chain gives an employee nothing: they see this person once they are a manager.
  const managerIsEmployee = manager?.role === "employee";
  // The viewer runs the record (an admin), or leads this person (a manager over their chain).
  const isLeader = isAdmin || ledBy(me, people).some((p) => p.id === person.id);
  // How a task's GSR goal reads on the Tasks list: the month it belongs to.
  const goalById = new Map<string, Goal>(goals.map((g) => [g.id, g]));
  const goalLabel = (goalId: string): string | null => {
    const goal = goalById.get(goalId);
    const cycle = goal?.cycle_id ? cycles.find((c) => c.id === goal.cycle_id) : undefined;
    return cycle ? `${cycle.name} GSR` : null;
  };

  const goalsBlock = (
    <section aria-labelledby="person-goals-heading">
      <div className="mb-3">
        <p className="eyebrow">Goals</p>
        <h2 id="person-goals-heading" className="mt-1 font-display text-lg text-heading">This year, next year and the BHAG</h2>
      </div>
      <GoalsPanel companyId={companyId} employeeId={person.id} canEdit={isAdmin} ownerName={displayName(person).split(" ")[0]} />
    </section>
  );

  // Saves profile fields through the page's queue and reports whether they landed, so a field that
  // did not save says so and keeps what was typed.
  function patch(patchValue: ProfilePatch): Promise<boolean> {
    const run = profileQueue.current.then(async () => {
      let next: Profile;
      try {
        next = await updateProfile(personId, patchValue);
      } catch (err) {
        if (keyRef.current === writeKey) setError(errorMessage(err));
        return false;
      }
      if (keyRef.current !== writeKey) return true;
      setError("");
      state.setData((prev) => (prev && prev.person?.id === next.id ? { ...prev, person: next, people: prev.people.map((p) => (p.id === next.id ? next : p)) } : prev));
      // HubContext holds the sign-in snapshot of who you are, and the sidebar footer renders it
      // from a layout route that never remounts. Editing your own name or title here otherwise
      // left the old one in the corner of every screen until the next sign-in. The save has
      // landed either way, so a refresh that fails is not reported as a failed save (D15).
      if (next.id === me.id) await refreshProfile().catch(() => undefined);
      return true;
    });
    profileQueue.current = run;
    return run;
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
            {managerName ? <span className="text-ink-3">Reports to {managerName}</span> : null}
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
            {isAdmin ? (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="person-name" className={labelClass}>Name</label>
                  <BlurInput id="person-name" value={person.full_name ?? ""} placeholder="Full name" onSave={(next) => patch({ full_name: next.trim() || null })} />
                </div>
                <div>
                  <label htmlFor="person-title" className={labelClass}>Title</label>
                  <BlurInput id="person-title" value={person.title ?? ""} placeholder="Their position" onSave={(next) => patch({ title: next.trim() || null })} />
                </div>
                <div>
                  <label htmlFor="person-department" className={labelClass}>Department</label>
                  <BlurInput id="person-department" value={person.department ?? ""} placeholder="Their department" onSave={(next) => patch({ department: next.trim() || null })} />
                </div>
                <div>
                  <label htmlFor="person-hire-date" className={labelClass}>Hire date</label>
                  <BlurInput id="person-hire-date" type="date" value={person.hire_date ?? ""} onSave={(next) => patch({ hire_date: next || null })} />
                  {tenure ? <p className="mt-1 text-[12px] text-ink-3">{tenure}</p> : null}
                </div>
                <div>
                  <label htmlFor="person-reports-to" className={labelClass}>Reports to</label>
                  <select id="person-reports-to" value={person.reports_to ?? ""} onChange={(e) => void patch({ reports_to: e.target.value || null })} className={selectClass}>
                    <option value="">Nobody</option>
                    {keepCurrentManager && person.reports_to ? (
                      <option value={person.reports_to}>{managerName}{managerInactive ? " (inactive)" : ""}</option>
                    ) : null}
                    {managerChoices.map((p) => (
                      <option key={p.id} value={p.id}>{displayName(p)}</option>
                    ))}
                  </select>
                  {managerIsEmployee ? <p className="mt-1 text-[12px] text-warning">They will not see this person until they are a manager.</p> : null}
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
                <DivisionFields companyId={companyId} person={person} me={me} canEdit onPatch={patch} />
                <div>
                  <label htmlFor="person-phone" className={labelClass}>Phone</label>
                  <BlurInput id="person-phone" value={person.phone ?? ""} placeholder="(555) 010-0000" onSave={(next) => patch({ phone: next.trim() || null })} />
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
            ) : (
              <div className="mt-4 space-y-3">
                <ReadOnlyField label="Title">{person.title || "Not set"}</ReadOnlyField>
                <ReadOnlyField label="Department">{person.department || "Not set"}</ReadOnlyField>
                <ReadOnlyField label="Hire date">{person.hire_date ? `${formatDate(person.hire_date)}${tenure ? ` · ${tenure}` : ""}` : "Not set"}</ReadOnlyField>
                <ReadOnlyField label="Reports to">{managerName ? `${managerName}${managerInactive ? " (inactive)" : ""}` : "Nobody"}</ReadOnlyField>
                <ReadOnlyField label="Job role">{jobRole ? `${jobRole.name}${jobRole.is_active ? "" : " (retired)"}` : "Not set"}</ReadOnlyField>
                <DivisionFields companyId={companyId} person={person} me={me} canEdit={false} onPatch={patch} />
                <ReadOnlyField label="Phone">{person.phone || "Not set"}</ReadOnlyField>
                <ReadOnlyField label="Role">{rococo ? "Rococo Creative" : ROLE_LABELS[person.role]}</ReadOnlyField>
                <p className={helpClass}>An owner or admin changes these.</p>
              </div>
            )}
          </Section>
          <div className="grid gap-4">
            {isAdmin ? <Stat label="Annual compensation" value={formatMoney(totalAnnual(compensation))} hint={compensation.length > 0 ? `${formatMoney(totalAnnual(compensation) / 12)} a month` : "Not recorded"} /> : null}
            <Stat label="Latest score" value={<span className={bandClass(latestScored?.result?.overall ?? null)}>{latestScored?.result?.overall ?? "-"}</span>} hint={latestScored?.cycle?.name ?? "Not scored yet"} />
            <Stat label="Average" value={average ?? "-"} hint={pluralize(rows.length, "review")} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {isLeader && !rococo ? <ThisMonthGsr companyId={companyId} person={person} cycles={cycles} reviews={reviews} omittedCycleIds={omittedCycleIds} /> : null}
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
          {hasModule(company, "tasks") && !rococo ? <PersonTasks companyId={companyId} person={person} canAdd={isLeader} viewerProfileId={me.id} goalLabel={goalLabel} /> : null}
          <Section eyebrow={String(year)} title="Personal KPIs" description="The numbers this person owns for the year. They show at the top of every review.">
            <KpiList companyId={companyId} employeeId={person.id} year={year} kpis={kpis} canEdit={isAdmin} onChange={(update) => state.setData((prev) => (prev ? { ...prev, kpis: update(prev.kpis) } : prev))} onError={setError} />
          </Section>
          {isAdmin ? (
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
          ) : null}
          <Section
            eyebrow={String(year)}
            title="Deliverables"
            description="What this person owns, grouped the way the company thinks about it. Each heading is scored by the tasks under it: two points a task, so a Hit on every one lands on target."
          >
            <DeliverablesPanel companyId={companyId} employeeId={person.id} year={year} canEdit={isAdmin} isOwn={self} />
          </Section>
          {ratingPillars.length > 0 ? (
            <Section
              eyebrow="Impact score"
              title={profileScore.overall > 0 || impact.length > 0 ? String(profileScore.overall) : "Not rated yet"}
              description={
                baseline
                  ? `${isAdmin ? "Set here" : "Set by an admin"} and trued up before each review; frozen into the review at sign-off. Compared with ${baseline.cycle?.name ?? "the last review"}.`
                  : `${isAdmin ? "Set here" : "Set by an admin"} and trued up before each review; frozen into the review at sign-off.`
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
                                  <RatingInput
                                    label={`${criterion.name} rating`}
                                    value={current}
                                    max={pillar.rating_scale_max}
                                    onChange={isAdmin ? (next) => (next === null ? undefined : void writeImpact(criterion.id, { rating: next })) : undefined}
                                  />
                                </div>
                              </div>
                              {current !== null && isAdmin ? (
                                <BlurInput
                                  value={impactByCriterion.get(criterion.id)?.note ?? ""}
                                  placeholder="Why this rating"
                                  ariaLabel={`Note on ${criterion.name}`}
                                  onSave={(next) => writeImpact(criterion.id, { note: next.trim() || null })}
                                  className={`${inputClass} mt-2 text-[12.5px]`}
                                />
                              ) : current !== null && impactByCriterion.get(criterion.id)?.note ? (
                                <p className="mt-2 text-[12.5px] text-ink-2">{impactByCriterion.get(criterion.id)?.note}</p>
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
          {isAdmin ? (
            <Section eyebrow="Compensation" title="Compensation" description="Annual amounts; the monthly figure is derived. Company admins only." padded={false}>
              <CompensationTable companyId={companyId} employeeId={person.id} items={compensation} canEdit onChange={(update) => state.setData((prev) => (prev ? { ...prev, compensation: update(prev.compensation) } : prev))} onError={setError} />
            </Section>
          ) : null}
          <Section
            eyebrow="Reviews"
            title="Review history"
            padded={false}
            actions={isAdmin ? <Link to="/reviews" className="text-[13px] text-accent hover:underline">Review cycles</Link> : undefined}
          >
            {rows.length === 0 ? (
              isAdmin ? (
                <p className="p-5 text-sm text-ink-2">
                  No reviews yet. An admin opens a cycle in <Link to="/reviews" className="text-accent hover:underline">Reviews</Link> or <Link to="/gsr" className="text-accent hover:underline">Monthly GSRs</Link>, and everyone on the roster gets one.
                </p>
              ) : (
                <p className="p-5 text-sm text-ink-2">No reviews yet. They show here once an admin opens a cycle.</p>
              )
            ) : (
              <div className="relative overflow-x-auto">
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
