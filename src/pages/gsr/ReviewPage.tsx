// One person's review for one cycle, in one of two shapes.
//
// A monthly cycle is a Goal Setting Review and only that: goals set live with an agreed
// completion, action steps and a dated notes log, the month's focus topic at the top, and last
// month read back as hit or miss. No pillar scoring and no written feedback, because the meeting
// is the goals and the notes on them.
//
// Quarterly, annual and custom cycles are the scoring review: ratings per criterion for rating
// pillars, target-vs-actual line items for deliverable pillars, the overall score, and the
// management, peer and client feedback with the employee's reflection.
//
// Both shapes open with the same question, "What would help you do your job better?", written by
// the person and their admins while the review is open, and both carry a note per assigned project.
// A monthly GSR also reads the person's role scorecard for its month ("Performance this month"),
// entered here by an admin.
//
// A manager opens the monthly GSR of someone they lead and works its goals and notes the way an
// admin does while the month is open (0038). Everything else here stays with an admin: locking a
// month, ratings, line items, feedback, sign-off and reopening. Nothing this page loads is
// admin-only, so a manager's reads come back narrowed by RLS rather than refused. Names of people
// who are not the subject (who signed off, who wrote a note, who the person reports to) come from
// the company directory, which every member reads.
//
// Employees open the same page for their own review (RLS makes sure it is theirs). A monthly
// GSR is theirs to work in full so they can prefill it before the meeting, except what is
// reserved for an admin: a goal someone else set for them keeps what it is, results are entered
// by an admin, and so are the project notes. A scored review is read-only apart from their
// reflection and the opening discussion. Every change saves on its own, so there is no save
// button to forget.
//
// In a company whose GSRs are on demand (companies.gsr_mode, 0047) there are no GSR months: a
// scored review's Monthly GSRs pillar reads the person's GSRs done inside the cycle's period
// (scoreGsrsInPeriod, lib/gsr/onDemand.ts) and lists them, each linking to its own page. Sign-off
// writes the same one line item. A company on periods reads its months exactly as before.
import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Plus, RotateCcw } from "lucide-react";
import EmployeeSnapshot from "../../components/gsr/EmployeeSnapshot.tsx";
import GoalSettingPanel from "../../components/gsr/GoalSettingPanel.tsx";
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import ReviewPerformance from "../../components/gsr/ReviewPerformance.tsx";
import ReviewProjects from "../../components/gsr/ReviewProjects.tsx";
import SupportDiscussionCard from "../../components/gsr/SupportDiscussionCard.tsx";
import DeliverablesPanel from "../../components/people/DeliverablesPanel.tsx";
import type { DeliverableScore } from "../../lib/gsr/deliverables.ts";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import RatingInput from "../../components/ui/RatingInput.tsx";
import ScoreBar from "../../components/ui/ScoreBar.tsx";
import ScoreRing from "../../components/ui/ScoreRing.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import { inputClass, labelClass, selectClass } from "../../components/ui/forms.ts";
import { eyebrowLabelClass } from "../../components/ui/type.ts";
import { tapTargetClass } from "../../components/ui/tap.ts";
import { PREVIOUS_STATUS_TONE, REVIEW_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { hasModule } from "../../lib/modules.ts";
import { ledBy } from "../../lib/people.ts";
import { useAsync } from "../../hooks/useAsync.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { createScore, deleteScore, getCycle, getReview, listCompanyGoals, listCriteria, listCycleOmissions, listCycles, listEmployeeReviews, listGoalNotes, listGoals, listImpactScores, listPillars, listReviewScores, type ReviewPatch, updateReview, updateScore } from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listDirectory } from "../../services/directory.ts";
import { listTasksForGoals } from "../../services/tasks.ts";
import { listEmployeeKpis } from "../../services/employees.ts";
import { listJobRoleGoals, listJobRoles } from "../../services/jobRoles.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { listProjectAssignments } from "../../services/projectAssignments.ts";
import { listProjects } from "../../services/projects.ts";
import { listReviewProjectNotes } from "../../services/reviewProjectNotes.ts";
import { listPersonGsrs } from "../../services/gsrOnDemand.ts";
import { monthOf } from "../../lib/scorecard.ts";
import { computeReviewScore, countCriteria, hasScoredItem, lineItemPercent, pillarsForReview, scoreInputsForReview, signedOffBarDetail, weightTotal, type ScoreInput } from "../../lib/gsr/scoring.ts";
import { SECTION_MY, cyclePath, cycleSettled, cycleYear, monthsWithin, omittedCycleIdsFor, previousCycle, reviewPath, sectionOf } from "../../lib/gsr/cycles.ts";
import { goalOutcome, hitCount, lockedMonthsIn, monthLocked, monthTotal, scoreGsrMonths, scoreMonth, type GsrMonthsFigure } from "../../lib/gsr/goals.ts";
import { gsrsCountedIn, scoreGsrsInPeriod } from "../../lib/gsr/onDemand.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDate, formatDateTime, formatNumber, formatPeriod, moneyFieldError, parseMoney, pluralize } from "../../lib/format.ts";
import {
  PREVIOUS_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  keysOf,
  type Gsr,
  type GsrCriterion,
  type GsrPillar,
  type PreviousStatus,
  type Profile,
  type ReviewCycle,
  type ReviewScore,
  type TaskWithSteps,
} from "../../types/database.ts";

// Who signed off a review when the company directory does not list them. Rococo only when the page
// knows it: the viewer is that Rococo admin, or the reviewer is on the list the viewer reads and is
// Rococo staff. Otherwise the neutral line, since an admin who has since left the company reads the
// same way and must not be credited to Rococo.
function reviewerFallback(reviewerId: string, viewer: Pick<Profile, "id" | "is_rococo_admin">, people: ReadonlyArray<Pick<Profile, "id" | "is_rococo_admin">>): string {
  const known = reviewerId === viewer.id ? viewer : people.find((p) => p.id === reviewerId);
  return known?.is_rococo_admin ? "Rococo" : "someone no longer listed";
}

// Table headers must stay table-cells: the shared label class sets display:block.
const miniThClass = `pb-2 ${eyebrowLabelClass}`;
// Below sm the line items stack: the deliverable and its notes take the full width, and target,
// actual, achieved and remove sit in a row under it, each figure with its column's name above it,
// so the deliverable's name is never squeezed to a few letters on a phone.
const stackedCell = "max-sm:p-0 max-sm:before:mb-1 max-sm:before:block max-sm:before:content-[attr(data-label)] max-sm:before:text-[12px] max-sm:before:leading-normal max-sm:before:text-ink-3";

// A Monthly GSRs pillar on a scored review: each Goal Setting Review inside the period, counted at
// the score an admin locked it in at, and not before; after sign-off, the figure the review was
// signed off with. The month figures come from lib/gsr/goals.ts and the pillar's score from
// scoring.ts, like every pillar.
function GsrPillarBody({
  figure,
  signedOff,
}: {
  figure: GsrMonthsFigure<ReviewCycle> | null;
  // Once the review is complete, the line item written at sign-off (null if none was); undefined
  // while it is open, when the months read live.
  signedOff: ReviewScore | null | undefined;
}) {
  if (signedOff !== undefined) {
    if (!signedOff?.target) return <p className="text-sm text-ink-2">No month inside this period was locked in when it was signed off, so this pillar was left out and the other pillars carried its weight.</p>;
    const months = lockedMonthsIn(signedOff.target);
    return <p className="text-sm text-ink-2">{lineItemPercent({ target: signedOff.target, actual: signedOff.actual ?? 0 })}% across {pluralize(months, "locked-in month")} of GSRs, as signed off.</p>;
  }
  if (!figure || figure.months.length === 0) {
    return <p className="text-sm text-ink-2">No Goal Setting Review has run inside this period, so this pillar is left out and the other pillars carry its weight.</p>;
  }
  const lockedCount = figure.months.filter((m) => m.locked !== null).length;
  return (
    <div>
      <ul className="divide-y divide-line">
        {figure.months.map(({ cycle, locked, live, omitted }) => (
          <li key={cycle.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm text-ink">{cycle.name}</p>
              <p className="tnum text-[12px] text-ink-3">
                {omitted ? "Omitted from this month; it does not count" : locked !== null ? "Locked in" : `Not locked in yet, ${live}% so far; it counts once its GSR is marked complete`}
              </p>
            </div>
            <span className={`tnum text-sm ${locked !== null ? "text-ink" : "text-ink-3"}`}>{locked !== null ? `${locked}%` : "-"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {lockedCount === 0
          ? "No month in this period is locked in yet. A month counts once an admin marks its GSR complete. If none is locked when this review is signed off, this pillar is left out and the other pillars carry its weight."
          : `${lineItemPercent(figure)}% across ${pluralize(lockedCount, "locked-in month")}. Each locked month counts equally; a month that is not locked in yet is not applied. Frozen into this review when it is marked complete.`}
      </p>
    </div>
  );
}

type GsrPeriodFigure = ReturnType<typeof scoreGsrsInPeriod<Gsr>>;

// The GSRs a scored review reads in a company on demand: each one done inside the period, with the
// day it was done and its score, then each one open now, which is not counted yet. Each opens its
// own page. The figures come from scoreGsrsInPeriod (lib/gsr/onDemand.ts).
function GsrsInPeriodList({ figure }: { figure: GsrPeriodFigure }) {
  return (
    <ul className="divide-y divide-line">
      {figure.gsrs.map(({ gsr, counted }) => (
        <li key={gsr.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
          <div className="min-w-0">
            <Link to={`/gsr/reviews/${gsr.id}`} className={`text-sm text-link hover:underline ${tapTargetClass}`}>GSR · {formatDate(gsr.started_on)}</Link>
            <p className="tnum text-[12px] text-ink-3">
              {gsr.done_on === null ? "Not counted yet" : counted ? `Done ${formatDate(gsr.done_on)}` : `Done ${formatDate(gsr.done_on)}, with no score`}
            </p>
          </div>
          {counted ? <span className="tnum text-sm text-ink">{gsr.gsr_score}%</span> : null}
        </li>
      ))}
    </ul>
  );
}

// A Monthly GSRs pillar on a scored review in a company on demand: the GSRs done inside the period,
// each counted at the score it was marked done with, and those still open, which are not; after
// sign-off, the figure the review was signed off with.
function OnDemandGsrPillarBody({ figure, signedOff }: { figure: GsrPeriodFigure | null; signedOff: ReviewScore | null | undefined }) {
  if (signedOff !== undefined) {
    if (!signedOff?.target) return <p className="text-sm text-ink-2">No GSR inside this period was done when it was signed off, so this pillar was left out and the other pillars carried its weight.</p>;
    return <p className="text-sm text-ink-2">{lineItemPercent({ target: signedOff.target, actual: signedOff.actual ?? 0 })}% across {pluralize(gsrsCountedIn(signedOff.target), "GSR")}, as signed off.</p>;
  }
  if (!figure || figure.gsrs.length === 0) {
    return <p className="text-sm text-ink-2">No GSR was done inside this period, so this pillar is left out and the other pillars carry its weight.</p>;
  }
  const counted = figure.gsrs.filter((g) => g.counted).length;
  return (
    <div>
      <GsrsInPeriodList figure={figure} />
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {counted === 0
          ? "No GSR in this period is done with a score yet. A GSR counts once it is marked done. If none counts when this review is signed off, this pillar is left out and the other pillars carry its weight."
          : `${lineItemPercent(figure)}% across ${pluralize(counted, "GSR")} done in this period. Each counts equally; one still open is not counted. Frozen into this review when it is marked complete.`}
      </p>
    </div>
  );
}

// Mounted by the router with the id in the URL, and by My GSR with the id as a prop so the
// employee's own month renders under their own sidebar entry and tabs. Embedded, it has no back
// link: the tabs above are the way around.
export default function ReviewPage({ reviewId: reviewIdProp, embedded = false }: { reviewId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const reviewId = reviewIdProp ?? params.reviewId ?? "";
  const { company, profile, isAdmin } = useHub();
  const tasksOn = hasModule(company, "tasks");
  const companyId = company!.id;
  // GSRs that stand on their own (0047): only behind the company's own setting.
  const onDemand = company!.gsr_mode === "on_demand";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A deliverable line carries its target, actual and notes, and removing it changes the
  // pillar's score, so it is confirmed rather than deleted on a single icon click.
  const [removing, setRemoving] = useState<ReviewScore | null>(null);
  const [removeError, setRemoveError] = useState("");
  // The deliverables module's figure for the year, reported by the panel below once loaded, with
  // the person and year it was read for. Moving to another review in place keeps this state, so
  // a bare figure would score the next review, and freeze into it at sign-off, with the previous
  // person's deliverables until the panel reported again. Stamped, it only counts for its own.
  const [rollupFor, setRollupFor] = useState<{ employeeId: string; year: number; score: DeliverableScore | null } | null>(null);
  // Locking a month's GSR in is confirmed first, with the score it will lock in at.
  const [locking, setLocking] = useState(false);
  // The sign-off dialogs' own failure line (locking a month in, or signing off without Monthly
  // GSRs), so a goal save that failed earlier on the page never shows inside one, and cancelling
  // one never clears the page's notice.
  const [lockError, setLockError] = useState("");
  // Signing off a scored review whose Monthly GSRs pillar has no locked month asks first.
  const [confirmLeftOut, setConfirmLeftOut] = useState(false);
  // The score the lock dialog shows and writes, worked out from the month's goals as they were
  // read again when the dialog opened, so a slider the person moved in their own session since this
  // page loaded counts.
  const [lockScore, setLockScore] = useState<{ total: number; cap: number; score: number } | null>(null);

  // A criterion can have two saves in flight at once: blurring a note commits it as the rating
  // beside it is clicked. Both would read the same render-time scores array, both would see
  // nothing stored yet, and both would insert. The partial unique index rejects the second and
  // the rating is silently lost. So saves for one criterion queue behind each other, and this
  // map carries the row id the previous save created to the next one. Keyed by review as well
  // as criterion, so nothing survives a move to another review.
  const savedScoreIds = useRef(new Map<string, string>());
  const saveChains = useRef(new Map<string, Promise<unknown>>());

  const state = useAsync(async () => {
    const review = await getReview(reviewId);
    assertInCompany(review, companyId, "review");
    const [cycle, cycles, pillars, criteria, scores, people, goals, directory] = await Promise.all([
      getCycle(review.cycle_id),
      listCycles(review.company_id),
      listPillars(review.company_id),
      // Retired criteria too: a signed-off review lists the criteria it was rated on, and a
      // criterion retired since then is still one of them.
      listCriteria(review.company_id, true),
      listReviewScores(review.id),
      // The people the viewer may see (RLS), for the person, whether the viewer leads them, and the
      // task form's picker. Names of anyone else come from the directory.
      listCompanyProfiles(review.company_id),
      listGoals(review.company_id, review.employee_id),
      listDirectory(review.company_id),
    ]);
    const year = cycleYear(cycle);
    const person = people.find((p) => p.id === review.employee_id) ?? null;
    const roleId = cycle.cadence === "monthly" ? (person?.job_role_id ?? null) : null;
    // A monthly GSR reads the role scorecard for its month; the results are read for that month's year.
    const reviewMonth = cycle.cadence === "monthly" ? monthOf(cycle.period_start) : null;
    // The tasks on this month's and last month's goals, open and done, where the company runs tasks.
    const shownMonths = cycle.cadence === "monthly" ? [cycle.id, previousCycle(cycles, cycle)?.id].filter((id): id is string => Boolean(id)) : [];
    const shownGoalIds = goals.filter((g) => g.scope === "cycle" && g.cycle_id !== null && shownMonths.includes(g.cycle_id)).map((g) => g.id);
    const [kpis, companyGoals, impact, personReviews, roleGoals, notes, omissions, assignments, projects, projectNotes, metrics, entries, goalTasks, personGsrs] = await Promise.all([
      listEmployeeKpis(review.company_id, review.employee_id, year),
      listCompanyGoals(review.company_id, year),
      listImpactScores(review.company_id, review.employee_id),
      // The person's other reviews, so each month inside this period can link to its GSR.
      listEmployeeReviews(review.company_id, review.employee_id),
      // The goals their job role brings into a Goal Setting Review; nothing for a scored cycle.
      // A retired role stays on their record but brings nothing new into a month, so its goals
      // are offered only while the role is active (listJobRoles returns active roles).
      roleId
        ? Promise.all([listJobRoles(review.company_id), listJobRoleGoals(review.company_id, roleId)]).then(([roles, templates]) =>
            roles.some((r) => r.id === roleId) ? templates : [],
          )
        : Promise.resolve([]),
      // The month's notes logs. The database hands an admin only the notes on monthly goals; the
      // person gets all of theirs, and the panel shows each goal its own.
      cycle.cadence === "monthly" ? listGoalNotes(review.company_id, review.employee_id) : Promise.resolve([]),
      // Which cycles the person is omitted from (0034): this one, and the months inside it.
      listCycleOmissions(review.company_id),
      // The projects the person works on, named from the company's projects (archived ones too, so
      // an older review still names them), and this review's note on each.
      listProjectAssignments(review.company_id, { employeeId: review.employee_id }),
      listProjects(review.company_id, { includeArchived: true }),
      listReviewProjectNotes(review.id),
      // The company's role metrics, retired ones too, and the person's results for the month's year.
      reviewMonth ? listRoleMetrics(review.company_id, true) : Promise.resolve([]),
      reviewMonth ? listMetricEntries(review.company_id, { employeeId: review.employee_id, year: Number(reviewMonth.slice(0, 4)) }) : Promise.resolve([]),
      tasksOn && cycle.cadence === "monthly" ? listTasksForGoals(review.company_id, shownGoalIds) : Promise.resolve<TaskWithSteps[] | null>(null),
      // In a company on demand, the person's GSRs, for a scored review to read those done in its period.
      onDemand && cycle.cadence !== "monthly" ? listPersonGsrs(review.company_id, review.employee_id) : Promise.resolve<Gsr[]>([]),
    ]);
    return { review, cycle, cycles, pillars, criteria, scores, people, goals, directory, kpis, companyGoals, impact, personReviews, roleGoals, notes, omissions, assignments, projects, projectNotes, metrics, entries, goalTasks, personGsrs, reviewMonth, year };
  }, [reviewId, companyId, tasksOn, onDemand]);

  // The panel is handed the person and year of the review on screen, so every figure it reports
  // is stamped with the same two. Stable between renders, because the panel reports again
  // whenever the callback changes.
  const rollupEmployee = state.data?.review.employee_id ?? null;
  const rollupYear = state.data?.year ?? null;
  const reportRollup = useCallback(
    (score: DeliverableScore | null) => {
      if (rollupEmployee !== null && rollupYear !== null) setRollupFor({ employeeId: rollupEmployee, year: rollupYear, score });
    },
    [rollupEmployee, rollupYear],
  );

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { review, cycle, cycles, pillars, criteria, scores, people, goals, directory, kpis, companyGoals, impact, personReviews, roleGoals, notes, omissions, assignments, projects, projectNotes, metrics, entries, goalTasks, personGsrs, reviewMonth, year } = state.data;
  const employee = people.find((p) => p.id === review.employee_id) ?? null;
  // Full names by profile id, from the directory, for everyone the page names who is not its subject.
  const names = new Map(directory.map((entry) => [entry.id, entry.full_name?.trim() || "Unnamed"] as const));
  // Written on Mark complete; this is where it is read back, so a signed-off review says who
  // signed it off. The directory lists everyone placed with the company. A reviewer it does not
  // know is Rococo only when the page can tell (the viewer is that Rococo admin, or the person is on
  // the list the viewer reads); anyone else, such as an admin since moved to another company, reads
  // neutrally rather than being credited to the wrong party.
  const reviewerName = review.reviewer_id ? (names.get(review.reviewer_id) ?? reviewerFallback(review.reviewer_id, profile, people)) : null;
  const isOwn = review.employee_id === profile.id;
  // The viewer leads the person: their manager, or anyone up the chain above them (lib/people.ts,
  // the same rule as private.led_person_ids). An admin's powers already cover everything a leader
  // does, so this matters for managers.
  const isLeader = !isOwn && !isAdmin && ledBy(profile, people).some((p) => p.id === review.employee_id);
  const frozen = review.status === "complete";
  // Omitted from this cycle (0034): the review is set aside as it is, and nothing scores or signs
  // it off until the person is added back on the cycle page. Read the way the cycle's roster reads
  // it (cycleRoster), so an omission never reaches a review that is already signed off.
  const omittedIds = omittedCycleIdsFor(omissions, [review, ...personReviews], review.employee_id);
  const omittedHere = omittedIds.includes(review.cycle_id);
  // An admin works an open review in an open cycle. A signed-off review is the record: its line
  // items, criterion notes, feedback and the period's goals stay as they were signed off until
  // it is reopened, so its score of record never moves without a new sign-off. The deliverables
  // module is the person's standing record, not the review's, so it keeps the cycle's rule.
  const canEditModule = isAdmin && cycle.status === "open";
  const canScore = canEditModule && !frozen && !omittedHere;
  // The opening discussion is the person's to write as much as the admin's, while the review is
  // open; the database freezes it with the rest at sign-off (0029, 0035).
  const canDiscuss = (isAdmin || isOwn) && cycle.status === "open" && !frozen && !omittedHere;
  // Monthly cycles are Goal Setting Reviews: goals lead, scores follow.
  const monthly = cycle.cadence === "monthly";
  const lastMonth = monthly ? previousCycle(cycles, cycle) : null;
  // A scored review reads back the Goal Setting Reviews that ran inside its period: each
  // month's goals, hit or miss, and a link to the month. The reviewer's own previous-period
  // judgment stays where it is; this is the record beside it.
  // A Monthly GSRs pillar is scored from those same months, each at the score an admin locked it
  // in at; sign-off writes the period's figure as one line item (lib/gsr/goals.ts).
  const gsrPillars = pillars.filter((p) => p.scoring_type === "gsr_goals" && p.is_active);
  const gsrFigures = new Map(monthly || onDemand ? [] : gsrPillars.map((p) => [p.id, scoreGsrMonths(cycle, cycles, goals, personReviews, p.required_goals, omittedIds)] as const));
  // In a company on demand there are no months: the GSRs done inside this period, each at the score
  // it was marked done with (lib/gsr/onDemand.ts). One figure, whatever the pillar.
  const gsrPeriod = onDemand && !monthly ? scoreGsrsInPeriod(cycle, personGsrs) : null;
  const gsrLine = (pillarId: string): { target: number; actual: number } | undefined => gsrPeriod ?? gsrFigures.get(pillarId);
  // With no month locked in, sign-off leaves Monthly GSRs out of this review (scoring.ts), and
  // the admin is told before it happens.
  const gsrLeftOut = !monthly && gsrPillars.length > 0 && gsrPillars.every((p) => (gsrLine(p.id)?.target ?? 0) === 0);
  const months = monthly || onDemand
    ? []
    : monthsWithin(cycle, cycles).map((month) => {
        const own = goals.filter((g) => g.scope === "cycle" && g.cycle_id === month.id);
        const gsr = personReviews.find((r) => r.cycle_id === month.id) ?? null;
        const score = omittedIds.includes(month.id)
          ? "Omitted from this month"
          : gsrPillars[0]
            ? monthLocked(gsr)
              ? `GSR ${gsr?.gsr_score}%`
              : `GSR ${scoreMonth(own, gsrPillars[0].required_goals)}% so far, not locked in`
            : null;
        return { month, gsr, score, tally: hitCount(own, cycleSettled(month)), open: own.filter((g) => goalOutcome(g, cycleSettled(month)) === "open").length };
      });
  // Marking a month's GSR complete locks its score in, where the company scores its GSRs (0023).
  const monthGoals = monthly ? goals.filter((g) => g.scope === "cycle" && g.cycle_id === cycle.id) : [];
  const monthScore = monthly && gsrPillars[0] ? { ...monthTotal(monthGoals, gsrPillars[0].required_goals), score: scoreMonth(monthGoals, gsrPillars[0].required_goals) } : null;
  const impactByCriterion = new Map(impact.map((i) => [i.criterion_id, i]));
  // The module's figure for this review's person and year, or nothing while theirs has not come in.
  const rollup = rollupFor && rollupFor.employeeId === review.employee_id && rollupFor.year === year ? rollupFor.score : null;
  // What scores this review right now. Frozen rows once it is complete; before that the
  // person's current impact ratings for the rating pillars, the typed line items for a
  // 'deliverables' pillar, the module's live rollup for a 'deliverables_module' pillar, and the
  // months' live figure for a 'gsr_goals' pillar. The rollup arrives from the panel above once it
  // has loaded. A completed review is scored with the pillars it was signed off with.
  const modulePillars = pillars.filter((p) => p.scoring_type === "deliverables_module" && p.is_active);
  const signedOffLater = (pillarId: string) => modulePillars.some((p) => p.id === pillarId) || gsrPillars.some((p) => p.id === pillarId);
  const liveScores: ScoreInput[] = frozen
    ? scores
    : [
        ...scores.filter((s) => !signedOffLater(s.pillar_id)),
        ...(rollup && rollup.target > 0 ? modulePillars.map((p) => ({ pillar_id: p.id, criterion_id: null, target: rollup.target, actual: rollup.actual })) : []),
        ...gsrPillars.flatMap((p) => {
          const figure = gsrLine(p.id);
          return figure && figure.target > 0 ? [{ pillar_id: p.id, criterion_id: null, target: figure.target, actual: figure.actual }] : [];
        }),
      ];
  const inputs = scoreInputsForReview(review, liveScores, impact, criteria);
  const result = computeReviewScore(pillarsForReview(review, pillars), inputs, countCriteria(criteria));
  // The sections a completed review shows are the pillars it was signed off with, described the
  // way the live pillar is where it still exists; an open review shows today's.
  const shownPillars: GsrPillar[] =
    frozen && review.pillar_snapshot
      ? review.pillar_snapshot.map((snap, i) => ({
          description: null,
          company_id: review.company_id,
          sort_order: i,
          is_active: true,
          created_at: review.completed_at ?? review.updated_at,
          updated_at: review.completed_at ?? review.updated_at,
          ...pillars.find((p) => p.id === snap.id),
          ...snap,
        }))
      : pillars;
  // Sign-off writes the module's figure as a line item, so it needs the figure in hand. Only a
  // scored cycle does: a monthly GSR never renders the deliverables panel that reports the
  // figure, and it locks a month's score in, not a module line item. Waiting on it there kept
  // Mark complete disabled for good wherever a company scores deliverables from the module.
  const awaitingRollup = !monthly && !frozen && modulePillars.length > 0 && rollup === null;

  const onProjectNotes = (update: (list: typeof projectNotes) => typeof projectNotes) =>
    state.setData((prev) => (prev ? { ...prev, projectNotes: update(prev.projectNotes) } : prev));

  // A row that came back from a write we started: it replaces what is in state, and it is
  // dropped if the row is no longer there. Removing a line item blurs the Notes box beside the
  // trash icon, so a patch for that row is often still in flight when the delete lands; adding
  // an unknown id back here put the deleted line item on screen again, target, actual and all,
  // where it stayed until the next load because nothing reloads after a delete.
  function updateScoreInState(next: ReviewScore) {
    state.setData((prev) =>
      prev ? { ...prev, scores: prev.scores.map((s) => (s.id === next.id ? next : s)) } : prev,
    );
  }

  // A row this page has just created. Only adding ever inserts.
  function addScoreToState(next: ReviewScore) {
    state.setData((prev) =>
      prev
        ? { ...prev, scores: prev.scores.some((s) => s.id === next.id) ? prev.scores.map((s) => (s.id === next.id ? next : s)) : [...prev.scores, next] }
        : prev,
    );
  }

  // Only an admin may move a review's status: guard_review_employee_fields rejects the write
  // from anyone else. An employee ticking a step on their own goal would otherwise get a
  // permission error for a save that actually succeeded. Callers run it only after their own
  // write landed, so a failed save never moves the review on.
  async function markInProgress() {
    if (!isAdmin || review.status !== "not_started") return;
    const next = await updateReview(review.id, { status: "in_progress" });
    state.setData((prev) => (prev ? { ...prev, review: next } : prev));
  }

  async function saveRating(pillar: GsrPillar, criterion: GsrCriterion, patch: { rating?: number | null; notes?: string | null }): Promise<boolean> {
    setError("");
    const key = `${review.id}:${criterion.id}`;
    const run = (saveChains.current.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const existingId = savedScoreIds.current.get(key) ?? scores.find((s) => s.criterion_id === criterion.id)?.id;
      const saved = existingId
        ? await updateScore(existingId, patch)
        : await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillar.id, criterion_id: criterion.id, ...patch });
      savedScoreIds.current.set(key, saved.id);
      // First write for this criterion creates the row, later writes update it.
      if (existingId) updateScoreInState(saved);
      else addScoreToState(saved);
      await markInProgress();
    });
    saveChains.current.set(key, run);
    try {
      await run;
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function addLineItem(pillar: GsrPillar) {
    setError("");
    try {
      const items = scores.filter((s) => s.pillar_id === pillar.id && !s.criterion_id);
      const saved = await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillar.id, label: "", sort_order: items.length });
      addScoreToState(saved);
      await markInProgress();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveLineItem(score: ReviewScore, patch: { label?: string; target?: number | null; actual?: number | null; notes?: string | null }): Promise<boolean> {
    setError("");
    // Label, target, actual and notes sit in one row, so tabbing across them puts several
    // whole-row writes in flight at once. Queued per row, the same way saveRating is, because
    // each response carries that write's whole row and out of order they undo each other on
    // screen while the database is correct.
    const run = (saveChains.current.get(score.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      updateScoreInState(await updateScore(score.id, patch));
    });
    saveChains.current.set(score.id, run);
    try {
      await run;
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  // A line item's target or actual. Text that is not a figure is refused with a line saying what to
  // type, rather than saved as a blank that moves the score; blank clears it on purpose.
  function saveLineFigure(score: ReviewScore, field: "target" | "actual", text: string): Promise<boolean> | false {
    const problem = moneyFieldError(field === "target" ? "the target" : "the actual", text, "100");
    if (problem) {
      setError(problem);
      return false;
    }
    return saveLineItem(score, field === "target" ? { target: parseMoney(text) } : { actual: parseMoney(text) });
  }

  async function removeLineItem() {
    if (!removing) return;
    setBusy(true);
    setRemoveError("");
    try {
      const id = removing.id;
      await deleteScore(id);
      state.setData((prev) => (prev ? { ...prev, scores: prev.scores.filter((s) => s.id !== id) } : prev));
      setRemoving(null);
    } catch (err) {
      setRemoveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Resolves whether the write landed, for the fields that say "Not saved".
  async function patchReview(patch: ReviewPatch): Promise<boolean> {
    setError("");
    setBusy(true);
    try {
      const next = await updateReview(review.id, patch);
      state.setData((prev) => (prev ? { ...prev, review: next } : prev));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The discussion moves a not-started review on only once it saved.
  async function saveDiscussion(next: string | null): Promise<boolean> {
    const saved = await patchReview({ support_discussion: next });
    if (saved) await markInProgress().catch((err: unknown) => setError(errorMessage(err)));
    return saved;
  }

  // Something on the month saved: an older failure line no longer applies, and the review moves on.
  function touched() {
    setError("");
    void markInProgress().catch((err: unknown) => setError(errorMessage(err)));
  }

  const feedbackPatch = (key: "manager_feedback" | "peer_feedback" | "client_feedback", value: string): ReviewPatch => {
    const patch: ReviewPatch = {};
    patch[key] = value.trim() || null;
    return patch;
  };

  // One signed-off figure as a pillar's single line item. A figure with nothing behind it (no
  // tasks, no locked month) removes the line item a previous sign-off left, so re-signing a
  // reopened review never keeps a figure the period no longer has. It works on the review's line
  // items as the database holds them (current), not as this page last rendered them, and every row
  // it writes goes into state as it lands: a sign-off that failed after creating the row, retried,
  // updates that row instead of adding a second one.
  async function writeSignedOffLine(current: ReviewScore[], pillarId: string, line: { label: string; target: number; actual: number } | null) {
    const existing = current.filter((s) => s.pillar_id === pillarId && !s.criterion_id);
    const drop = async (stale: ReviewScore) => {
      await deleteScore(stale.id);
      state.setData((prev) => (prev ? { ...prev, scores: prev.scores.filter((s) => s.id !== stale.id) } : prev));
    };
    if (!line) {
      for (const stale of existing) await drop(stale);
      return;
    }
    const [first, ...extra] = existing;
    if (first) addScoreToState(await updateScore(first.id, line));
    else addScoreToState(await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillarId, ...line }));
    for (const stale of extra) await drop(stale);
  }

  // Locking a month in asks first, with the score it will lock in at. The month's goals are read
  // again before that score is worked out, so the dialog shows, and Mark complete writes, the
  // score of the goals on record now.
  async function startLock() {
    if (!gsrPillars[0]) return;
    // The page's own failure line stays: it is about an earlier save, not about the lock.
    setBusy(true);
    setLockError("");
    try {
      const fresh = await listGoals(review.company_id, review.employee_id);
      state.setData((prev) => (prev ? { ...prev, goals: fresh } : prev));
      const month = fresh.filter((g) => g.scope === "cycle" && g.cycle_id === cycle.id);
      const required = gsrPillars[0].required_goals;
      setLockScore({ ...monthTotal(month, required), score: scoreMonth(month, required) });
      setLocking(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Sign-off. The module's figure is written as this review's line item first, one row per
  // module pillar, so the status flip that follows has everything it freezes. The database then
  // copies the person's current ratings into the review (0017); the reload reads them back.
  // A monthly GSR writes neither figure: it locks the month's score in and nothing else.
  async function markComplete() {
    setBusy(true);
    const inDialog = locking || confirmLeftOut;
    if (inDialog) setLockError("");
    else setError("");
    try {
      if (!monthly) {
        // The line items as the database holds them now, not as this page last rendered them.
        const current = await listReviewScores(review.id);
        for (const pillar of modulePillars) {
          await writeSignedOffLine(
            current,
            pillar.id,
            rollup && rollup.target > 0 ? { label: `Deliverables ${year}`, target: rollup.target, actual: rollup.actual } : null,
          );
        }
        // The months' figure, the same way: one line item, so a slider moved after sign-off moves
        // nothing on the review.
        for (const pillar of gsrPillars) {
          const figure = gsrLine(pillar.id);
          await writeSignedOffLine(
            current,
            pillar.id,
            figure && figure.target > 0 ? { label: `${onDemand ? "GSRs" : "Monthly GSRs"}, ${cycle.name}`, target: figure.target, actual: figure.actual } : null,
          );
        }
      }
      // A month's GSR is locked in with the score the dialog showed, worked out from the month's
      // goals as they were read when it opened.
      const gsrScore = monthly && gsrPillars[0] ? (lockScore ?? monthScore)?.score : undefined;
      await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: profile.id, ...(gsrScore !== undefined ? { gsr_score: gsrScore } : {}) });
      setLocking(false);
      setLockScore(null);
      setConfirmLeftOut(false);
      state.reload();
    } catch (err) {
      if (inDialog) setLockError(errorMessage(err));
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Back to where the reader came from: their own section for their own review, the person's
  // page for anyone reading someone else's (an admin, a leader, or a manager with division view
  // access who sees the person without leading them).
  const personName = employee ? displayName(employee) : (names.get(review.employee_id) ?? "Person");
  const back = embedded
    ? null
    : isOwn
      ? { to: SECTION_MY[sectionOf(cycle.cadence)], label: sectionOf(cycle.cadence) === "gsr" ? "My GSR" : "My reviews" }
      : { to: `/people/${review.employee_id}`, label: personName };
  const cycleOpen = cycle.status === "open";

  return (
    <>
      <PageHeader
        as={embedded ? "h2" : "h1"}
        backTo={back?.to}
        backLabel={back?.label}
        eyebrow={`${monthly ? "Goal Setting Review · " : ""}${cycle.name} · ${formatPeriod(cycle.period_start, cycle.period_end)}`}
        title={employee ? displayName(employee) : "Review"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {employee?.title ? <span>{employee.title}</span> : null}
            <Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge>
            {cycle.status === "closed" ? <Badge>Cycle closed</Badge> : null}
            {review.completed_at ? (
              <span className="text-ink-3">
                Completed {formatDateTime(review.completed_at)}
                {reviewerName ? ` by ${reviewerName}` : ""}
              </span>
            ) : null}
            {isAdmin && !embedded ? (
              <Link to={cyclePath(cycle)} className={`text-link hover:underline ${tapTargetClass}`}>Everyone in {cycle.name}</Link>
            ) : null}
          </span>
        }
        actions={
          isAdmin ? (
            review.status === "complete" ? (
              // Reopening a review in a closed cycle would strand it: it could not be signed off
              // again until the cycle reopened, and its score of record would be gone meanwhile.
              // The database refuses it too (0039).
              cycleOpen ? (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patchReview({ status: "in_progress", completed_at: null })}>
                  <RotateCcw size={14} aria-hidden /> Reopen
                </Button>
              ) : (
                <p className="max-w-xs text-right text-[12.5px] leading-snug text-ink-3">Reopen the cycle first to reopen this review.</p>
              )
            ) : (
              <Button
                size="sm"
                disabled={busy || !cycleOpen || awaitingRollup || omittedHere}
                onClick={() => {
                  setLockError("");
                  if (monthScore) void startLock();
                  else if (gsrLeftOut) setConfirmLeftOut(true);
                  else void markComplete();
                }}
              >
                <CheckCircle2 size={14} aria-hidden /> Mark complete
              </Button>
            )
          ) : null
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {omittedHere ? (
        <Notice tone="info" className="mb-4">
          {isOwn
            ? `You're not part of ${cycle.name}. This review is set aside as it is.`
            : `${employee ? displayName(employee) : "This person"} is omitted from ${cycle.name}. This review is set aside as it is; add them back on the cycle page to finish it.`}
        </Notice>
      ) : null}
      {/* A monthly GSR carries its theme as the focus topic card beside the goals, so the banner
          is only for the scored cycles, which have no such card. */}
      {cycle.theme && !monthly ? (
        <Notice tone="info" className="mb-6">
          <b>Theme for this cycle: {cycle.theme}.</b> {cycle.theme_description ?? ""}
        </Notice>
      ) : null}

      {/* The review opens with what would help the person do the job better, on every cycle. */}
      <div className="mb-6">
        <SupportDiscussionCard value={review.support_discussion} canWrite={canDiscuss} isOwn={isOwn} signedOff={frozen} onSave={saveDiscussion} />
      </div>

      {/* Annual content, the KPIs, company goals, deliverables and yearly goals, belongs to the
          quarterly and annual reviews. A monthly cycle is a Goal Setting Review: the month's
          goals and nothing else. */}
      {employee && !monthly ? (
        <div className="mb-6">
          <EmployeeSnapshot
            employee={employee}
            names={names}
            year={year}
            kpis={kpis}
            companyGoals={companyGoals}
            isAdmin={isAdmin}
            canOpenProfile={!isOwn}
            onKpis={(update) => state.setData((prev) => (prev ? { ...prev, kpis: update(prev.kpis) } : prev))}
            onError={setError}
          />
        </div>
      ) : null}

      {employee && !monthly ? (
        <Section
          eyebrow={String(year)}
          title="Deliverables"
          className="mb-6"
          description="Rated on the tasks under each heading: two points a task, so a Hit on every one lands on target."
        >
          <DeliverablesPanel companyId={review.company_id} employeeId={review.employee_id} year={year} canEdit={canEditModule} isOwn={isOwn} onRollup={reportRollup} />
        </Section>
      ) : null}

      {employee && !monthly ? (
        <Section
          eyebrow={String(year)}
          title="Yearly goals"
          className="mb-6"
          description="Goals for this year and next, and the BHAG, tracked on the profile and on every quarterly and annual review."
        >
          <GoalsPanel companyId={review.company_id} employeeId={review.employee_id} canEdit={isAdmin} ownerName={displayName(employee).split(" ")[0]} quiet />
        </Section>
      ) : null}

      {!monthly ? (
        <div className="mb-6 empty:hidden">
          <ReviewProjects review={review} assignments={assignments} projects={projects} notes={projectNotes} canWrite={canScore} isOwn={isOwn} onNotes={onProjectNotes} />
        </div>
      ) : null}

      {monthly ? (
        <div className="mb-6">
          <GoalSettingPanel
            review={review}
            cycle={cycle}
            previousCycle={lastMonth}
            cycles={cycles}
            goals={goals}
            notes={notes}
            names={names}
            roleGoals={roleGoals}
            isAdmin={isAdmin}
            isOwn={isOwn}
            isLeader={isLeader}
            omitted={omittedHere}
            gsrRequired={gsrPillars[0]?.required_goals ?? null}
            taskLinks={
              goalTasks
                ? {
                    tasks: goalTasks,
                    people,
                    viewerProfileId: profile.id,
                    onTasks: (update) => state.setData((prev) => (prev ? { ...prev, goalTasks: update(prev.goalTasks ?? []) } : prev)),
                  }
                : null
            }
            onGoals={(update) => state.setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
            onNotes={(update) => state.setData((prev) => (prev ? { ...prev, notes: update(prev.notes) } : prev))}
            onError={setError}
            onTouched={touched}
          />
        </div>
      ) : null}

      {/* The month's results against the role scorecard, for a company that keeps scorecards. */}
      {monthly && employee && reviewMonth && metrics.length > 0 ? (
        <div className="mb-6">
          <ReviewPerformance
            companyId={review.company_id}
            employee={employee}
            month={reviewMonth}
            metrics={metrics}
            entries={entries}
            assignments={assignments}
            projects={projects}
            canEnter={canScore}
            isOwn={isOwn}
            onEntries={(update) => state.setData((prev) => (prev ? { ...prev, entries: update(prev.entries) } : prev))}
          />
        </div>
      ) : null}

      {monthly ? (
        <div className="mb-6 empty:hidden">
          <ReviewProjects review={review} assignments={assignments} projects={projects} notes={projectNotes} canWrite={canScore} isOwn={isOwn} onNotes={onProjectNotes} />
        </div>
      ) : null}

      {/* A monthly cycle is a Goal Setting Review and nothing else: the goals above are the
          whole meeting. Scoring and written feedback belong to the quarterly, annual and custom
          cycles, which render this block unchanged. Scores already recorded against a monthly
          review stay in the database; they are simply not what a monthly review is for. */}
      {monthly ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
          <Section eyebrow="Overall" title={frozen || result.complete ? "Score" : "Score so far"}>
            <div className="flex items-center gap-5">
              <ScoreRing score={hasScoredItem(inputs) ? result.overall : null} size={104} />
              <div className="min-w-0 flex-1 space-y-3">
                {result.pillars.map((p) => (
                  <ScoreBar
                    key={p.pillarId}
                    label={p.leftOut ? `${p.name} (left out)` : `${p.name} (${formatNumber(p.weight)}%)`}
                    percent={p.score}
                    // Signed off with no month locked in, the pillar sat out; its card says so.
                    detail={onDemand && signedOffBarDetail(review, p) ? "No GSR done" : signedOffBarDetail(review, p)}
                  />
                ))}
                {shownPillars.length === 0 ? <p className="text-sm text-ink-2">No pillars configured yet.</p> : null}
              </div>
            </div>
            {weightTotal(pillarsForReview(review, pillars)) !== 100 && shownPillars.length > 0 ? (
              <p className="mt-3 text-[12px] text-warning">Pillar weights total {formatNumber(weightTotal(pillarsForReview(review, pillars)))}%, not 100%. Scores are normalized; fix this in GSR settings.</p>
            ) : null}
          </Section>

          {onDemand ? (
            // The GSRs read back where the pillar does not list them: a company that does not score
            // its GSRs, or a review signed off with what it had.
            gsrPeriod && !(gsrPillars.length > 0 && !frozen) ? (
              <Section eyebrow="Goal Setting Reviews" title="The GSRs in this period" description="Each GSR done inside this period, and any still open.">
                {gsrPeriod.gsrs.length === 0 ? <p className="text-sm text-ink-2">No GSR was done inside this period.</p> : <GsrsInPeriodList figure={gsrPeriod} />}
              </Section>
            ) : null
          ) : (
          <Section eyebrow="Goal Setting Reviews" title="The months in this period" description="Each month's goals as they were read back.">
            {months.length === 0 ? (
              <p className="text-sm text-ink-2">No Goal Setting Review ran inside this period.</p>
            ) : (
              <ul className="divide-y divide-line">
                {months.map(({ month, gsr, score, tally, open }) => (
                  <li key={month.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{month.name}</p>
                      <p className="tnum text-[12px] text-ink-3">
                        {tally.total === 0 ? "No goals set" : `${tally.hit} of ${pluralize(tally.total, "goal")} hit${open > 0 ? `, ${open} still open` : ""}`}
                        {score !== null ? ` · ${score}` : ""}
                      </p>
                    </div>
                    {gsr ? (
                      <Link to={reviewPath(gsr.id, month.cadence)} className={`text-[13px] text-link hover:underline ${tapTargetClass}`}>Open month</Link>
                    ) : (
                      <span className="text-[12px] text-ink-3">Not started</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}
          </div>

          <div className="space-y-6 lg:col-span-2">
            {shownPillars.map((pillar) => {
              // A signed-off review lists the criteria it holds ratings for, retired since or not;
              // an open review lists today's active criteria, which it reads live.
              const pillarCriteria = criteria.filter((c) =>
                c.pillar_id === pillar.id && (frozen ? scores.some((s) => s.criterion_id === c.id) : c.is_active),
              );
              const lineItems = scores
                .filter((s) => s.pillar_id === pillar.id && !s.criterion_id)
                .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
              const summary = result.pillars.find((p) => p.pillarId === pillar.id);
              return (
                <Section
                  key={pillar.id}
                  eyebrow={summary?.leftOut ? "Left out of this review" : `${formatNumber(pillar.weight)}% of overall`}
                  title={pillar.name}
                  description={pillar.description ?? undefined}
                  actions={
                    <span className={`tnum text-lg font-medium ${summary?.score === null || summary?.score === undefined ? "text-ink-3" : "text-heading"}`}>
                      {summary?.score === null || summary?.score === undefined ? "-" : Math.round(summary.score)}
                    </span>
                  }
                >
                  {pillar.scoring_type === "gsr_goals" && onDemand ? (
                    <OnDemandGsrPillarBody figure={gsrPeriod} signedOff={frozen ? (lineItems[0] ?? null) : undefined} />
                  ) : pillar.scoring_type === "gsr_goals" ? (
                    <GsrPillarBody figure={gsrFigures.get(pillar.id) ?? null} signedOff={frozen ? (lineItems[0] ?? null) : undefined} />
                  ) : pillar.scoring_type === "rating" ? (
                    pillarCriteria.length === 0 ? (
                      <p className="text-sm text-ink-2">
                        {frozen ? "Nothing on this pillar was rated when this review was signed off." : "No criteria defined for this pillar yet. Add them in GSR settings."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {/* Ratings are not set here. They live on the person and are read into the
                            meeting; the meeting's record is the notes. Sign-off freezes them. */}
                        <li className="pb-3 text-[12.5px] text-ink-3">
                          {frozen
                            ? "Ratings as they were when this review was signed off."
                            : isAdmin && employee ? (
                              <>
                                Current ratings from{" "}
                                <Link to={`/people/${employee.id}`} className="text-link hover:underline">{displayName(employee)}'s profile</Link>
                                , where they are set and trued up. Signing off freezes them into this review.
                              </>
                            ) : (
                              "Current ratings from the profile, where an admin sets them. Signing off freezes them into this review."
                            )}
                        </li>
                        {pillarCriteria.map((criterion) => {
                          const score = scores.find((s) => s.criterion_id === criterion.id);
                          return (
                            <li key={criterion.id} className="py-4 first:pt-0 last:pb-0">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 max-w-xl">
                                  <p className="text-sm font-medium text-ink">{criterion.name}</p>
                                  {criterion.description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{criterion.description}</p> : null}
                                </div>
                                <RatingInput
                                  label={`${criterion.name} rating`}
                                  value={frozen ? (score?.rating ?? null) : (impactByCriterion.get(criterion.id)?.rating ?? null)}
                                  max={pillar.rating_scale_max}
                                />
                              </div>
                              {canScore || score?.notes ? (
                                <div className="mt-2">
                                  <BlurInput
                                    value={score?.notes ?? ""}
                                    disabled={!canScore}
                                    placeholder="Review notes for this criterion"
                                    onSave={(next) => saveRating(pillar, criterion, { notes: next.trim() || null })}
                                    className={`${inputClass} mt-0 text-[13px]`}
                                  />
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )
                  ) : (
                    <div>
                      {pillar.scoring_type === "deliverables_module" && !frozen ? (
                        // Scored from the deliverables module above, live, and written into this
                        // review as one line item at sign-off. Nothing to type here.
                        <p className="text-sm text-ink-2">
                          {rollup === null
                            ? "Reading the year's deliverables..."
                            : rollup.target === 0
                              ? "No deliverable tasks for the year yet, so nothing to score here. Add them in the Deliverables section above."
                              : `${rollup.actual} of ${rollup.target} points across the year's deliverables (${lineItemPercent(rollup)}%). Frozen into this review when it is marked complete.`}
                        </p>
                      ) : lineItems.length === 0 ? (
                        <p className="text-sm text-ink-2">
                          {canScore ? "Add the deliverables agreed for this period with a target and the actual result." : "No deliverables recorded."}
                        </p>
                      ) : (
                        <div className="relative overflow-x-auto">
                          <table role="table" className="w-full text-sm max-sm:block">
                            <thead role="rowgroup" className="max-sm:sr-only">
                              <tr role="row" className="text-left">
                                <th role="columnheader" className={miniThClass}>Deliverable</th>
                                <th role="columnheader" className={`${miniThClass} text-right`}>Target</th>
                                <th role="columnheader" className={`${miniThClass} text-right`}>Actual</th>
                                <th role="columnheader" className={`${miniThClass} text-right`}>Achieved</th>
                                <th role="columnheader" className="pb-2"><span className="sr-only">Remove</span></th>
                              </tr>
                            </thead>
                            <tbody role="rowgroup" className="max-sm:block">
                              {lineItems.map((item) => {
                                const achieved = lineItemPercent(item);
                                return (
                                  <tr key={item.id} role="row" className="border-t border-line max-sm:flex max-sm:first:border-t-0 max-sm:flex-wrap max-sm:items-start max-sm:gap-x-2 max-sm:py-3">
                                    <td role="cell" className="py-2 pr-3 max-sm:basis-full max-sm:p-0 max-sm:pb-2">
                                      <BlurInput value={item.label ?? ""} disabled={!canScore} placeholder="What was the deliverable?" onSave={(next) => saveLineItem(item, { label: next })} className={`${inputClass} mt-0`} />
                                      {canScore || item.notes ? (
                                        <BlurInput value={item.notes ?? ""} disabled={!canScore} placeholder="Notes" onSave={(next) => saveLineItem(item, { notes: next.trim() || null })} className={`${inputClass} mt-1.5 text-[12.5px]`} />
                                      ) : null}
                                    </td>
                                    <td role="cell" data-label="Target" className={`w-28 py-2 pr-2 align-top max-sm:w-auto max-sm:flex-1 ${stackedCell}`}>
                                      <BlurInput type="text" ariaLabel={`Target for ${item.label || "this deliverable"}`} value={item.target === null ? "" : String(item.target)} disabled={!canScore} placeholder="0" onSave={(next) => saveLineFigure(item, "target", next)} className={`${inputClass} tnum mt-0 text-right`} />
                                    </td>
                                    <td role="cell" data-label="Actual" className={`w-28 py-2 pr-2 align-top max-sm:w-auto max-sm:flex-1 ${stackedCell}`}>
                                      <BlurInput type="text" ariaLabel={`Actual for ${item.label || "this deliverable"}`} value={item.actual === null ? "" : String(item.actual)} disabled={!canScore} placeholder="0" onSave={(next) => saveLineFigure(item, "actual", next)} className={`${inputClass} tnum mt-0 text-right`} />
                                    </td>
                                    <td role="cell" data-label="Achieved" className={`tnum w-20 py-2 text-right align-top leading-[38px] tap:leading-[44px] text-ink-2 max-sm:w-16 ${stackedCell}`}>
                                      {achieved === null ? "-" : `${achieved}%`}
                                    </td>
                                    <td role="cell" className="w-10 py-2 text-right align-top max-sm:self-end max-sm:p-0">
                                      {canScore ? (
                                        <Button variant="danger" size="sm" aria-label="Remove deliverable" onClick={() => setRemoving(item)}>
                                          Remove
                                        </Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {canScore && pillar.scoring_type === "deliverables" ? (
                        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void addLineItem(pillar)}>
                          <Plus size={14} aria-hidden /> Add deliverable
                        </Button>
                      ) : null}
                    </div>
                  )}
                </Section>
              );
            })}

            <Section eyebrow="Feedback" title="Manager notes and feedback">
              <div className="space-y-4">
                {monthly ? null : (
                <div>
                  <label htmlFor="previous-status" className={labelClass}>Previous period goals</label>
                  {isAdmin ? (
                    <select id="previous-status" value={review.previous_status ?? ""} disabled={!canScore} onChange={(e) => void patchReview({ previous_status: (e.target.value || null) as PreviousStatus | null })} className={`${selectClass} max-w-xs`}>
                      <option value="">Not assessed</option>
                      {keysOf(PREVIOUS_STATUS_LABELS).map((key) => (
                        <option key={key} value={key}>{PREVIOUS_STATUS_LABELS[key]}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-1.5">
                      {review.previous_status ? <Badge tone={PREVIOUS_STATUS_TONE[review.previous_status]}>{PREVIOUS_STATUS_LABELS[review.previous_status]}</Badge> : <span className="text-sm text-ink-3">Not assessed</span>}
                    </div>
                  )}
                </div>
                )}
                {(
                  [
                    ["manager_feedback", "Management feedback"],
                    ["peer_feedback", "Peer feedback"],
                    ["client_feedback", "Client feedback"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label htmlFor={key} className={labelClass}>{label}</label>
                    {isAdmin ? (
                      <BlurInput id={key} multiline value={review[key] ?? ""} disabled={!canScore} placeholder={`${label}...`} onSave={(next) => patchReview(feedbackPatch(key, next))} />
                    ) : (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{review[key] || <span className="text-ink-3">Nothing yet.</span>}</p>
                    )}
                  </div>
                ))}
                <div>
                  <label htmlFor="employee_reflection" className={labelClass}>{isOwn ? "Your reflection" : "Employee reflection"}</label>
                  {isOwn ? (
                    <BlurInput id="employee_reflection" multiline value={review.employee_reflection ?? ""} placeholder="How did the period go from your side? What do you want to focus on next?" onSave={(next) => patchReview({ employee_reflection: next.trim() || null })} />
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{review.employee_reflection || <span className="text-ink-3">Nothing yet.</span>}</p>
                  )}
                </div>
              </div>
            </Section>
          </div>
        </div>
      )}

      {locking && lockScore ? (
        <ConfirmDialog
          title={`Lock in ${employee ? displayName(employee).split(" ")[0] : "this"}'s ${cycle.name} GSR at ${lockScore.score}%?`}
          body={`The month's goals add up to ${lockScore.total}% of ${lockScore.cap}%, as they stand now. Marking it complete locks that score in, with the month's goals and notes, and it counts in the next scored review. Reopen the review to change it.`}
          confirmLabel="Mark complete and lock in"
          tone="primary"
          busy={busy}
          error={lockError}
          onConfirm={() => void markComplete()}
          onCancel={() => { setLocking(false); setLockScore(null); }}
        />
      ) : null}
      {confirmLeftOut ? (
        <ConfirmDialog
          title={onDemand ? "Sign off without GSRs?" : "Sign off without Monthly GSRs?"}
          body={
            onDemand
              ? `No GSR was done in ${cycle.name}, so ${gsrPillars[0]?.name ?? "the GSR pillar"} is left out of this review and the other pillars carry its weight. Mark a GSR done first if it should count.`
              : `No month in ${cycle.name} is locked in, so Monthly GSRs is left out of this review and the other pillars carry its weight. Lock a month in first if it should count.`
          }
          confirmLabel="Mark complete"
          tone="primary"
          busy={busy}
          error={lockError}
          onConfirm={() => void markComplete()}
          onCancel={() => setConfirmLeftOut(false)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={removing.label ? `Remove "${removing.label}"?` : "Remove this deliverable?"}
          body="Its target, actual and notes go with it, and the pillar's score is recalculated without it."
          confirmLabel="Remove deliverable"
          busy={busy}
          error={removeError}
          onConfirm={() => void removeLineItem()}
          onCancel={() => { setRemoving(null); setRemoveError(""); }}
        />
      ) : null}
    </>
  );
}
