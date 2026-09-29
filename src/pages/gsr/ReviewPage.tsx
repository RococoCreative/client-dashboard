// One person's review for one cycle, in one of two shapes.
//
// A monthly cycle is a Goal Setting Review and only that: the employee snapshot, then goals
// set live with action steps, progress and notes, last month read back as hit or miss, and
// the yearly goals alongside. No pillar scoring and no written feedback, because the meeting
// is the goals and the notes on them.
//
// Quarterly, annual and custom cycles are the scoring review: ratings per criterion for rating
// pillars, target-vs-actual line items for deliverable pillars, the overall score, and the
// management, peer and client feedback with the employee's reflection.
//
// Employees open the same page read-only for their own review (RLS makes sure it is theirs)
// with their reflection and their own goals' steps and progress writable. Every change saves
// on its own, so there is no save button to forget.
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
import EmployeeSnapshot from "../../components/gsr/EmployeeSnapshot.tsx";
import GoalSettingPanel from "../../components/gsr/GoalSettingPanel.tsx";
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import DeliverablesPanel from "../../components/people/DeliverablesPanel.tsx";
import type { DeliverableScore } from "../../lib/gsr/deliverables.ts";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.tsx";
import IconButton from "../../components/ui/IconButton.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import RatingInput from "../../components/ui/RatingInput.tsx";
import ScoreBar from "../../components/ui/ScoreBar.tsx";
import ScoreRing from "../../components/ui/ScoreRing.tsx";
import Section from "../../components/ui/Section.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { inputClass, labelClass, selectClass } from "../../components/ui/forms.ts";
import { PREVIOUS_STATUS_TONE, REVIEW_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { assertInCompany } from "../../lib/tenancy.ts";
import { createScore, deleteScore, getCycle, getReview, listCompanyGoals, listCriteria, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listReviewScores, type ReviewPatch, updateReview, updateScore } from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listEmployeeKpis } from "../../services/employees.ts";
import { computeReviewScore , countCriteria, hasScoredItem, scoreInputsForReview, type ScoreInput } from "../../lib/gsr/scoring.ts";
import { SECTION_MY, cyclePath, cycleSettled, cycleYear, monthsWithin, previousCycle, reviewPath, sectionOf } from "../../lib/gsr/cycles.ts";
import { goalOutcome, hitCount } from "../../lib/gsr/goals.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDateTime, formatNumber, formatPeriod, parseMoney, pluralize } from "../../lib/format.ts";
import {
  PREVIOUS_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  keysOf,
  type GsrCriterion,
  type GsrPillar,
  type PreviousStatus,
  type ReviewScore,
} from "../../types/database.ts";

// Table headers must stay table-cells: the shared label class sets display:block.
const miniThClass = "pb-2 text-[11px] font-medium uppercase tracking-label text-ink-3";

