// One person's review for one cycle. A monthly cycle is a Goal Setting Review: goals set
// live with action steps and progress, last month read back as hit or miss, yearly goals
// and focus topics alongside, then the scores. Admins score here: ratings per criterion for
// rating pillars, target-vs-actual line items for deliverable pillars, then feedback and a
// status. Employees open the same page read-only for their own review (RLS makes sure it
// is theirs) with their reflection and their own goals' steps and progress writable. Every
// change saves on its own, so there is no save button to forget.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
import EmployeeSnapshot from "../../components/gsr/EmployeeSnapshot.tsx";
import GoalSettingPanel from "../../components/gsr/GoalSettingPanel.tsx";
import Badge from "../../components/ui/Badge.tsx";
import BlurInput from "../../components/ui/BlurInput.tsx";
import Button from "../../components/ui/Button.tsx";
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
import {
  createScore,
  deleteScore,
  getCycle,
  getReview,
  listCompanyGoals,
  listCriteria,
  listCycles,
  listGoals,
  listPillars,
  listReviewScores,
  updateReview,
  updateScore,
  type ReviewPatch,
} from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listEmployeeKpis } from "../../services/employees.ts";
import { computeReviewScore } from "../../lib/gsr/scoring.ts";
import { cycleYear, previousCycle } from "../../lib/gsr/cycles.ts";
import { errorMessage } from "../../lib/errors.ts";
import { displayName, formatDateTime, formatNumber, formatPeriod } from "../../lib/format.ts";
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

