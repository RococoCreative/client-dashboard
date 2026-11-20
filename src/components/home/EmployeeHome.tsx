// Home for an employee or a manager: their own GSR first, with the page's one primary button, then
// (for a manager) their direct reports (TeamBlock), then their own open tasks, their goals, scores,
// figures and scorecard, and what changed in the SOP library. With no links yet, the links card
// gives way to one line at the end of the page.
//
// In a company whose GSRs are on demand (companies.gsr_mode, 0047) there are no months: the GSR card
// is GsrCardOnDemand, the team block TeamBlockOnDemand, and the line under the impact score reads the
// GSRs done inside the open scored review (GsrPeriodLine). A company on periods reads exactly what it
// always has.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import PageHeader from "../ui/PageHeader.tsx";
import ScoreRing from "../ui/ScoreRing.tsx";
import Section from "../ui/Section.tsx";
import GsrQuarterLine from "../gsr/GsrQuarterLine.tsx";
import GsrPeriodLine from "../gsr/onDemand/GsrPeriodLine.tsx";
import GsrCardOnDemand from "./GsrCardOnDemand.tsx";
import TeamBlockOnDemand from "./TeamBlockOnDemand.tsx";
import ShortcutsCard from "./ShortcutsCard.tsx";
import WinsCard from "./WinsCard.tsx";
import WhereWorkLivesCard from "./WhereWorkLivesCard.tsx";
import NoLinksLine from "./NoLinksLine.tsx";
import TeamBlock from "./TeamBlock.tsx";
import PersonTasks from "../tasks/PersonTasks.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { GOAL_STATUS_TONE, REVIEW_STATUS_TONE } from "../status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCompanyGoals, listCriteria, listCycleOmissions, listCycles, listEmployeeReviews, listGoals, listImpactScores, listPillars, listScoresForReviews } from "../../services/gsr.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listRecentSops } from "../../services/sops.ts";
import { scoreProfile } from "../../lib/gsr/scoring.ts";
import { gsrCycleInPlay, omittedCycleIdsFor, reviewPath, scoredCycleInPlay } from "../../lib/gsr/cycles.ts";
import { goalOutcome, goalPeriodLabel, goalSettled, rankGoals, scoreGsrMonths, stepsTaken } from "../../lib/gsr/goals.ts";
import { latestScoredReview, previousCompletedReview, reviewHistory } from "../../lib/gsr/history.ts";
import { displayName, formatPeriod, pluralize } from "../../lib/format.ts";
import { directReports } from "../../lib/people.ts";
import { hasModule } from "../../lib/modules.ts";
import { GOAL_KIND_LABELS, GOAL_STATUS_LABELS, REVIEW_STATUS_LABELS, type Profile } from "../../types/database.ts";
import MyScorecard from "./MyScorecard.tsx";
import RecentSops from "./RecentSops.tsx";
import YourFigures from "./YourFigures.tsx";
import { loadOwnModules, noLinks, useHomeLinks } from "./homeData.ts";

