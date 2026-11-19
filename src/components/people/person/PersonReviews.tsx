// A person's Reviews tab: their impact score (the ratings an admin sets on the person and trues up
// before each review, frozen into the review at sign-off), their deliverables for the year, their
// review history, and the latest scored review. Ratings and their notes stay live controls for an
// admin and read only for a manager. Every number here comes from the scoring engine, never from
// arithmetic of its own.
import { Link } from "react-router-dom";
import Badge from "../../ui/Badge.tsx";
import BlurInput from "../../ui/BlurInput.tsx";
import RatingInput from "../../ui/RatingInput.tsx";
import ScoreRing from "../../ui/ScoreRing.tsx";
import Section from "../../ui/Section.tsx";
import { bandClass } from "../../ui/bandClass.ts";
import { inputClass, tableClass, tdClass, thClass } from "../../ui/forms.ts";
import GsrQuarterLine from "../../gsr/GsrQuarterLine.tsx";
import DeliverablesPanel from "../DeliverablesPanel.tsx";
import { REVIEW_STATUS_TONE } from "../../status.ts";
import { useHub } from "../../../context/HubContext.tsx";
import { scoreProfile } from "../../../lib/gsr/scoring.ts";
import { latestScoredReview, previousCompletedReview, reviewHistory } from "../../../lib/gsr/history.ts";
import { reviewPath, rhythmOf, scoredCycleInPlay } from "../../../lib/gsr/cycles.ts";
import { scoreGsrMonths } from "../../../lib/gsr/goals.ts";
import { formatPeriod } from "../../../lib/format.ts";
import { REVIEW_STATUS_LABELS } from "../../../types/database.ts";
import type { PersonTabProps } from "../../../pages/people/personTabs.ts";

export default function PersonReviews({
  companyId,
  data,
  person,
  writeImpact,
}: PersonTabProps & {
  // Writes one criterion's rating or note through the page's queue for it.
  writeImpact: (criterionId: string, change: { rating?: number; note?: string | null }) => Promise<boolean>;
}) {
  const { profile: me, isAdmin } = useHub();
  const { reviews, cycles, pillars, criteria, impact, scores, goals, omittedCycleIds } = data;
  const year = new Date().getFullYear();
  const self = person.id === me.id;
  // For a company that scores its GSRs: where the locked-in months inside the open scored review
  // stand. The same scored cycle the person's own dashboard reads, found among scored cycles first.
  const gsrPillar = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active) ?? null;
  const scoredCycle = scoredCycleInPlay(cycles);
  const gsrQuarter = gsrPillar && scoredCycle ? scoreGsrMonths(scoredCycle, cycles, goals, reviews, gsrPillar.required_goals, omittedCycleIds, rhythmOf(person)) : null;

  const rows = reviewHistory(reviews, cycles, pillars, scores);
  // The newest review and the newest scored review are different rows once a monthly Goal
  // Setting Review, which carries no scores, sits inside a scored quarter.
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

  return (
    <div className="space-y-6">
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
                      No criteria yet. Admins add them per pillar in <Link to="/reviews/setup" className="text-link hover:underline">Reviews, Setup</Link>.
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          eyebrow={String(year)}
          title="Deliverables"
          description="What this person owns, grouped the way the company thinks about it. Each heading is scored by the tasks under it: two points a task, so a Hit on every one lands on target."
        >
          <DeliverablesPanel companyId={companyId} employeeId={person.id} year={year} canEdit={isAdmin} isOwn={self} />
        </Section>
        <div className="min-w-0 space-y-6">
          <Section
            eyebrow="Reviews"
            title="Review history"
            padded={false}
            actions={isAdmin ? <Link to="/reviews" className="text-link text-[13px] hover:underline">Review cycles</Link> : undefined}
          >
            {rows.length === 0 ? (
              isAdmin ? (
                <p className="p-4 text-sm text-ink-2 sm:p-6">
                  No reviews yet. An admin opens a cycle in <Link to="/reviews" className="text-link hover:underline">Reviews</Link> or <Link to="/gsr" className="text-link hover:underline">GSRs</Link>, and everyone on the roster gets one.
                </p>
              ) : (
                <p className="p-4 text-sm text-ink-2 sm:p-6">No reviews yet. They show here once an admin opens a cycle.</p>
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
                        <td className={`${tdClass} text-right`}><Link to={cycle ? reviewPath(review.id, cycle) : `/gsr/reviews/${review.id}`} className="text-link text-[13px] hover:underline">Open</Link></td>
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
    </div>
  );
}