export default function ReviewPage() {
  const { reviewId = "" } = useParams();
  const { company, profile, isAdmin } = useHub();
  const companyId = company!.id;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const state = useAsync(async () => {
    const review = await getReview(reviewId);
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
    const [kpis, companyGoals] = await Promise.all([
      listEmployeeKpis(review.company_id, review.employee_id, year),
      listCompanyGoals(review.company_id, year),
    ]);
    return { review, cycle, cycles, pillars, criteria, scores, people, goals, kpis, companyGoals, year };
  }, [reviewId, companyId]);

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={8} />;

  const { review, cycle, cycles, pillars, criteria, scores, people, goals, kpis, companyGoals, year } = state.data;
  const employee = people.find((p) => p.id === review.employee_id) ?? null;
  const isOwn = review.employee_id === profile.id;
  const canScore = isAdmin && cycle.status === "open";
  // Monthly cycles are Goal Setting Reviews: goals lead, scores follow.
  const monthly = cycle.cadence === "monthly";
  const lastMonth = monthly ? previousCycle(cycles, cycle) : null;
  const criteriaCount = Object.fromEntries(pillars.map((p) => [p.id, criteria.filter((c) => c.pillar_id === p.id).length]));
  const result = computeReviewScore(pillars, scores, criteriaCount);

  function replaceScore(next: ReviewScore) {
    state.setData((prev) =>
      prev
        ? { ...prev, scores: prev.scores.some((s) => s.id === next.id) ? prev.scores.map((s) => (s.id === next.id ? next : s)) : [...prev.scores, next] }
        : prev,
    );
  }

  async function markInProgress() {
    if (review.status !== "not_started") return;
    const next = await updateReview(review.id, { status: "in_progress" });
    state.setData((prev) => (prev ? { ...prev, review: next } : prev));
  }

  async function saveRating(pillar: GsrPillar, criterion: GsrCriterion, patch: { rating?: number | null; notes?: string | null }) {
    setError("");
    try {
      const existing = scores.find((s) => s.criterion_id === criterion.id);
      const saved = existing
        ? await updateScore(existing.id, patch)
        : await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillar.id, criterion_id: criterion.id, ...patch });
      replaceScore(saved);
      await markInProgress();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addLineItem(pillar: GsrPillar) {
    setError("");
    try {
      const items = scores.filter((s) => s.pillar_id === pillar.id && !s.criterion_id);
      const saved = await createScore({ review_id: review.id, company_id: review.company_id, pillar_id: pillar.id, label: "", sort_order: items.length });
      replaceScore(saved);
      await markInProgress();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveLineItem(score: ReviewScore, patch: { label?: string; target?: number | null; actual?: number | null; notes?: string | null }) {
    setError("");
    try {
      replaceScore(await updateScore(score.id, patch));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeLineItem(score: ReviewScore) {
    setError("");
    try {
      await deleteScore(score.id);
      state.setData((prev) => (prev ? { ...prev, scores: prev.scores.filter((s) => s.id !== score.id) } : prev));
    } catch (err) {
      setError(errorMessage(err));
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

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed.replace(/[$,]/g, ""));
    return Number.isFinite(value) ? value : null;
  };

  return (
    <>
      <PageHeader
        backTo={isAdmin ? `/gsr/cycles/${cycle.id}` : "/my"}
        backLabel={isAdmin ? cycle.name : "My GSR"}
        eyebrow={`${monthly ? "Goal Setting Review · " : ""}${cycle.name} · ${formatPeriod(cycle.period_start, cycle.period_end)}`}
        title={employee ? displayName(employee) : "Review"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {employee?.title ? <span>{employee.title}</span> : null}
            <Badge tone={REVIEW_STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge>
            {cycle.status === "closed" ? <Badge>Cycle closed</Badge> : null}
            {review.completed_at ? <span className="text-ink-3">Completed {formatDateTime(review.completed_at)}</span> : null}
          </span>
        }
        actions={
          isAdmin ? (
            review.status === "complete" ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patchReview({ status: "in_progress", completed_at: null })}>
                <RotateCcw size={14} aria-hidden /> Reopen
              </Button>
            ) : (
              <Button size="sm" disabled={busy || cycle.status !== "open"} onClick={() => void patchReview({ status: "complete", completed_at: new Date().toISOString(), reviewer_id: profile.id })}>
                <CheckCircle2 size={14} aria-hidden /> Mark complete
              </Button>
            )
          ) : null
        }
      />

      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
      {cycle.theme ? (
        <Notice tone="info" className="mb-6">
          <b>Theme for this cycle: {cycle.theme}.</b> {cycle.theme_description ?? ""}
        </Notice>
      ) : null}

      {employee ? (
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

      {monthly ? (
        <div className="mb-6">
          <GoalSettingPanel
            review={review}
            cycle={cycle}
            previousCycle={lastMonth}
            goals={goals}
            isAdmin={isAdmin}
            isOwn={isOwn}
            onGoals={(update) => state.setData((prev) => (prev ? { ...prev, goals: update(prev.goals) } : prev))}
            onError={setError}
            onTouched={() => void markInProgress().catch((err: unknown) => setError(errorMessage(err)))}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Section eyebrow="Overall" title={result.complete ? "Score" : "Score so far"} className="lg:col-span-1">
          <div className="flex items-center gap-5">
            <ScoreRing score={scores.length > 0 ? result.overall : null} size={104} />
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
                                value={score?.rating ?? null}
                                max={pillar.rating_scale_max}
                                onChange={canScore ? (next) => void saveRating(pillar, criterion, { rating: next }) : undefined}
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
                    {lineItems.length === 0 ? (
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
                                    <BlurInput type="text" value={item.target === null ? "" : String(item.target)} disabled={!canScore} placeholder="0" onSave={(next) => void saveLineItem(item, { target: numberOrNull(next) })} className={`${inputClass} tnum mt-0 text-right`} />
                                  </td>
                                  <td className="w-28 py-2 pr-2 align-top">
                                    <BlurInput type="text" value={item.actual === null ? "" : String(item.actual)} disabled={!canScore} placeholder="0" onSave={(next) => void saveLineItem(item, { actual: numberOrNull(next) })} className={`${inputClass} tnum mt-0 text-right`} />
                                  </td>
                                  <td className="tnum w-20 py-2 text-right align-top leading-[38px] text-ink-2">
                                    {achieved === null ? "-" : `${Math.round(achieved * 100)}%`}
                                  </td>
                                  <td className="w-10 py-2 text-right align-top">
                                    {canScore ? (
                                      <IconButton label="Remove deliverable" onClick={() => void removeLineItem(item)}>
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
                    {canScore ? (
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
    </>
  );
}
