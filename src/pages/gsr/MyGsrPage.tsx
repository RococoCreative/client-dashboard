// An employee's own GSR: the latest review with its score and feedback, and every past
// review in one table. Admins get the same view of themselves. Goals live on the next tab.
import { Link } from "react-router-dom";
import Badge from "../../components/ui/Badge.tsx";
import EmptyState from "../../components/ui/EmptyState.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import ScoreBar from "../../components/ui/ScoreBar.tsx";
import ScoreRing from "../../components/ui/ScoreRing.tsx";
import { bandClass } from "../../components/ui/bandClass.ts";
import Section from "../../components/ui/Section.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { SkeletonRows } from "../../components/ui/Skeleton.tsx";
import { tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { PREVIOUS_STATUS_TONE, REVIEW_STATUS_TONE } from "../../components/status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles, listEmployeeReviews, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { latestScoredReview, reviewHistory } from "../../lib/gsr/history.ts";
import { formatNumber, formatPeriod } from "../../lib/format.ts";
import { PREVIOUS_STATUS_LABELS, REVIEW_STATUS_LABELS } from "../../types/database.ts";
import { MY_TABS } from "./myTabs.ts";

export default function MyGsrPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;

  const state = useAsync(async () => {
    const [reviews, cycles, pillars] = await Promise.all([listEmployeeReviews(profile.id), listCycles(companyId), listPillars(companyId)]);
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    return { reviews, cycles, pillars, scores };
  }, [companyId, profile.id]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { reviews, cycles, pillars, scores } = state.data;
  const rows = reviewHistory(reviews, cycles, pillars, scores);
  // The newest review is not the newest scored one once a monthly Goal Setting Review, which
  // carries no scores, sits inside a scored quarter: reading the ring off row zero showed an
  // empty ring and "Not scored" bars with a finished, rated review one line down in the table.
  // The whole card comes from one review so the status and the feedback match the number.
  const featured = latestScoredReview(rows) ?? rows[0] ?? null;

  return (
    <>
      <PageHeader eyebrow="Goal Setting and Review" title="My GSR" description="Your scores and feedback, review by review." />
      <Tabs items={MY_TABS} />

      {rows.length === 0 ? (
        <EmptyState eyebrow="Reviews" title="No reviews yet" body="Your first review appears here once your manager opens a review cycle and starts scoring." />
      ) : (
        <div className="space-y-6">
          {featured ? (
            <Section eyebrow={featured.result ? "Latest scored review" : "Latest"} title={featured.cycle?.name ?? "Review"} description={featured.cycle ? formatPeriod(featured.cycle.period_start, featured.cycle.period_end) : undefined} actions={<Link to={`/gsr/reviews/${featured.review.id}`} className="text-[13px] text-accent hover:underline">Open full review</Link>}>
              <div className="grid gap-6 md:grid-cols-3">
                <div className="flex items-center gap-4">
                  <ScoreRing score={featured.result?.overall ?? null} size={96} label="Overall" />
                  <div className="space-y-1.5 text-[13px]">
                    <Badge tone={REVIEW_STATUS_TONE[featured.review.status]}>{REVIEW_STATUS_LABELS[featured.review.status]}</Badge>
                    {featured.review.previous_status ? (
                      <p className="text-ink-2">Previous goals: <Badge tone={PREVIOUS_STATUS_TONE[featured.review.previous_status]}>{PREVIOUS_STATUS_LABELS[featured.review.previous_status]}</Badge></p>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-3 md:col-span-2">
                  {(featured.result?.pillars ?? pillars.map((p) => ({ pillarId: p.id, name: p.name, weight: p.weight, score: null }))).map((p) => (
                    <ScoreBar key={p.pillarId} label={`${p.name} (${formatNumber(p.weight)}%)`} percent={p.score} />
                  ))}
                </div>
              </div>
              {featured.review.manager_feedback ? (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Management feedback</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{featured.review.manager_feedback}</p>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section eyebrow="History" title="All reviews" padded={false}>
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
                      <td className={`${tdClass} text-right`}><Link to={`/gsr/reviews/${review.id}`} className="text-[13px] text-accent hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </>
  );
}