export default function EmployeeHome() {
  const { company, profile, isAdmin, isRococo, isLead, can } = useHub();
  const companyId = company!.id;
  const year = new Date().getFullYear();
  const links = useHomeLinks(company!);
  // A manager gets their team under their own GSR. Admins never reach this dashboard.
  const lead = isLead && !isAdmin;
  const onDemand = company!.gsr_mode === "on_demand";

  const state = useAsync(async () => {
    const [reviews, pillars, criteria, impact, goals, recentSops, cycles, companyGoals, own, omissions, people] = await Promise.all([
      listEmployeeReviews(companyId, profile.id),
      listPillars(companyId),
      listCriteria(companyId),
      listImpactScores(companyId, profile.id),
      listGoals(companyId, profile.id),
      listRecentSops(companyId, 5),
      listCycles(companyId),
      listCompanyGoals(companyId, year),
      // The person's job role decides which optional blocks this dashboard carries. The role is
      // a row the company set up, so a new module is a new entry in its list, never a branch on
      // who the company is.
      loadOwnModules(companyId, profile, year),
      // Only the person's own rows come back (0034): the cycles they are omitted from.
      listCycleOmissions(companyId),
      // The people a manager may see, for their team block; the database has already narrowed it.
      lead ? listCompanyProfiles(companyId) : Promise.resolve([] as Profile[]),
    ]);
    const { jobRole, financials } = own;
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
    // The month covering today, else the latest one still open after its period ended: a quarter
    // covering today must not hide a GSR the person still has to finish (the same month My GSR opens).
    const gsrCycle = gsrCycleInPlay(cycles);
    const gsrReview = gsrCycle ? (reviews.find((r) => r.cycle_id === gsrCycle.id) ?? null) : null;
    const omitted = omittedCycleIdsFor(omissions, reviews, profile.id);
    return { reviews, featured, pillars, criteria, impact, baseline, baselineScores, gsrCycle, gsrReview, goals, recentSops, cycles, companyGoals, jobRole, financials, omittedCycleIds: omitted, omissions, people };
  }, [companyId, profile.id, profile.job_role_id, year, lead]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={6} />;

  const { reviews, featured, pillars, criteria, impact, baseline, baselineScores, gsrCycle, gsrReview, goals, recentSops, cycles, companyGoals, jobRole, financials, omittedCycleIds, omissions, people } = state.data;
  // An admin omitted this person from this month's GSR: nothing to start, and it says so.
  const gsrOmitted = gsrCycle ? omittedCycleIds.includes(gsrCycle.id) : false;
  const showFinancials = jobRole?.dashboard_modules.includes("financials") ?? false;
  const cycle = featured?.cycle ?? null;
  const result = featured?.result ?? null;
  // A goal is open until it is hit, or until its period settles and it reads as a miss.
  // Nothing ever writes the 'missed' status, so counting on status alone kept every unfinished
  // goal from every closed cycle on this list for good. goalSettled knows both shapes of
  // period, cycle and year, so this list and My Goals cannot reach opposite verdicts. The
  // Goals block is the year's goals and the BHAG; the month's live in the GSR block, read role
  // first and personal last, the way the GSR reads them.
  const openGoals = goals.filter((goal) => goal.scope !== "cycle" && goalOutcome(goal, goalSettled(goal, cycles)) === "open");
  const monthGoals = gsrCycle ? rankGoals(goals.filter((g) => g.scope === "cycle" && g.cycle_id === gsrCycle.id)) : [];
  const profileScore = scoreProfile(pillars, criteria, impact);
  const rated = impact.length > 0;
  // For a company that scores its GSRs: where this quarter's locked-in months stand. The impact
  // score above it stays the ratings, as it always has; the months reach the score of record at
  // sign-off, and only once an admin has locked each one in. The quarter is found among scored
  // cycles first, so a month covering today never hides one that is over but still open.
  const gsrPillar = pillars.find((p) => p.scoring_type === "gsr_goals" && p.is_active) ?? null;
  const scoredCycle = scoredCycleInPlay(cycles);
  const gsrQuarter = gsrPillar && scoredCycle ? scoreGsrMonths(scoredCycle, cycles, goals, reviews, gsrPillar.required_goals, omittedCycleIds) : null;
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

      {/* Read in the order the person needs it: their own GSR first, with the one primary button
          on the page, then (for a manager) their team, then their goals, scores and the rest. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {onDemand ? (
          <GsrCardOnDemand person={profile} className="lg:col-span-3" />
        ) : (
          <Section
            eyebrow="Goal Setting Review"
            title={gsrCycle ? gsrCycle.name : "No month open"}
            className="lg:col-span-3"
            actions={
              gsrCycle && !gsrOmitted ? (
                <Link to="/my/gsr">
                  <Button size="sm">{gsrReview ? "Open my GSR" : "Start my GSR"}</Button>
                </Link>
              ) : undefined
            }
          >
            {!gsrCycle ? (
              <p className="text-sm text-ink-2">Your manager opens each month's GSR. This month's goals appear here the moment they do.</p>
            ) : gsrOmitted ? (
              <p className="text-sm text-ink-2">You're not part of the {gsrCycle.name} GSRs. Nothing is needed from you this month.</p>
            ) : !gsrReview ? (
              <p className="text-sm text-ink-2">Your GSR for {gsrCycle.name} is not started yet. Start it to fill in your goals before the meeting.</p>
            ) : monthGoals.length === 0 ? (
              <p className="text-sm text-ink-2">No goals set for {gsrCycle.name} yet. Add yours on the GSR tab before the meeting.</p>
            ) : (
              <ul className="divide-y divide-line">
                {monthGoals.map((goal) => {
                  const steps = stepsTaken(goal);
                  return (
                    <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{goal.title}</p>
                        <p className="text-[12px] text-ink-3">
                          {goal.is_focus ? "Focus topic GSR · " : ""}
                          {GOAL_KIND_LABELS[goal.kind]}
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
        )}

        {lead ? (
          onDemand ? (
            <TeamBlockOnDemand reports={directReports(profile, people).sort((a, b) => displayName(a).localeCompare(displayName(b)))} className="lg:col-span-3" />
          ) : (
            <TeamBlock companyId={companyId} viewer={profile} people={people} cycles={cycles} omissions={omissions} className="lg:col-span-3" />
          )
        ) : null}

        {/* Their own next few open tasks, the ones Tasks lists as theirs, when the company runs tasks.
            No add control here: the GSR button stays the page's one primary action. */}
        {hasModule(company, "tasks") ? (
          <div className="lg:col-span-3">
            <PersonTasks companyId={companyId} person={profile} self limit={5} moreHref="/tasks" backTo="/" backLabel="Home" />
          </div>
        ) : null}

        {/* The links, wins and shortcuts cards, each under its own module, where they have always sat
            in the order. An empty links list is one line at the end of the page instead. */}
        {(hasModule(company, "external_links") && !noLinks(company!, links.data)) || hasModule(company, "wins") || hasModule(company, "switchboard") ? (
          <div className="grid grid-cols-1 gap-6 lg:col-span-3 lg:grid-cols-2">
            {hasModule(company, "external_links") ? <WhereWorkLivesCard links={links.data} error={links.error} isAdmin={false} /> : null}
            {hasModule(company, "wins") ? <WinsCard company={company!} /> : null}
            {hasModule(company, "switchboard") ? <ShortcutsCard company={company!} isAdmin={isAdmin} isRococo={isRococo} can={can} /> : null}
          </div>
        ) : null}

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
            <p className="text-sm text-ink-2">No goals yet. Add one for this year or next, or a BHAG.</p>
          ) : (
            <ul className="divide-y divide-line">
              {/* A yearly goal's steps sit in its private half, so the line reads the period and
                  the completion, which is what the goal is measured by. */}
              {openGoals.slice(0, 6).map((goal) => (
                <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{goal.title}</p>
                    <p className="tnum text-[12px] text-ink-3">{goalPeriodLabel(goal)} · {goal.progress}% complete</p>
                  </div>
                  <Badge tone={GOAL_STATUS_TONE[goal.status]}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-6">
          {ratingPillars.length > 0 ? (
            <Section
              eyebrow="Impact score"
              title={rated ? String(profileScore.overall) : "Not rated yet"}
              description={baseline ? `Against ${baseline.cycle?.name ?? "your last review"}` : "Set by your manager and trued up before each review."}
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
              {onDemand ? (
                gsrPillar && scoredCycle ? <GsrPeriodLine companyId={companyId} personId={profile.id} cycle={scoredCycle} /> : null
              ) : gsrQuarter && scoredCycle ? (
                <GsrQuarterLine cycle={scoredCycle} figure={gsrQuarter} />
              ) : null}
            </Section>
          ) : null}

          <Section
            eyebrow={result ? "Latest scored review" : "Latest review"}
            title={cycle?.name ?? "No review yet"}
          >
            {featured ? (
              <div className="flex items-center gap-5">
                <ScoreRing score={result?.overall ?? null} size={88} label="Overall" />
                <div className="min-w-0 text-sm">
                  <Badge tone={REVIEW_STATUS_TONE[featured.review.status]}>{REVIEW_STATUS_LABELS[featured.review.status]}</Badge>
                  <p className="mt-2 text-ink-2">{cycle ? formatPeriod(cycle.period_start, cycle.period_end) : ""}</p>
                  <Link to={featured.cycle ? reviewPath(featured.review.id, featured.cycle.cadence) : "/my/reviews"} className={`mt-2 inline-block text-link hover:underline ${tapTargetClass}`}>
                    View review
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-2">Your first review appears here once your manager opens a cycle.</p>
            )}
          </Section>
        </div>

        {showFinancials && jobRole ? <YourFigures jobRole={jobRole} financials={financials} year={year} className="lg:col-span-3" /> : null}

        {jobRole ? <MyScorecard companyId={companyId} employeeId={profile.id} jobRole={jobRole} /> : null}

        {companyGoals.length > 0 ? (
          <Section eyebrow={`Company goals ${year}`} title="What the team is chasing" className="lg:col-span-3" padded={false}>
            <ul className="divide-y divide-line">
              {companyGoals.map((goal) => (
                <li key={goal.id} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
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
            <Link to="/resources/sops">
              <Button variant="ghost" size="sm">All SOPs</Button>
            </Link>
          }
        >
          <RecentSops sops={recentSops} />
        </Section>
      </div>

      {noLinks(company!, links.data) ? <NoLinksLine isAdmin={false} /> : null}
    </>
  );
}
