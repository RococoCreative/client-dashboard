// The front door. Admins see the state of every module for their company at a glance:
// people, the current review cycle's progress and team score, company goals for the year,
// the libraries. Employees see their own latest score, open goals, and what changed in the
// SOP library. Everything here is a summary with a link into the module that owns it.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Badge from "../components/ui/Badge.tsx";
import Button from "../components/ui/Button.tsx";
import EmptyState from "../components/ui/EmptyState.tsx";
import Notice from "../components/ui/Notice.tsx";
import PageHeader from "../components/ui/PageHeader.tsx";
import ScoreRing from "../components/ui/ScoreRing.tsx";
import Section from "../components/ui/Section.tsx";
import Stat from "../components/ui/Stat.tsx";
import { SkeletonCard, SkeletonRows } from "../components/ui/Skeleton.tsx";
import { CAMPAIGN_STATUS_TONE, GOAL_STATUS_TONE, REVIEW_STATUS_TONE } from "../components/status.ts";
import { useHub } from "../context/HubContext.tsx";
import { useAsync } from "../hooks/useAsync.ts";
import { listCompanyGoals, listCriteria, listCycleReviews, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listScoresForReviews } from "../services/gsr.ts";
import { listCompanyProfiles } from "../services/profiles.ts";
import { listRecentSops, listSops } from "../services/sops.ts";
import { listResources } from "../services/resources.ts";
import { listSnapshots } from "../services/financials.ts";
import { listCampaigns } from "../services/marketing.ts";
import { deriveSnapshot, periodLabel } from "../lib/financials.ts";
import { averageScore, computeReviewScore, hasScoredItem, scoreProfile } from "../lib/gsr/scoring.ts";
import { CADENCE_LABELS, activeCycles, cycleProgress, cyclePath, reviewPath, sectionOf, type HubSection } from "../lib/gsr/cycles.ts";
import { goalOutcome, goalSettled, stepsTaken } from "../lib/gsr/goals.ts";
import { latestScoredReview, previousCompletedReview, reviewHistory } from "../lib/gsr/history.ts";
import { displayName, formatDate, formatMoney, formatPercent, formatPeriod, pluralize } from "../lib/format.ts";
import { hasAccount } from "../lib/people.ts";
import {
  CAMPAIGN_STATUS_LABELS,
  GOAL_KIND_LABELS,
  GOAL_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SOP_CATEGORY_LABELS,
  type Profile,
  type Review,
  type ReviewCycle,
  type ReviewScore,
  type Sop,
} from "../types/database.ts";

