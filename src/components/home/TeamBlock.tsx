// A manager's team on Home, right under their own GSR: one row per direct report, with where their
// current GSR stands and, when the company runs tasks, how many tasks they have open and how many
// are overdue. Built from the people the page already holds, which the database has narrowed to what
// the viewer may see, so it never names anyone the viewer may not open. A person who has not signed
// in yet is listed like anyone else, marked as such: everything attaches to the person, not an
// account. Status comes from the review rows alone; nothing here computes a score. Each report's
// period is their own, at their rhythm (0046): gsrCycleInPlayFor picks it, the same call their My GSR,
// their Home and their person page make, so a weekly report reads their week and never the month.
// Who a period covers is cycleRoster's call, the roster every count of a cycle reads, so a report
// an admin left out of it reads "Not in this cycle" and never "Not started". A report whose period
// nobody has opened yet reads "Not started": the period opens itself when the GSR is started.
// The row has no control but the name, so on a phone the name's link stretches over its whole row.
import { Link } from "react-router-dom";
import Avatar from "../ui/Avatar.tsx";
import Badge from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapStretchClass } from "../ui/tap.ts";
import { itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import { REVIEW_STATUS_TONE } from "../status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { cycleRoster, gsrCycleInPlayFor, gsrPeriodFor, omittedCycleIdsFor, rhythmOf, runsGsrs } from "../../lib/gsr/cycles.ts";
import { displayName, todayIso } from "../../lib/format.ts";
import { hasModule } from "../../lib/modules.ts";
import { hasAccount, ledBy } from "../../lib/people.ts";
import { isOverdue } from "../../lib/tasks.ts";
import { listCycleReviews } from "../../services/gsr.ts";
import { listTasks } from "../../services/tasks.ts";
import { REVIEW_STATUS_LABELS, ROLE_LABELS, type CycleOmission, type Profile, type Review, type ReviewCycle, type TaskWithSteps } from "../../types/database.ts";

// The status cell: none when the company runs no GSRs, "Not in this cycle" for someone their period
// leaves out, else where their review stands (no row yet, or no period opened yet, is Not started).
type Standing = { kind: "no_cycle" } | { kind: "omitted"; cycle: ReviewCycle } | { kind: "review"; review: Review | null; cycle: ReviewCycle | null };

// `period` names the report's own period on the row, when the team's periods differ.
function TeamRow({ person, standing, period, tasks, withTasks }: { person: Profile; standing: Standing; period: string | null; tasks: TaskWithSteps[]; withTasks: boolean }) {
  const today = todayIso();
  const overdue = tasks.filter((t) => isOverdue(t, today)).length;
  return (
    <li className="relative flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar person={person} size={28} />
        <div className="min-w-0">
          <Link to={`/people/${person.id}`} className={`${itemTitleClass} hover:text-link ${tapStretchClass}`}>
            {displayName(person)}
          </Link>
          <p className={`truncate ${metaClass}`}>{person.title ?? ROLE_LABELS[person.role]}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-10 sm:shrink-0 sm:pl-0">
        {hasAccount(person) ? null : <Badge tone="warning">Not signed in yet</Badge>}
        {withTasks ? <span className={`tnum ${metaClass}`}>{tasks.length} open</span> : null}
        {withTasks && overdue > 0 ? (
          <span className={`tnum ${metaClass}`}>
            <span className="text-danger">{overdue} overdue</span>
          </span>
        ) : null}
        {period ? <span className={metaClass}>{period}</span> : null}
        {standing.kind === "review" ? (
          <Badge tone={standing.review ? REVIEW_STATUS_TONE[standing.review.status] : "neutral"}>
            {standing.review ? REVIEW_STATUS_LABELS[standing.review.status] : "Not started"}
          </Badge>
        ) : (
          <span className={metaClass}>{standing.kind === "omitted" ? "Not in this cycle" : "-"}</span>
        )}
      </div>
    </li>
  );
}

export default function TeamBlock({
  companyId,
  viewer,
  people,
  cycles,
  omissions,
  className = "",
}: {
  companyId: string;
  viewer: Profile;
  people: readonly Profile[];
  cycles: readonly ReviewCycle[];
  // The cycle omissions the viewer can read (listCycleOmissions): their own and their people's.
  omissions: readonly CycleOmission[];
  className?: string;
}) {
  const { company } = useHub();
  const withTasks = hasModule(company, "tasks");
  // Direct reports only, out of the people the viewer leads. A past employee is not current team.
  const reports = ledBy(viewer, people)
    .filter((p) => p.reports_to === viewer.id && p.id !== viewer.id && p.is_active)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const runs = runsGsrs([...cycles]);
  // The periods any report's GSR can be in: those of their rhythms covering today, and those still
  // open after they ended (a period a report still owes). Their reviews are read for these alone,
  // then gsrCycleInPlayFor picks each report's own.
  const today = todayIso();
  const rhythms = new Set<string>(reports.map((p) => rhythmOf(p)));
  const candidates = cycles.filter(
    (c) => c.kind === "gsr" && rhythms.has(c.cadence) && ((c.period_start <= today && c.period_end >= today) || (c.status === "open" && c.period_end < today)),
  );
  const candidateKey = candidates.map((c) => c.id).join(",");
  const any = reports.length > 0;
  const state = useAsync(async () => {
    if (!any) return { reviews: [] as Review[], tasks: [] as TaskWithSteps[] };
    const [reviews, tasks] = await Promise.all([
      Promise.all(candidates.map((c) => listCycleReviews(c.id))).then((lists) => lists.flat()),
      withTasks ? listTasks(companyId, { status: "open" }) : Promise.resolve([] as TaskWithSteps[]),
    ]);
    return { reviews, tasks };
  }, [companyId, candidateKey, withTasks, any]);

  if (!any) return <p className={`${secondaryClass} ${className}`}>No one reports to you yet.</p>;

  const reviews = state.data?.reviews ?? [];
  const periodOf = (person: Profile): ReviewCycle | null =>
    gsrCycleInPlayFor(person, [...cycles], reviews, new Date(), omittedCycleIdsFor([...omissions], reviews, person.id));
  const standingOf = (person: Profile): Standing => {
    if (!runs) return { kind: "no_cycle" };
    const cycle = periodOf(person);
    if (!cycle) return { kind: "review", review: null, cycle: null };
    if (!cycleRoster([person], reviews, cycle, [...omissions]).length) return { kind: "omitted", cycle };
    return { kind: "review", review: reviews.find((r) => r.cycle_id === cycle.id && r.employee_id === person.id) ?? null, cycle };
  };
  // One period for the whole team names it once; reports on different rhythms each name their own.
  const nameOf = (person: Profile) => periodOf(person)?.name ?? gsrPeriodFor(rhythmOf(person)).name;
  const periods = new Set(reports.map((p) => periodOf(p)?.id ?? `none:${rhythmOf(p)}`));
  const status = !runs ? " · No GSRs yet, so no status" : periods.size === 1 ? ` · GSR status for ${nameOf(reports[0])}` : " · GSR status for each person's current period";
  const description = `${reports.length} direct ${reports.length === 1 ? "report" : "reports"}${status}`;
  return (
    <Section eyebrow="Team" title="Your team" description={description} className={className}>
      {state.error && !state.data ? <Notice tone="error">Your team's status did not load. {state.error}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={Math.min(reports.length, 4)} /> : null}
      {state.data ? (
        <ul aria-label="Your team" className="-my-3 divide-y divide-line">
          {reports.map((person) => (
            <TeamRow
              key={person.id}
              person={person}
              standing={standingOf(person)}
              period={runs && periods.size > 1 ? nameOf(person) : null}
              tasks={state.data!.tasks.filter((t) => t.assignee_id === person.id)}
              withTasks={withTasks}
            />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
