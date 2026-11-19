// A manager's team on Home, right under their own GSR: one row per direct report, with where their
// GSR stands this month and, when the company runs tasks, how many tasks they have open and how many
// are overdue. Built from the people the page already holds, which the database has narrowed to what
// the viewer may see, so it never names anyone the viewer may not open. A person who has not signed
// in yet is listed like anyone else, marked as such: everything attaches to the person, not an
// account. Status comes from the review rows alone; nothing here computes a score.
import { Link } from "react-router-dom";
import Avatar from "../ui/Avatar.tsx";
import Badge from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import { REVIEW_STATUS_TONE } from "../status.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { gsrCycleInPlay } from "../../lib/gsr/cycles.ts";
import { displayName, todayIso } from "../../lib/format.ts";
import { hasModule } from "../../lib/modules.ts";
import { hasAccount, ledBy } from "../../lib/people.ts";
import { isOverdue } from "../../lib/tasks.ts";
import { listCycleReviews } from "../../services/gsr.ts";
import { listTasks } from "../../services/tasks.ts";
import { REVIEW_STATUS_LABELS, ROLE_LABELS, type Profile, type Review, type ReviewCycle, type TaskWithSteps } from "../../types/database.ts";

function TeamRow({ person, review, tasks, withStatus, withTasks }: { person: Profile; review: Review | null; tasks: TaskWithSteps[]; withStatus: boolean; withTasks: boolean }) {
  const today = todayIso();
  const overdue = tasks.filter((t) => isOverdue(t, today)).length;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar person={person} size={28} />
        <div className="min-w-0">
          <Link to={`/people/${person.id}`} className={`${itemTitleClass} hover:text-link`}>
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
        {withStatus ? (
          <Badge tone={review ? REVIEW_STATUS_TONE[review.status] : "neutral"}>{review ? REVIEW_STATUS_LABELS[review.status] : "Not started"}</Badge>
        ) : (
          <span className={metaClass}>-</span>
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
  className = "",
}: {
  companyId: string;
  viewer: Profile;
  people: readonly Profile[];
  cycles: readonly ReviewCycle[];
  className?: string;
}) {
  const { company } = useHub();
  const withTasks = hasModule(company, "tasks");
  // Direct reports only, out of the people the viewer leads. A past employee is not current team.
  const reports = ledBy(viewer, people)
    .filter((p) => p.reports_to === viewer.id && p.id !== viewer.id && p.is_active)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  // The same month My GSR and the GSR card open: the one covering today, else the latest still open.
  const cycle = gsrCycleInPlay([...cycles]);
  const any = reports.length > 0;
  const state = useAsync(async () => {
    if (!any) return { reviews: [] as Review[], tasks: [] as TaskWithSteps[] };
    const [reviews, tasks] = await Promise.all([
      cycle ? listCycleReviews(cycle.id) : Promise.resolve([] as Review[]),
      withTasks ? listTasks(companyId, { status: "open" }) : Promise.resolve([] as TaskWithSteps[]),
    ]);
    return { reviews, tasks };
  }, [companyId, cycle?.id ?? null, withTasks, any]);

  if (!any) return <p className={`${secondaryClass} ${className}`}>No one reports to you yet.</p>;

  const description = `${reports.length} direct ${reports.length === 1 ? "report" : "reports"}${cycle ? ` · GSR status for ${cycle.name}` : " · No GSR month open, so no status yet"}`;
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
              review={state.data!.reviews.find((r) => r.employee_id === person.id && r.cycle_id === cycle?.id) ?? null}
              tasks={state.data!.tasks.filter((t) => t.assignee_id === person.id)}
              withStatus={cycle !== null}
              withTasks={withTasks}
            />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