// Mounted by the router with the id in the URL, and by My GSR with the id as a prop so the
// employee's own month renders under their own sidebar entry and tabs. Embedded, it has no back
// link: the tabs above are the way around.
export default function ReviewPage({ reviewId: reviewIdProp, embedded = false }: { reviewId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const reviewId = reviewIdProp ?? params.reviewId ?? "";
  const { company, profile, isAdmin } = useHub();
  const companyId = company!.id;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A deliverable line carries its target, actual and notes, and removing it changes the
  // pillar's score, so it is confirmed rather than deleted on a single icon click.
  const [removing, setRemoving] = useState<ReviewScore | null>(null);
  const [removeError, setRemoveError] = useState("");
  // The deliverables module's figure for the year, reported by the panel below once loaded.
  const [rollup, setRollup] = useState<DeliverableScore | null>(null);

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
    const [cycle, cycles, pillars, criteria, scores, people, goals] = await Promise.all([
      getCycle(review.cycle_id),
      listCycles(review.company_id),
      listPillars(review.company_id),
      listCriteria(review.company_id),
      listReviewScores(review.id),
      listCompanyProfiles(review.company_id),
      listGoals(review.company_id, review.employee_id),
    ]);
    const year = cycleYear(cycle);
    const [kpis, companyGoals, impact, personReviews] = await Promise.all([
      listEmployeeKpis(review.company_id, review.employee_id, year),
      listCompanyGoals(review.company_id, year),
      listImpactScores(review.company_id, review.employee_id),
      // The person's other reviews, so each month inside this period can link to its GSR.
      listEmployeeReviews(review.employee_id),
    ]);
    return { review, cycle, cycles, pillars, criteria, scores, people, goals, kpis, companyGoals, impact, personReviews, year };
  }, [reviewId, companyId]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { review, cycle, cycles, pillars, criteria, scores, people, goals, kpis, companyGoals, impact, personReviews, year } = state.data;
  const employee = people.find((p) => p.id === review.employee_id) ?? null;
  // Written on Mark complete; this is where it is read back, so a signed-off review says who
  // signed it off.
  const reviewer = review.reviewer_id ? (people.find((p) => p.id === review.reviewer_id) ?? null) : null;
  const isOwn = review.employee_id === profile.id;
  const canScore = isAdmin && cycle.status === "open";
  // Monthly cycles are Goal Setting Reviews: goals lead, scores follow.
  const monthly = cycle.cadence === "monthly";
  const lastMonth = monthly ? previousCycle(cycles, cycle) : null;
  // A scored review reads back the Goal Setting Reviews that ran inside its period: each
  // month's goals, hit or miss, and a link to the month. The reviewer's own previous-period
  // judgment stays where it is; this is the record beside it.
  const months = monthly
    ? []
    : monthsWithin(cycle, cycles).map((month) => {
        const own = goals.filter((g) => g.scope === "cycle" && g.cycle_id === month.id);
        const gsr = personReviews.find((r) => r.cycle_id === month.id) ?? null;
        return { month, gsr, tally: hitCount(own, cycleSettled(month)), open: own.filter((g) => goalOutcome(g, cycleSettled(month)) === "open").length };
      });
  const frozen = review.status === "complete";
  const impactByCriterion = new Map(impact.map((i) => [i.criterion_id, i]));
  // What scores this review right now. Frozen rows once it is complete; before that the
  // person's current impact ratings for the rating pillars, the typed line items for a
  // 'deliverables' pillar, and the module's live rollup for a 'deliverables_module' pillar. The
  // rollup arrives from the panel above once it has loaded.
  const modulePillars = pillars.filter((p) => p.scoring_type === "deliverables_module" && p.is_active);
  const liveScores: ScoreInput[] = frozen
    ? scores
    : [
        ...scores.filter((s) => !modulePillars.some((p) => p.id === s.pillar_id)),
        ...(rollup && rollup.target > 0 ? modulePillars.map((p) => ({ pillar_id: p.id, criterion_id: null, target: rollup.target, actual: rollup.actual })) : []),
      ];
  const inputs = scoreInputsForReview(review, liveScores, impact, criteria);
  const result = computeReviewScore(pillars, inputs, countCriteria(criteria));
  // Sign-off writes the module's figure as a line item, so it needs the figure in hand.
  const awaitingRollup = !frozen && modulePillars.length > 0 && rollup === null;

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
  // permission error for a save that actually succeeded.
  async function markInProgress() {
    if (!isAdmin || review.status !== "not_started") return;
    const next = await updateReview(review.id, { status: "in_progress" });
    state.setData((prev) => (prev ? { ...prev, review: next } : prev));
  }

  async function saveRating(pillar: GsrPillar, criterion: GsrCriterion, patch: { rating?: number | null; notes?: string | null }) {
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
    } catch (err) {
      setError(errorMessage(err));
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

  async function saveLineItem(score: ReviewScore, patch: { label?: string; target?: number | null; actual?: number | null; notes?: string | null }) {
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
    } catch (err) {
      setError(errorMessage(err));
    }
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

  async function patchReview(patch: ReviewPatch) {
    setError("");
    setBusy(true);
    try {
      const next = await updateReview(review.id, patch);
      state.setData((prev) => (prev ? { ...prev, review: next } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const feedbackPatch = (key: "manager_feedback" | "peer_feedback" | "client_feedback", value: string): ReviewPatch => {
    const patch: ReviewPatch = {};
    patch[key] = value.trim() || null;
    return patch;
  };

  // Sign-off. The module's figure is written as this review's line item first, one row per
  // module pillar, so the status flip that follows has everything it freezes. The database then
  // copies the person's current ratings into the review (0017); the reload reads them back.
  async function markComplete() {
    setBusy(true);
    setError("");
    try {
      for (const pillar of modulePillars) {
        if (!rollup || rollup.target === 0) continue;
        const line = { label: `Deliverables ${year}`, target: rollup.target, actual: rollup.actual };
        const existing = scores.find((s) => s.pillar_id === pillar.id && !s.criterion_id);
        if (existing) await updateScore(existing.id, line);
        else await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillar.id, ...line });
      }
      await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: profile.id });
      state.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        backTo={embedded ? undefined : isAdmin ? cyclePath(cycle) : SECTION_MY[sectionOf(cycle.cadence)]}
        backLabel={embedded ? undefined : isAdmin ? cycle.name : sectionOf(cycle.cadence) === "gsr" ? "My GSR" : "My reviews"}
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
                {reviewer ? ` by ${displayName(reviewer)}` : ""}
              </span>
            ) : null}
          </span>
        }
        actions={
          isAdmin ? (
            review.status === "complete" ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patchReview({ status: "in_progress", completed_at: null })}>
                <RotateCcw size={14} aria-hidden /> Reopen
              </Button>
            ) : (
              <Button size="sm" disabled={busy || cycle.status !== "open" || awaitingRollup} onClick={() => void markComplete()}>
                <CheckCircle2 size={14} aria-hidden /> Mark complete
              </Button>
            )
          ) : null
        }
      />

      {state.error ? <Notice tone="error" className="mb-4">{state.error}</Notice> : null}
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {cycle.theme ? (
        <Notice tone="info" className="mb-6">
          <b>Theme for this cycle: {cycle.theme}.</b> {cycle.theme_description ?? ""}
        </Notice>
      ) : null}

      {/* Annual content, the KPIs, company goals, deliverables and yearly goals, belongs to the
          quarterly and annual reviews. A monthly cycle is a Goal Setting Review: the month's
          goals and nothing else. */}
      {employee && !monthly ? (
        <div className="mb-6">
          <EmployeeSnapshot
            employee={employee}
            people={people}
            year={year}
            kpis={kpis}
            companyGoals={companyGoals}
            isAdmin={isAdmin}
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
          <DeliverablesPanel companyId={review.company_id} employeeId={review.employee_id} year={year} canEdit={canScore} onRollup={setRollup} />
        </Section>
      ) : null}

      {employee && !monthly ? (
        <Section
          eyebrow={String(year)}
          title="Yearly goals"
          className="mb-6"
          description="Personal and professional goals for the year, tracked on the profile and on every quarterly and annual review."
        >
          <GoalsPanel companyId={review.company_id} employeeId={review.employee_id} canEdit={isAdmin} cycles={cycles} scope="year" />
        </Section>
      ) : null}

      {monthly ? (
        <div className="mb-6">
          <GoalSettingPanel
            review={review}
            cycle={cycle}
            previousCycle={lastMonth}
            cycles={cycles}
            goals={goals}
            isAdmin={isAdmin}
            isOwn={isOwn}
            onGoals={(update) => state.setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
            onError={setError}
            onTouched={() => void markInProgress().catch((err: unknown) => setError(errorMessage(err)))}
          />
        </div>
      ) : null}

      {/* A monthly cycle is a Goal Setting Review and nothing else: the goals above are the
          whole meeting. Scoring and written feedback belong to the quarterly, annual and custom
          cycles, which render this block unchanged. Scores already recorded against a monthly
          review stay in the database; they are simply not what a monthly review is for. */}
      {monthly ? null : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
          <Section eyebrow="Overall" title={result.complete ? "Score" : "Score so far"}>
            <div className="flex items-center gap-5">
              <ScoreRing score={hasScoredItem(inputs) ? result.overall : null} size={104} />
              <div className="min-w-0 flex-1 space-y-3">
                {result.pillars.map((p) => (
                  <ScoreBar key={p.pillarId} label={`${p.name} (${formatNumber(p.weight)}%)`} percent={p.score} />
                ))}
                {pillars.length === 0 ? <p className="text-sm text-ink-2">No pillars configured yet.</p> : null}
              </div>
            </div>
            {result.weightTotal !== 100 && pillars.length > 0 ? (
              <p className="mt-3 text-[12px] text-warning">Pillar weights total {formatNumber(result.weightTotal)}%, not 100%. Scores are normalized; fix this in GSR settings.</p>
            ) : null}
          </Section>

          <Section eyebrow="Goal Setting Reviews" title="The months in this period" description="Each month's goals as they were read back.">
            {months.length === 0 ? (
              <p className="text-sm text-ink-2">No Goal Setting Review ran inside this period.</p>
            ) : (
              <ul className="divide-y divide-line">
                {months.map(({ month, gsr, tally, open }) => (
                  <li key={month.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{month.name}</p>
                      <p className="tnum text-[12px] text-ink-3">
                        {tally.total === 0 ? "No goals set" : `${tally.hit} of ${pluralize(tally.total, "goal")} hit${open > 0 ? `, ${open} still open` : ""}`}
                      </p>
                    </div>
                    {gsr ? (
                      <Link to={reviewPath(gsr.id, month.cadence)} className="text-[13px] text-accent hover:underline">Open month</Link>
                    ) : (
                      <span className="text-[12px] text-ink-3">Not started</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          </div>

          <div className="space-y-6 lg:col-span-2">
            {pillars.map((pillar) => {
              const pillarCriteria = criteria.filter((c) => c.pillar_id === pillar.id);
              const lineItems = scores
                .filter((s) => s.pillar_id === pillar.id && !s.criterion_id)
                .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
              const summary = result.pillars.find((p) => p.pillarId === pillar.id);
              return (
                <Section
                  key={pillar.id}
                  eyebrow={`${formatNumber(pillar.weight)}% of overall`}
                  title={pillar.name}
                  description={pillar.description ?? undefined}
                  actions={
                    <span className={`tnum text-lg font-medium ${summary?.score === null || summary?.score === undefined ? "text-ink-3" : "text-heading"}`}>
                      {summary?.score === null || summary?.score === undefined ? "-" : Math.round(summary.score)}
                    </span>
                  }
                >
                  {pillar.scoring_type === "rating" ? (
                    pillarCriteria.length === 0 ? (
                      <p className="text-sm text-ink-2">No criteria defined for this pillar yet. Add them in GSR settings.</p>
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
                                <Link to={`/people/${employee.id}`} className="text-accent hover:underline">{displayName(employee)}'s profile</Link>
                                , where they are set and trued up. Signing off freezes them into this review.
                              </>
                            ) : (
                              "Current ratings from the profile, where your manager sets them. Signing off freezes them into this review."
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
                                    onSave={(next) => void saveRating(pillar, criterion, { notes: next.trim() || null })}
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
                              : `${rollup.actual} of ${rollup.target} points across the year's deliverables (${Math.min(100, Math.round((rollup.actual / rollup.target) * 100))}%). Frozen into this review when it is marked complete.`}
                        </p>
                      ) : lineItems.length === 0 ? (
                        <p className="text-sm text-ink-2">
                          {canScore ? "Add the deliverables agreed for this period with a target and the actual result." : "No deliverables recorded."}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left">
                                <th className={miniThClass}>Deliverable</th>
                                <th className={`${miniThClass} text-right`}>Target</th>
                                <th className={`${miniThClass} text-right`}>Actual</th>
                                <th className={`${miniThClass} text-right`}>Achieved</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {lineItems.map((item) => {
                                const achieved = item.target && item.target > 0 && item.actual !== null ? Math.min(item.actual / item.target, 1) : null;
                                return (
                                  <tr key={item.id} className="border-t border-line">
                                    <td className="py-2 pr-3">
                                      <BlurInput value={item.label ?? ""} disabled={!canScore} placeholder="What was the deliverable?" onSave={(next) => void saveLineItem(item, { label: next })} className={`${inputClass} mt-0`} />
                                      {canScore || item.notes ? (
                                        <BlurInput value={item.notes ?? ""} disabled={!canScore} placeholder="Notes" onSave={(next) => void saveLineItem(item, { notes: next.trim() || null })} className={`${inputClass} mt-1.5 text-[12.5px]`} />
                                      ) : null}
                                    </td>
                                    <td className="w-28 py-2 pr-2 align-top">
                                      <BlurInput type="text" value={item.target === null ? "" : String(item.target)} disabled={!canScore} placeholder="0" onSave={(next) => void saveLineItem(item, { target: parseMoney(next) })} className={`${inputClass} tnum mt-0 text-right`} />
                                    </td>
                                    <td className="w-28 py-2 pr-2 align-top">
                                      <BlurInput type="text" value={item.actual === null ? "" : String(item.actual)} disabled={!canScore} placeholder="0" onSave={(next) => void saveLineItem(item, { actual: parseMoney(next) })} className={`${inputClass} tnum mt-0 text-right`} />
                                    </td>
                                    <td className="tnum w-20 py-2 text-right align-top leading-[38px] text-ink-2">
                                      {achieved === null ? "-" : `${Math.round(achieved * 100)}%`}
                                    </td>
                                    <td className="w-10 py-2 text-right align-top">
                                      {canScore ? (
                                        <IconButton label="Remove deliverable" onClick={() => setRemoving(item)}>
                                          <Trash2 size={14} aria-hidden />
                                        </IconButton>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {canScore && pillar.scoring_type !== "deliverables_module" ? (
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
                      <BlurInput id={key} multiline value={review[key] ?? ""} disabled={!canScore} placeholder={`${label}...`} onSave={(next) => void patchReview(feedbackPatch(key, next))} />
                    ) : (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{review[key] || <span className="text-ink-3">Nothing yet.</span>}</p>
                    )}
                  </div>
                ))}
                <div>
                  <label htmlFor="employee_reflection" className={labelClass}>{isOwn ? "Your reflection" : "Employee reflection"}</label>
                  {isOwn ? (
                    <BlurInput id="employee_reflection" multiline value={review.employee_reflection ?? ""} placeholder="How did the period go from your side? What do you want to focus on next?" onSave={(next) => void patchReview({ employee_reflection: next.trim() || null })} />
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{review.employee_reflection || <span className="text-ink-3">Nothing yet.</span>}</p>
                  )}
                </div>
              </div>
            </Section>
          </div>
        </div>
      )}

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