function RecentSops({ sops }: { sops: Sop[] }) {
  if (sops.length === 0) {
    return <p className="text-sm text-ink-2">No SOPs yet.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {sops.map((sop) => (
        <li key={sop.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link to={`/sops/${sop.id}`} className="block truncate text-sm text-ink hover:text-accent">
              {sop.title}
            </Link>
            <p className="text-[12px] text-ink-3">
              {SOP_CATEGORY_LABELS[sop.category]} · v{sop.current_version} · {formatDate(sop.updated_at)}
            </p>
          </div>
          <ArrowRight size={14} className="shrink-0 text-ink-3" aria-hidden />
        </li>
      ))}
    </ul>
  );
}

// One live review cycle's progress: every active person, their score where the cycle is scored,
// and where their review stands. Scoped to the cycle by cycle_id, because a person has a review
// in every live cycle at once and matching on the person alone picks whichever came back first.
function CycleProgress({
  cycle,
  people,
  scored,
}: {
  cycle: ReviewCycle;
  people: Profile[];
  scored: Array<{ review: Review; score: number | null }>;
}) {
  const own = scored.filter((s) => s.review.cycle_id === cycle.id);
  // Counted over the roster the cycle covers, so a person with no review row yet reads as a
  // review still owed rather than vanishing from both halves of the fraction.
  const progress = cycleProgress(people, own.map((s) => s.review), cycle.id);
  // A monthly cycle is a Goal Setting Review and carries no scores, so it shows no score column.
  const showScore = cycle.cadence !== "monthly";
  return (
    <Section
      eyebrow={showScore ? CADENCE_LABELS[cycle.cadence] : `${CADENCE_LABELS[cycle.cadence]} · Goal Setting Review`}
      title={cycle.name}
      description={`${formatPeriod(cycle.period_start, cycle.period_end)} · ${progress.complete} of ${progress.total} complete`}
      actions={
        <Link to={cyclePath(cycle)}>
          <Button variant="secondary" size="sm">Open cycle</Button>
        </Link>
      }
    >
      {people.length === 0 ? (
        <p className="text-sm text-ink-2">Nobody on the roster yet. Add the team in People and their reviews appear here.</p>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((person) => {
            const entry = own.find((s) => s.review.employee_id === person.id);
            return (
              <li key={person.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{displayName(person)}</p>
                  <p className="truncate text-[12px] text-ink-3">{person.title ?? person.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {showScore ? <span className="tnum text-sm text-ink">{entry?.score ?? "-"}</span> : null}
                  <Badge tone={entry ? REVIEW_STATUS_TONE[entry.review.status] : "neutral"}>
                    {entry ? REVIEW_STATUS_LABELS[entry.review.status] : "Not started"}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function AdminDashboard() {
  const { company } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();

  const state = useAsync(async () => {
    const [people, cycles, pillars, companyGoals, recentSops, allSops, resources, snapshots, campaigns] = await Promise.all([
      listCompanyProfiles(companyId),
      listCycles(companyId),
      listPillars(companyId),
      listCompanyGoals(companyId, year),
      listRecentSops(companyId, 5),
      listSops(companyId),
      listResources(companyId),
      listSnapshots(companyId),
      listCampaigns(companyId),
    ]);
    // Every cycle that covers today, because a monthly Goal Setting Review runs inside a
    // quarterly scored review and both are live. Reading one of them is how a finished review
    // goes missing from this page.
    const live = activeCycles(cycles);
    let reviews: Review[] = [];
    let scores: ReviewScore[] = [];
    if (live.length > 0) {
      reviews = (await Promise.all(live.map((c) => listCycleReviews(c.id)))).flat();
      scores = await listScoresForReviews(reviews.map((r) => r.id));
    }
    return { people, cycles, live, pillars, reviews, scores, companyGoals, recentSops, allSops, resources, snapshots, campaigns };
  }, [companyId, year]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const { people, live, pillars, reviews, scores, companyGoals, recentSops, allSops, resources, snapshots, campaigns } = state.data;
  const activePeople = people.filter((p) => p.is_active);
  // Reviews cover the whole active roster. Someone set up but not invited yet is reviewed like
  // anyone else; the only difference is that they cannot open it until they sign in.
  const employees = activePeople;
  const notInvited = activePeople.filter((p) => !hasAccount(p)).length;
  const scored = reviews.map((r) => {
    const own = scores.filter((s) => s.review_id === r.id);
    return { review: r, score: r.status === "complete" && hasScoredItem(own) ? computeReviewScore(pillars, own).overall : null };
  });
  // Every live cycle owes a review for everybody active, so a tile adds the per-cycle fractions
  // and cannot report all clear while a cycle has no rows in it at all. GSRs and reviews are
  // counted apart: they are different sections, and "3 of 8 reviews" with five of them GSRs
  // would have said something false under the wrong word.
  const standingOf = (section: HubSection) =>
    live
      .filter((c) => sectionOf(c.cadence) === section)
      .reduce(
        (sum, c) => {
          const own = cycleProgress(activePeople, reviews, c.id);
          return { complete: sum.complete + own.complete, total: sum.total + own.total, cycles: [...sum.cycles, c.name] };
        },
        { complete: 0, total: 0, cycles: [] as string[] },
      );
  const gsrs = standingOf("gsr");
  const scoredCycles = standingOf("reviews");
  // A monthly cycle is a Goal Setting Review and carries no scores, so averaging it in would
  // drag the team score toward nothing. Only scored cycles count.
  const scoredCycleIds = new Set(live.filter((c) => c.cadence !== "monthly").map((c) => c.id));
  const teamAverage = averageScore(scored.filter((s) => scoredCycleIds.has(s.review.cycle_id)).map((s) => s.score));
  const published = allSops.filter((s) => s.status === "published").length;
  const goalsHit = companyGoals.filter((g) => g.is_hit).length;
  const latestMonth = snapshots.filter((s) => s.period_type === "month").sort((a, b) => b.period_start.localeCompare(a.period_start))[0] ?? snapshots[0] ?? null;
  const latestDerived = latestMonth ? deriveSnapshot(latestMonth) : null;
  const liveCampaigns = campaigns.filter((c) => c.status === "active" || c.status === "paused");
  // Spend against budget is only a share of anything when both sides cover the same campaigns.
  // Counting a campaign with no budget set as zero budget while counting its spend in full read
  // "$13,400 spent of $12,000 (112%)": over budget against a total that left one campaign out.
  const budgeted = liveCampaigns.filter((c) => c.budget !== null);
  const unbudgeted = liveCampaigns.length - budgeted.length;
  const liveBudget = budgeted.reduce((sum, c) => sum + (c.budget ?? 0), 0);
  const liveSpend = budgeted.reduce((sum, c) => sum + (c.actual_spend ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Dashboard"
        description={`Everything that matters for the ${formatDate(new Date().toISOString(), "long")} meeting, in one place.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="People" value={activePeople.length} hint={notInvited > 0 ? `${notInvited} not signed in yet` : pluralize(activePeople.filter((p) => p.role === "admin").length, "admin")} />
        <Stat
          label="GSRs complete"
          value={gsrs.cycles.length > 0 ? `${gsrs.complete}/${gsrs.total}` : "-"}
          hint={gsrs.cycles.length > 0 ? gsrs.cycles.join(" · ") : "No month open"}
        />
        <Stat
          label="Reviews complete"
          value={scoredCycles.cycles.length > 0 ? `${scoredCycles.complete}/${scoredCycles.total}` : "-"}
          hint={scoredCycles.cycles.length > 0 ? scoredCycles.cycles.join(" · ") : "No review cycle open"}
        />
        <Stat
          label="Team score"
          value={teamAverage ?? "-"}
          hint={
            live.length === 0
              ? "Open a cycle to start scoring"
              : scoredCycleIds.size === 0
                ? "Monthly cycles are not scored"
                : "Average of scored reviews"
          }
        />
        <Stat label="Library" value={published} hint={`${pluralize(published, "published SOP")} · ${pluralize(resources.length, "resource")}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {live.length === 0 ? (
            <Section
              eyebrow="Goal Setting and Review"
              title="Review cycles"
              actions={
                <Link to="/gsr">
                  <Button size="sm">Start a cycle</Button>
                </Link>
              }
            >
              <p className="text-sm text-ink-2">
                No review cycle is open. Start one to create a review for every person and track the team's scores.
              </p>
            </Section>
          ) : (
            live.map((c) => <CycleProgress key={c.id} cycle={c} people={employees} scored={scored} />)
          )}

          <Section
            eyebrow={String(year)}
            title="Company goals"
            description={companyGoals.length > 0 ? `${goalsHit} of ${companyGoals.length} hit` : undefined}
            actions={
              <Link to="/reviews/company-goals">
                <Button variant="secondary" size="sm">Manage</Button>
              </Link>
            }
          >
            {companyGoals.length === 0 ? (
              <p className="text-sm text-ink-2">No company goals set for {year}. Add the handful of numbers leadership tracks.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {companyGoals.map((goal) => (
                  <li key={goal.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{goal.name}</p>
                      <p className="tnum text-[12px] text-ink-2">
                        {goal.current_display || "-"} / {goal.target_display || "-"}
                      </p>
                    </div>
                    <Badge tone={goal.is_hit ? "success" : "neutral"}>{goal.is_hit ? "Hit" : "In progress"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section
            eyebrow="Financials"
            title={latestMonth ? periodLabel(latestMonth.period_type, latestMonth.period_start) : "No snapshots yet"}
            actions={
              <Link to="/financials">
                <Button variant="ghost" size="sm">Open</Button>
              </Link>
            }
          >
            {latestMonth && latestDerived ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-label text-ink-3">Revenue</dt>
                  <dd className="tnum mt-0.5 text-lg font-medium text-heading">{formatMoney(latestMonth.revenue)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-label text-ink-3">Net profit</dt>
                  <dd className={`tnum mt-0.5 text-lg font-medium ${latestDerived.net >= 0 ? "text-success" : "text-danger"}`}>{formatMoney(latestDerived.net)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-label text-ink-3">Gross margin</dt>
                  <dd className="tnum mt-0.5 text-ink">{formatPercent(latestDerived.grossMargin, 1)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-label text-ink-3">Net margin</dt>
                  <dd className="tnum mt-0.5 text-ink">{formatPercent(latestDerived.netMargin, 1)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-2">Enter a period or import a CSV to see revenue, margins, and net here.</p>
            )}
          </Section>
          <Section
            eyebrow="Marketing"
            title={pluralize(liveCampaigns.length, "live campaign")}
            actions={
              <Link to="/marketing">
                <Button variant="ghost" size="sm">Board</Button>
              </Link>
            }
          >
            {campaigns.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing on the board yet.</p>
            ) : (
              <>
                <p className="tnum text-sm text-ink">
                  {formatMoney(liveSpend)} spent of {formatMoney(liveBudget)}
                  {liveBudget > 0 ? ` (${formatPercent(liveSpend / liveBudget)})` : ""}
                </p>
                {unbudgeted > 0 ? (
                  <p className="mt-1 text-[12px] text-ink-3">
                    {pluralize(unbudgeted, "live campaign")} with no budget set, left out of the total.
                  </p>
                ) : null}
                <ul className="mt-3 space-y-1.5">
                  {liveCampaigns.slice(0, 4).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-ink">{c.name}</span>
                      <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
          <Section
            eyebrow="SOP library"
            title="Recently updated"
            actions={
              <Link to="/sops">
                <Button variant="ghost" size="sm">All SOPs</Button>
              </Link>
            }
          >
            <RecentSops sops={recentSops} />
          </Section>
          <Section
            eyebrow="Resources"
            title={pluralize(resources.length, "resource")}
            actions={
              <Link to="/resources">
                <Button variant="ghost" size="sm">Browse</Button>
              </Link>
            }
          >
            <p className="text-sm text-ink-2">
              {resources.length === 0
                ? "Links, templates, and files the team reaches for. Add the first one."
                : `Most recent: ${resources[0]?.title ?? ""}`}
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}

function EmployeeDashboard() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();

  const state = useAsync(async () => {
    const [reviews, pillars, criteria, impact, goals, recentSops, cycles, companyGoals] = await Promise.all([
      listEmployeeReviews(profile.id),
      listPillars(companyId),
      listCriteria(companyId),
      listImpactScores(companyId, profile.id),
      listGoals(companyId, profile.id),
      listRecentSops(companyId, 5),
      listCycles(companyId),
      listCompanyGoals(companyId, year),
    ]);
    // Latest by the period the review covers, the same rule My GSR and the person page use.
    // The service orders by row creation time, which puts a review started out of order first.
    //
    // Scores are fetched for every review, not for the newest one, because the newest review is
    // a monthly Goal Setting Review that carries none: asking for that one row's scores meant
    // the card could only ever show an empty ring while a rated quarterly review sat behind it.
    const scores = await listScoresForReviews(reviews.map((r) => r.id));
    // Scored reviews only: a monthly GSR is not a review and, with leftover scores, would
    // otherwise be featured over the quarter it sits inside. The GSR gets a block of its own.
    const history = reviewHistory(reviews, cycles, pillars, scores).filter((r) => r.cycle?.cadence !== "monthly");
    const featured = latestScoredReview(history) ?? history[0] ?? null;
    // The impact score is the person's current ratings, measured against the last signed-off
    // review; the current GSR is this month's Goal Setting Review, if the manager has opened it.
    const baseline = previousCompletedReview(history);
    const baselineScores = baseline ? scores.filter((s) => s.review_id === baseline.review.id) : [];
    const gsrCycle = activeCycles(cycles).find((c) => sectionOf(c.cadence) === "gsr") ?? null;
    const gsrReview = gsrCycle ? (reviews.find((r) => r.cycle_id === gsrCycle.id) ?? null) : null;
    return { featured, pillars, criteria, impact, baseline, baselineScores, gsrCycle, gsrReview, goals, recentSops, cycles, companyGoals };
  }, [companyId, profile.id, year]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { featured, pillars, criteria, impact, baseline, baselineScores, gsrCycle, gsrReview, goals, recentSops, cycles, companyGoals } = state.data;
  const cycle = featured?.cycle ?? null;
  const result = featured?.result ?? null;
  // A goal is open until it is hit, or until its period settles and it reads as a miss.
  // Nothing ever writes the 'missed' status, so counting on status alone kept every unfinished
  // goal from every closed cycle on this list for good. goalSettled knows both shapes of
  // period, cycle and year, so this list and My Goals cannot reach opposite verdicts. The
  // Goals block is the year's goals; the month's live in the GSR block.
  const openGoals = goals.filter((goal) => goal.scope === "year" && goalOutcome(goal, goalSettled(goal, cycles)) === "open");
  const monthGoals = gsrCycle ? goals.filter((g) => g.scope === "cycle" && g.cycle_id === gsrCycle.id).sort((a, b) => (a.kind === "focus" ? -1 : b.kind === "focus" ? 1 : 0)) : [];
  const profileScore = scoreProfile(pillars, criteria, impact);
  const rated = impact.length > 0;
  const ratingPillars = pillars.filter((p) => p.scoring_type === "rating" && p.is_active);
  // Up or down since the last signed-off review, per criterion, the way a season's ratings move.
  const moves = criteria
    .filter((c) => c.is_active)
    .map((c) => {
      const now = impact.find((i) => i.criterion_id === c.id)?.rating ?? null;
      const was = baselineScores.find((s) => s.criterion_id === c.id)?.rating ?? null;
      return { criterion: c, delta: now !== null && was !== null ? now - was : null };
    })
    .filter((m) => m.delta !== null && m.delta !== 0)
    .sort((a, b) => (b.delta as number) - (a.delta as number));

  return (
    <>
      <PageHeader eyebrow={company!.name} title={`Welcome back, ${displayName(profile).split(" ")[0]}`} description="Your scores, your goals, and what changed." />

      <div className="grid gap-6 lg:grid-cols-3">
        {ratingPillars.length > 0 ? (
          <Section
            eyebrow="Impact score"
            title={rated ? String(profileScore.overall) : "Not rated yet"}
            description={baseline ? `Against ${baseline.cycle?.name ?? "your last review"}` : "Set by your manager and trued up before each review."}
            className="lg:col-span-1"
          >
            {rated ? (
              <div className="space-y-3">
                <ul className="space-y-1.5 text-sm">
                  {profileScore.pillars.map((p) => (
                    <li key={p.pillarId} className="flex justify-between gap-3">
                      <span className="text-ink-2">{p.name}</span>
                      <span className="tnum text-ink">{p.score === null ? "-" : Math.round(p.score)}</span>
                    </li>
                  ))}
                </ul>
                {moves.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5 text-[12px]">
                    {moves.slice(0, 4).map((m) => (
                      <li key={m.criterion.id} className={`rounded-full border px-2 py-0.5 ${(m.delta as number) > 0 ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"} text-ink`}>
                        {m.criterion.name} {(m.delta as number) > 0 ? `+${m.delta}` : m.delta}
                      </li>
                    ))}
                  </ul>
                ) : baseline ? (
                  <p className="text-[12px] text-ink-3">No change since {baseline.cycle?.name ?? "your last review"}.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-2">Your manager sets your ratings on your profile. They show here, with how they move review to review.</p>
            )}
          </Section>
        ) : null}

        <Section
          eyebrow="Goal Setting Review"
          title={gsrCycle ? gsrCycle.name : "No month open"}
          className={ratingPillars.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}
          actions={
            gsrReview ? (
              <Link to="/my/gsr">
                <Button variant="secondary" size="sm">Open my GSR</Button>
              </Link>
            ) : undefined
          }
        >
          {!gsrCycle ? (
            <p className="text-sm text-ink-2">Your manager opens each month's GSR. This month's goals appear here the moment they do.</p>
          ) : !gsrReview ? (
            <p className="text-sm text-ink-2">Your GSR for {gsrCycle.name} is not started yet. Once your manager opens it, this month's goals are here.</p>
          ) : monthGoals.length === 0 ? (
            <p className="text-sm text-ink-2">No goals set for {gsrCycle.name} yet. They are set together in the meeting.</p>
          ) : (
            <ul className="divide-y divide-line">
              {monthGoals.map((goal) => {
                const steps = stepsTaken(goal);
                return (
                  <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{goal.title}</p>
                      <p className="text-[12px] text-ink-3">
                        {goal.kind === "focus" ? "Focus topic" : GOAL_KIND_LABELS[goal.kind]}
                        {steps.total > 0 ? ` · ${steps.done}/${steps.total} steps done` : ""}
                      </p>
                    </div>
                    <span className="tnum w-12 text-right text-sm text-ink">{goal.progress}%</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          eyebrow={result ? "Latest scored review" : "Latest review"}
          title={cycle?.name ?? "No review yet"}
          className="lg:col-span-1"
        >
          {featured ? (
            <div className="flex items-center gap-5">
              <ScoreRing score={result?.overall ?? null} size={88} label="Overall" />
              <div className="min-w-0 text-sm">
                <Badge tone={REVIEW_STATUS_TONE[featured.review.status]}>{REVIEW_STATUS_LABELS[featured.review.status]}</Badge>
                <p className="mt-2 text-ink-2">{cycle ? formatPeriod(cycle.period_start, cycle.period_end) : ""}</p>
                <Link to={featured.cycle ? reviewPath(featured.review.id, featured.cycle.cadence) : "/my/reviews"} className="mt-2 inline-block text-accent hover:underline">
                  View review
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-2">Your first review appears here once your manager opens a cycle.</p>
          )}
        </Section>

        <Section
          eyebrow="Goals"
          title={pluralize(openGoals.length, "open goal")}
          className="lg:col-span-2"
          actions={
            <Link to="/my/goals">
              <Button variant="secondary" size="sm">Manage goals</Button>
            </Link>
          }
        >
          {openGoals.length === 0 ? (
            <EmptyState eyebrow="Goals" title="Set your first goal" body="Professional, personal, or role goals with the action steps to get there." />
          ) : (
            <ul className="divide-y divide-line">
              {openGoals.slice(0, 6).map((goal) => {
                const steps = stepsTaken(goal);
                return (
                  <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{goal.title}</p>
                      <p className="text-[12px] text-ink-3">
                        {steps.total > 0 ? `${steps.done}/${steps.total} steps done` : "No action steps yet"}
                      </p>
                    </div>
                    <Badge tone={GOAL_STATUS_TONE[goal.status]}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {companyGoals.length > 0 ? (
          <Section eyebrow={`Company goals ${year}`} title="What the team is chasing" className="lg:col-span-3" padded={false}>
            <ul className="divide-y divide-line">
              {companyGoals.map((goal) => (
                <li key={goal.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{goal.name}</p>
                    <p className="tnum text-[12px] text-ink-3">
                      {goal.current_display || "-"}{goal.target_display ? ` of ${goal.target_display}` : ""}
                    </p>
                  </div>
                  <Badge tone={goal.is_hit ? "success" : "neutral"}>{goal.is_hit ? "Hit" : "In progress"}</Badge>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          eyebrow="SOP library"
          title="Recently updated"
          className="lg:col-span-3"
          actions={
            <Link to="/sops">
              <Button variant="ghost" size="sm">All SOPs</Button>
            </Link>
          }
        >
          <RecentSops sops={recentSops} />
        </Section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { company, isAdmin } = useHub();
  // A Rococo admin with no company active is on the portfolio; the router never lands here.
  if (!company) return null;
  return isAdmin ? <AdminDashboard /> : <EmployeeDashboard />;
}
