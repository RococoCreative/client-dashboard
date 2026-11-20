// A manager's team on Home in a company whose GSRs are on demand, right under their own GSR: one row
// per direct report with the day their last GSR began, In progress when one is open, whether one is
// due or overdue by their rhythm (DueBadge; rhythm None shows nothing), and a way to open the one in
// progress or start one (useStartGsr). The rows and the due state come from gsrStanding, the same
// rules the GSRs log reads, over one read of the GSRs and one of the last start dates for everyone,
// never one per person. A report who has not signed in yet is listed like anyone else, marked as
// such. On a phone the name's link stretches over its whole row; the row's own control sits above it.
import { Link } from "react-router-dom";
import Avatar from "../ui/Avatar.tsx";
import Badge from "../ui/Badge.tsx";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapStretchClass, tapTargetClass } from "../ui/tap.ts";
import { itemTitleClass, metaClass, secondaryClass } from "../ui/type.ts";
import DueBadge from "../gsr/onDemand/DueBadge.tsx";
import { useStartGsr } from "../gsr/onDemand/useStartGsr.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { gsrStanding, type GsrStandingRow } from "../../lib/gsr/gsrStanding.ts";
import { windowRange } from "../../lib/gsr/onDemand.ts";
import { displayName, formatDate } from "../../lib/format.ts";
import { hasAccount } from "../../lib/people.ts";
import { companyToday } from "../../lib/wins.ts";
import { listGsrsForLog, listLastGsrDates } from "../../services/gsrOnDemand.ts";
import { ROLE_LABELS, type Profile } from "../../types/database.ts";

function TeamRow({ row, busy, onStart }: { row: GsrStandingRow; busy: boolean; onStart: (id: string) => void }) {
  const { person } = row;
  const name = displayName(person);
  return (
    <li className="relative flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar person={person} size={28} />
        <div className="min-w-0">
          <Link to={`/people/${person.id}/gsr`} className={`${itemTitleClass} hover:text-link ${tapStretchClass}`}>
            {name}
          </Link>
          <p className={`truncate ${metaClass}`}>
            {person.title ?? ROLE_LABELS[person.role]} · {row.last ? `Last GSR ${formatDate(row.last)}` : "No GSR yet"}
          </p>
        </div>
      </div>
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-10 sm:shrink-0 sm:pl-0">
        {hasAccount(person) ? null : <Badge tone="warning">Not signed in yet</Badge>}
        {row.open ? <Badge tone="info">In progress</Badge> : null}
        <DueBadge state={row.due} />
        {row.open ? (
          <Link to={`/gsr/reviews/${row.open.id}`} className={`text-[13px] text-link hover:underline ${tapTargetClass}`}>
            Open<span className="sr-only">{` the GSR in progress for ${name}`}</span>
          </Link>
        ) : row.canStart ? (
          <Button variant="link" disabled={busy} onClick={() => onStart(person.id)}>
            Start<span className="sr-only">{` a GSR for ${name}`}</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export default function TeamBlockOnDemand({ reports, className = "" }: { reports: readonly Profile[]; className?: string }) {
  const { company } = useHub();
  const companyId = company!.id;
  const today = companyToday(company!.time_zone);
  const { start, busy, error: startError } = useStartGsr();
  const any = reports.length > 0;
  // The log's read for this week: every GSR open now is in it, whatever the window.
  const range = windowRange("week", today);
  const state = useAsync(async () => {
    if (!any) return null;
    const [gsrs, lastDates] = await Promise.all([listGsrsForLog(companyId, range), listLastGsrDates(companyId)]);
    return { gsrs, lastDates };
  }, [companyId, any, range.from, range.to]);

  if (!any) return <p className={`${secondaryClass} ${className}`}>No one reports to you yet.</p>;

  const rows = state.data ? gsrStanding(reports, state.data.gsrs, state.data.lastDates, range, today).rows : [];
  const description = `${reports.length} direct ${reports.length === 1 ? "report" : "reports"} · Their GSRs and who is due one`;
  return (
    <Section eyebrow="Team" title="Your team" description={description} className={className}>
      {state.error && !state.data ? <Notice tone="error">Your team's GSRs did not load. {state.error}</Notice> : null}
      {startError ? <Notice tone="error" className="mb-3">{startError}</Notice> : null}
      {!state.data && !state.error ? <SkeletonRows rows={Math.min(reports.length, 4)} /> : null}
      {state.data ? (
        <ul aria-label="Your team" className="-my-3 divide-y divide-line">
          {rows.map((row) => (
            <TeamRow key={row.person.id} row={row} busy={busy} onStart={(id) => void start(id)} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
