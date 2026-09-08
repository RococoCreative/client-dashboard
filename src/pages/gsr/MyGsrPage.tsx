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
import { computeReviewScore } from "../../lib/gsr/scoring.ts";
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

  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { reviews, cycles, pillars, scores } = state.data;
  const rows = reviews
    .map((review) => {
      const cycle = cycles.find((c) => c.id === review.cycle_id) ?? null;
      const own = scores.filter((s) => s.review_id === review.id);
      const result = own.length > 0 ? computeReviewScore(pillars, own) : null;
      return { review, cycle, result };
    })
    .sort((a, b) => (a.cycle?.period_start ?? "") < (b.cycle?.period_start ?? "") ? 1 : -1);
  const latest = rows[0] ?? null;

  return (
    <>
      <PageHeader eyebrow="Goal Setting and Review" title="My GSR" description="Your scores and feedback, review by review." />
      <Tabs items={MY_TABS} />

      {rows.length === 0 ? (
        <EmptyState eyebrow="Reviews" title="No reviews yet" body="Your first review appears here once your manager opens a review cycle and starts scoring." />
      ) : (
        <div className="space-y-6">
          {latest ? (
            <Section eyebrow="Latest" title={latest.cycle?.name ?? "Review"} description={latest.cycle ? formatPeriod(latest.cycle.period_start, latest.cycle.period_end) : undefined} actions={<Link to={`/gsr/reviews/${latest.review.id}`} className="text-[13px] text-accent hover:underline">Open full review</Link>}>
              <div className="grid gap-6 md:grid-cols-3">
                <div className="flex items-center gap-4">
                  <ScoreRing score={latest.result?.overall ?? null} size={96} label="Overall" />
                  <div className="space-y-1.5 text-[13px]">
                    <Badge tone={REVIEW_STATUS_TONE[latest.review.status]}>{REVIEW_STATUS_LABELS[latest.review.status]}</Badge>
                    {latest.review.previous_status ? (
                      <p className="text-ink-2">Previous goals: <Badge tone={PREVIOUS_STATUS_TONE[latest.review.previous_status]}>{PREVIOUS_STATUS_LABELS[latest.review.previous_status]}</Badge></p>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-3 md:col-span-2">
                  {(latest.result?.pillars ?? pillars.map((p) => ({ pillarId: p.id, name: p.name, weight: p.weight, score: null }))).map((p) => (
                    <ScoreBar key={p.pillarId} label={`${p.name} (${formatNumber(p.weight)}%)`} percent={p.score} />
                  ))}
                </div>
              </div>
              {latest.review.manager_feedback ? (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-label text-ink-3">Management feedback</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{latest.review.manager_feedback}</p>
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
