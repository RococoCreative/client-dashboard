// Home for an admin: what needs attention and the open cycles first, then the tiles, then company
// goals, the libraries and each module's card. For the people allowed to see the division split
// (an owner, Rococo, or someone given the view) in a company that has divisions, a Combined /
// per-division switch narrows the people tiles and the cycle cards to one division, and the compare
// strip sets each division next to the whole. Everyone else reads the combined picture, and none
// of those reads is made. The people are the ones the database shows the viewer, and a person in
// two divisions counts in each; an admin who sees only some divisions gets chips for those alone,
// and the company-wide tiles say they cover the people in your divisions. With no links yet, the
// links card gives way to one line at the end of the page.
import { useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import PageHeader from "../ui/PageHeader.tsx";
import Section from "../ui/Section.tsx";
import AttentionCard from "./AttentionCard.tsx";
import FreshnessCard from "./FreshnessCard.tsx";
import ShortcutsCard from "./ShortcutsCard.tsx";
import WinsCard from "./WinsCard.tsx";
import WhereWorkLivesCard from "./WhereWorkLivesCard.tsx";
import NoLinksLine from "./NoLinksLine.tsx";
import DivisionCompare from "../people/DivisionCompare.tsx";
import DivisionSwitch from "../people/DivisionSwitch.tsx";
import { COMBINED, divisionCompareRows, latestResultMonth, monthCycle, peopleInScope } from "../scorecards/compare.ts";
import { monthLabel } from "../scorecards/months.ts";
import Stat from "../ui/Stat.tsx";
import SkeletonCard from "../ui/SkeletonCard.tsx";
import { CAMPAIGN_STATUS_TONE } from "../status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCompanyGoals, listCycleOmissions, listCycleReviews, listCycles, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { listGsrsForLog } from "../../services/gsrOnDemand.ts";
import { windowRange } from "../../lib/gsr/onDemand.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listRecentSops, listSops } from "../../services/sops.ts";
import { listResources } from "../../services/resources.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listMetricEntries, listRoleMetrics } from "../../services/scorecards.ts";
import { monthOf } from "../../lib/scorecard.ts";
import { listSnapshots } from "../../services/financials.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { deriveSnapshot, periodLabel } from "../../lib/financials.ts";
import { liveCampaignTotals } from "../../lib/marketing.ts";
import { averageScore, computeReviewScore, hasScoredItem, pillarsForReview } from "../../lib/gsr/scoring.ts";
import { cycleOmitted, cycleProgress, cycleRoster, cyclesInPlay, sectionOf, type HubSection } from "../../lib/gsr/cycles.ts";
import { formatDate, formatMoney, formatPercent, pluralize } from "../../lib/format.ts";
import { canSeeDivisions, hasAccount, isCompanyAdminRole, isDivisionLimited, viewerDivisions } from "../../lib/people.ts";
import { hasModule } from "../../lib/modules.ts";
import { CAMPAIGN_STATUS_LABELS, type FinancialSnapshot, type Review, type ReviewScore } from "../../types/database.ts";
import CycleProgress from "./CycleProgress.tsx";
import RecentSops from "./RecentSops.tsx";
import YourFigures from "./YourFigures.tsx";
import { loadOwnModules, noLinks, useHomeLinks } from "./homeData.ts";

export default function AdminHome() {
  const { company, profile, isAdmin, isRococo, can } = useHub();
  const companyId = company!.id;
  const showManualFinancials = company!.manual_financials;
  const year = new Date().getFullYear();
  const links = useHomeLinks(company!);
  const onDemand = company!.gsr_mode === "on_demand";

  const state = useAsync(async () => {
    const [people, cycles, pillars, companyGoals, recentSops, allSops, resources, snapshots, campaigns, own, omissions] = await Promise.all([
      listCompanyProfiles(companyId),
      listCycles(companyId),
      listPillars(companyId),
      listCompanyGoals(companyId, year),
      listRecentSops(companyId, 5),
      listSops(companyId),
      listResources(companyId),
      showManualFinancials ? listSnapshots(companyId) : Promise.resolve([] as FinancialSnapshot[]),
      listCampaigns(companyId),
      loadOwnModules(companyId, profile, year),
      listCycleOmissions(companyId),
    ]);
    // Every cycle with reviews still owed: the ones covering today (a monthly Goal Setting Review
    // runs inside a quarterly scored review, so both are live) and any open cycle whose period
    // has ended but which nobody has closed yet. Reading fewer is how a finished review goes
    // missing from this page.
    const live = cyclesInPlay(cycles);
    let reviews: Review[] = [];
    let scores: ReviewScore[] = [];
    if (live.length > 0) {
      reviews = (await Promise.all(live.map((c) => listCycleReviews(c.id)))).flat();
      scores = await listScoresForReviews(reviews.map((r) => r.id));
    }
    return { people, cycles, live, pillars, reviews, scores, companyGoals, recentSops, allSops, resources, snapshots, campaigns, omissions, ...own };
  }, [companyId, showManualFinancials, profile.id, profile.job_role_id, year]);

  // The division split, read only for someone allowed to see it, and only past the divisions
  // themselves when the company has some. Null means the combined picture alone.
  const allowed = canSeeDivisions(profile);
  const limited = isDivisionLimited(profile);
  const combinedLabel = limited ? "In your divisions" : "Combined";
  // Which divisions the viewer may see, as a key, so new access reloads the split.
  const viewKey = profile.view_all_divisions ? "all" : profile.view_division_ids.join(",");
  const [scope, setScope] = useState(COMBINED);
  const split = useAsync(async () => {
    if (!allowed) return null;
    const divisions = viewerDivisions(profile, await listDivisions(companyId));
    if (divisions.length === 0) return null;
    const today = monthOf(new Date());
    const [metrics, entries, cycles] = await Promise.all([
      listRoleMetrics(companyId, true),
      listMetricEntries(companyId, { year: Number(today.slice(0, 4)) }),
      listCycles(companyId),
    ]);
    const month = latestResultMonth(entries, today);
    const cycle = monthCycle(cycles, month);
    const monthReviews = cycle ? await listCycleReviews(cycle.id) : [];
    // A company whose GSRs are on demand: the GSRs done in the strip's month, which it counts instead.
    const range = windowRange("month", month);
    const monthGsrs = onDemand ? { rows: await listGsrsForLog(companyId, range), range } : undefined;
    return { divisions, metrics, entries, month, cycle, monthReviews, monthGsrs };
  }, [companyId, allowed, viewKey, onDemand]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const { people: everyone, live, pillars, reviews, scores, companyGoals, recentSops, allSops, resources, snapshots, campaigns, omissions, jobRole, financials } = state.data;
  // The people every tile and cycle card below counts: the whole company, or one division.
  const splitData = split.data;
  const activeScope = splitData && (scope === COMBINED || splitData.divisions.some((d) => d.id === scope)) ? scope : COMBINED;
  const people = peopleInScope(everyone, activeScope);
  const compare = splitData
    ? divisionCompareRows({ people: everyone, divisions: splitData.divisions, metrics: splitData.metrics, entries: splitData.entries, month: splitData.month, cycle: splitData.cycle, reviews: splitData.monthReviews, omissions, combinedLabel, ...(splitData.monthGsrs ? { gsrs: splitData.monthGsrs } : {}) })
    : [];
  const activePeople = people.filter((p) => p.is_active);
  // Reviews cover the whole active roster. Someone set up but not invited yet is reviewed like
  // anyone else; the only difference is that they cannot open it until they sign in.
  const notInvited = activePeople.filter((p) => !hasAccount(p)).length;
  const scored = reviews.map((r) => {
    const own = scores.filter((s) => s.review_id === r.id);
    return { review: r, score: r.status === "complete" && hasScoredItem(own) ? computeReviewScore(pillarsForReview(r, pillars), own).overall : null };
  });
  // Who each live cycle covers (cycleRoster: everybody active, plus anyone deactivated since whose
  // review in it was signed off, less anyone omitted from it), read once and used by the tiles,
  // the team score and the cycle cards alike.
  const rosters = new Map(live.map((c) => [c.id, cycleRoster(people, reviews, c.id, omissions)]));
  const rosterOf = (cycleId: string) => rosters.get(cycleId) ?? [];
  // Every live cycle owes a review for everybody in it, so a tile adds the per-cycle fractions
  // and cannot report all clear while a cycle has no rows in it at all. GSRs and reviews are
  // counted apart: they are different sections, and "3 of 8 reviews" with five of them GSRs
  // would have said something false under the wrong word.
  const standingOf = (section: HubSection) =>
    live
      .filter((c) => sectionOf(c.cadence) === section)
      .reduce(
        (sum, c) => {
          const own = cycleProgress(rosterOf(c.id), reviews, c.id);
          return { complete: sum.complete + own.complete, total: sum.total + own.total, cycles: [...sum.cycles, c.name] };
        },
        { complete: 0, total: 0, cycles: [] as string[] },
      );
  const gsrs = standingOf("gsr");
  const scoredCycles = standingOf("reviews");
  // A monthly cycle is a Goal Setting Review and carries no scores, so averaging it in would
  // drag the team score toward nothing. Only scored cycles count, and only the people each covers.
  const scoredCycleIds = new Set(live.filter((c) => c.cadence !== "monthly").map((c) => c.id));
  const teamAverage = averageScore(
    scored
      .filter((s) => scoredCycleIds.has(s.review.cycle_id) && rosterOf(s.review.cycle_id).some((p) => p.id === s.review.employee_id))
      .map((s) => s.score),
  );
  const published = allSops.filter((s) => s.status === "published").length;
  const goalsHit = companyGoals.filter((g) => g.is_hit).length;
  const latestMonth = snapshots.filter((s) => s.period_type === "month").sort((a, b) => b.period_start.localeCompare(a.period_start))[0] ?? snapshots[0] ?? null;
  const latestDerived = latestMonth ? deriveSnapshot(latestMonth) : null;
  // Budget and spend over the same live campaigns, with the unbudgeted counted apart, read the
  // way the Marketing board and the Rococo portfolio read them.
  const { live: liveCampaigns, unbudgeted, budget: liveBudget, spend: liveSpend } = liveCampaignTotals(campaigns);

  // Without the switchboard there is no attention card, so the open cycles lead the page.
  const cycleCards =
    live.length === 0 ? (
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
      <div className={`grid grid-cols-1 gap-6 ${live.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {live.map((c) => (
          <CycleProgress
            key={c.id}
            cycle={c}
            people={rosterOf(c.id)}
            omittedCount={cycleOmitted(people, reviews, c.id, omissions).length}
            scored={scored}
          />
        ))}
      </div>
    );

  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Home"
        description={`Everything that matters for the ${formatDate(new Date().toISOString(), "long")} meeting, in one place.`}
        actions={splitData ? <DivisionSwitch divisions={splitData.divisions} value={activeScope} onChange={setScope} combinedLabel={combinedLabel} /> : undefined}
      />
      {split.error && !split.data ? <Notice tone="warning" className="mb-4">The division split did not load, so this is the combined picture. {split.error}</Notice> : null}

      {/* What needs an admin first: the attention card (under the switchboard module; without it,
          none of its calls is made) and every open cycle, then the tiles, then the rest. */}
      <div className="space-y-6">
        {hasModule(company, "switchboard") ? <AttentionCard company={company!} /> : null}
        {cycleCards}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label={limited ? "People in your divisions" : "People"} value={activePeople.length} hint={notInvited > 0 ? `${notInvited} not signed in yet` : pluralize(activePeople.filter((p) => isCompanyAdminRole(p.role)).length, "admin")} />
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
                : limited
                  ? "Average of scored reviews in your divisions"
                  : "Average of scored reviews"
          }
        />
        <Stat label="Resources" value={published} hint={`${pluralize(published, "published SOP")} · ${pluralize(resources.length, "file")}`} />
      </div>

      {splitData ? (
        <div className="mt-4">
          <DivisionCompare rows={compare} monthLabel={monthLabel(splitData.month)} active={activeScope} />
        </div>
      ) : null}

      {/* The rest, in the order it has always read. The Home cards each sit under their own module;
          with none of the modules on, none mounts and none of their calls is made. The two columns
          stack below lg, left over right, so the order a keyboard moves in is the order on screen at
          every width. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {hasModule(company, "external_links") ? <WhereWorkLivesCard links={links.data} error={links.error} isAdmin /> : null}

          <Section
            eyebrow={String(year)}
            title="Company goals"
            description={companyGoals.length > 0 ? `${goalsHit} of ${companyGoals.length} hit` : undefined}
            actions={
              <Link to="/goals/company">
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

          {jobRole?.dashboard_modules.includes("financials") ? <YourFigures jobRole={jobRole} financials={financials} year={year} /> : null}
          {/* The two libraries sit side by side under Company goals so the left column ends near the
              right one. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section
              eyebrow="SOP library"
              title="Recently updated"
              actions={
                <Link to="/resources/sops">
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
                <Link to="/resources/files">
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

        <div className="space-y-6">
          {hasModule(company, "switchboard") ? <ShortcutsCard company={company!} isAdmin={isAdmin} isRococo={isRococo} can={can} /> : null}
          {hasModule(company, "wins") ? <WinsCard company={company!} /> : null}
          {hasModule(company, "switchboard") && hasModule(company, "data_sources") ? <FreshnessCard companyId={companyId} companyTimeZone={company!.time_zone} canViewProduction={can("production_view")} /> : null}
          {showManualFinancials ? (
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
          ) : null}
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
        </div>
      </div>

      {noLinks(company!, links.data) ? <NoLinksLine isAdmin /> : null}
    </>
  );
}
