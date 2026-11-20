// The GSRs log, a company on demand's view of its Goal Setting Reviews (companies.gsr_mode, 0047):
// how many GSRs were done in a window and their average, how many are in progress, and, person by
// person, when their last one began, their rhythm, what they did in the window and whether they
// are due one. A GSR here has no cycle, so a company can run them daily for three people and never
// for others, and the figures are simply an aggregate of whatever was done.
//
// The window (this week, this month, this quarter or custom dates) lives in the address, so a
// reload or a shared link keeps it; it sets Done and Average only. In progress and the due flags
// are as of today, the company's today. Every number and every flag comes from lib/gsr/onDemand.ts:
// nothing is counted, averaged or dated here.
//
// Who is listed follows who leads whom: an admin (a Rococo admin stepped in included) sees every
// active person in the company, a manager the people they lead (ledBy), signed in or not. The reads
// ask for the company explicitly and the database narrows them; the page reads the GSRs once per
// window and the last start dates once with them, never once per person. "New GSR" is the one
// primary action and asks for a person; each row starts or opens one quietly, through useStartGsr.
// A company on periods never reaches this page: /gsr keeps its months there.
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PencilLine } from "lucide-react";
import Badge from "../../components/ui/Badge.tsx";
import Button from "../../components/ui/Button.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { compactSelectClass, inputClass, labelClass, selectClass, tableClass, tdClass, thClass } from "../../components/ui/forms.ts";
import { tapStretchClass, tapTargetClass } from "../../components/ui/tap.ts";
import { metaClass, secondaryClass } from "../../components/ui/type.ts";
import DivisionSwitch from "../../components/people/DivisionSwitch.tsx";
import DueBadge from "../../components/gsr/onDemand/DueBadge.tsx";
import { useStartGsr } from "../../components/gsr/onDemand/useStartGsr.ts";
import { COMBINED, peopleInScope } from "../../components/scorecards/compare.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { GSR_RHYTHM_LABELS, GSR_WINDOW_LABELS, windowRange, type DateRange, type GsrWindow } from "../../lib/gsr/onDemand.ts";
import { gsrHeadline, gsrPeopleFor, gsrStanding, type GsrStandingRow } from "../../lib/gsr/gsrStanding.ts";
import { displayName, formatDate, formatNumber, formatPeriod } from "../../lib/format.ts";
import { canSeeDivisions, divisionLabel, isDivisionLimited, viewerDivisions } from "../../lib/people.ts";
import { companyToday } from "../../lib/wins.ts";
import { listDivisions } from "../../services/divisions.ts";
import { listGsrsForLog, listLastGsrDates } from "../../services/gsrOnDemand.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import type { Profile } from "../../types/database.ts";
import { gsrTabsFor } from "./gsrTabs.ts";

type WindowChoice = GsrWindow | "custom";
const WINDOWS: readonly WindowChoice[] = ["week", "month", "quarter", "custom"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The window the address asks for, and the dates it covers, or the plain line that says why
// custom dates cannot be read yet. This week when the address names none.
function readWindow(params: URLSearchParams, today: string): { choice: WindowChoice; range: DateRange | null; problem: string } {
  const asked = params.get("window");
  const choice = WINDOWS.find((w) => w === asked) ?? "week";
  if (choice !== "custom") return { choice, range: windowRange(choice, today), problem: "" };
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to)) return { choice, range: null, problem: "Choose a start and an end date." };
  if (to < from) return { choice, range: null, problem: "The end date is before the start date." };
  return { choice, range: { from, to }, problem: "" };
}

// A cell's look in the table, and below md a label and value line of a stacked row, as
// Scorecards' rows stack, so nothing scrolls sideways on a phone.
const cellClass =
  `${tdClass} py-2 max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:border-b-0 max-md:px-0 max-md:py-1 ` +
  "max-md:before:text-[12.5px] max-md:before:text-ink-2 max-md:before:content-[attr(data-label)]";

function PersonRow({ row, meta, busy, onStart }: { row: GsrStandingRow; meta: string; busy: boolean; onStart: (id: string) => void }) {
  const name = displayName(row.person);
  return (
    <tr role="row" className="hover:bg-surface-2/40 max-md:block max-md:border-b max-md:border-line max-md:px-4 max-md:py-3 max-md:last:border-b-0 md:[&>*:first-child]:pl-6 md:[&>*:last-child]:pr-6">
      <th scope="row" role="rowheader" className="relative border-b border-line px-3 py-2 text-left align-middle font-normal max-md:block max-md:border-b-0 max-md:px-0 max-md:py-0 max-md:pb-1 tap:min-h-11">
        <Link to={`/people/${row.person.id}/gsr`} className={`block truncate text-sm text-ink hover:text-link ${tapStretchClass}`}>
          {name}
        </Link>
        {meta ? <p className={`truncate ${metaClass}`}>{meta}</p> : null}
      </th>
      <td role="cell" data-label="Last GSR" className={`${cellClass} tnum text-[13px]`}>{row.last ? formatDate(row.last) : "Never"}</td>
      <td role="cell" data-label="Rhythm" className={`${cellClass} text-[13px]`}>{GSR_RHYTHM_LABELS[row.person.gsr_cadence]}</td>
      <td role="cell" data-label="Done" className={`${cellClass} tnum text-right text-[13px]`}>{row.done}</td>
      <td role="cell" data-label="Average" className={`${cellClass} tnum text-right text-[13px]`}>{formatNumber(row.average)}</td>
      <td role="cell" data-label="Status" className={`${cellClass} max-md:empty:hidden`}>
        {row.open || row.due === "due" || row.due === "overdue" ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
            {row.open ? <Badge tone="info">In progress</Badge> : null}
            <DueBadge state={row.due} />
          </span>
        ) : null}
      </td>
      <td role="cell" className={`${tdClass} py-2 text-right max-md:block max-md:border-b-0 max-md:px-0 max-md:py-0 max-md:empty:hidden`}>
        {row.open ? (
          <Link to={`/gsr/reviews/${row.open.id}`} className={`text-[13px] text-link hover:underline ${tapTargetClass}`}>
            Open<span className="sr-only">{` the GSR in progress for ${name}`}</span>
          </Link>
        ) : row.canStart ? (
          <Button variant="link" disabled={busy} onClick={() => onStart(row.person.id)}>
            Start<span className="sr-only">{` a GSR for ${name}`}</span>
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

export default function GsrLogPage() {
  const { company, profile, isAdmin } = useHub();
  const current = company!;
  const companyId = current.id;
  const today = companyToday(current.time_zone);
  const [params, setParams] = useSearchParams();
  const { choice, range, problem } = readWindow(params, today);
  const allowed = canSeeDivisions(profile);
  const limited = isDivisionLimited(profile);
  const [scope, setScope] = useState(COMBINED);
  const [picked, setPicked] = useState("");
  const { start, busy, error: startError } = useStartGsr();

  // One read of each per window, all at once; nothing is read until the window has its dates.
  const state = useAsync(async () => {
    if (!range) return null;
    const [gsrs, lastDates, people, divisions] = await Promise.all([
      listGsrsForLog(companyId, range),
      listLastGsrDates(companyId),
      listCompanyProfiles(companyId),
      allowed ? listDivisions(companyId) : Promise.resolve([]),
    ]);
    return { gsrs, lastDates, people, divisions };
  }, [companyId, allowed, range?.from, range?.to]);

  // The address keeps the window; the defaults (this week, no dates) stay off it.
  function change(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value) out.set(key, value);
          else out.delete(key);
        }
        return out;
      },
      { replace: true },
    );
  }
  function chooseWindow(next: WindowChoice) {
    change(next === "custom" ? { window: "custom" } : { window: next === "week" ? null : next, from: null, to: null });
  }

  const headerWith = (actions?: ReactNode) => (
    <PageHeader
      eyebrow={current.name}
      title="GSRs"
      description="The GSRs done in a window and their average, who has one in progress, and who is due one by their rhythm."
      actions={actions}
    />
  );
  const header = headerWith();
  const tabs = isAdmin ? <Tabs items={gsrTabsFor(current.gsr_mode)} label="GSRs" /> : null;

  const windowControls = (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="gsr-window" className={labelClass}>Window</label>
        <select id="gsr-window" value={choice} onChange={(e) => chooseWindow(e.target.value as WindowChoice)} className={`${selectClass} w-auto`}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>{GSR_WINDOW_LABELS[w]}</option>
          ))}
        </select>
      </div>
      {choice === "custom" ? (
        <>
          <div>
            <label htmlFor="gsr-from" className={labelClass}>From</label>
            <input id="gsr-from" type="date" value={params.get("from") ?? ""} onChange={(e) => change({ from: e.target.value || null })} className={`${inputClass} w-auto`} />
          </div>
          <div>
            <label htmlFor="gsr-to" className={labelClass}>To</label>
            <input id="gsr-to" type="date" value={params.get("to") ?? ""} onChange={(e) => change({ to: e.target.value || null })} className={`${inputClass} w-auto`} />
          </div>
        </>
      ) : null}
    </div>
  );

  if (!range) {
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4">{windowControls}</div>
        <p className={secondaryClass}>{problem}</p>
      </>
    );
  }

  if (state.error && !state.data) {
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4">{windowControls}</div>
        <Notice tone="error">{state.error}</Notice>
        <Button variant="secondary" size="sm" className="mt-3" onClick={state.reload}>Try again</Button>
      </>
    );
  }

  if (!state.data) {
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4">{windowControls}</div>
        <SkeletonRows rows={6} />
      </>
    );
  }

  const { gsrs, lastDates, people, divisions: allDivisions } = state.data;
  // An admin sees everyone active; anyone else who leads people, the people they lead, by name
  // (gsrPeopleFor). The headline and the rows come from gsrStanding, the same one Home's GSRs this
  // week card reads, so the two never disagree for the same viewer.
  const divisions = viewerDivisions(profile, allDivisions);
  const split = allowed && divisions.length > 0;
  const inScope = peopleInScope(gsrPeopleFor(profile, isAdmin, people), split ? scope : COMBINED);
  const { figures, rows } = gsrStanding(inScope, gsrs, lastDates, range, today);
  const startable = rows.filter((r) => r.canStart).map((r) => r.person);
  const metaOf = (person: Profile) =>
    [split && person.division_ids.length > 0 ? divisionLabel(person.division_ids, allDivisions) : null, person.title].filter(Boolean).join(" · ");

  return (
    <>
      {headerWith(
          startable.length > 0 ? (
            <>
              {startError ? <p role="alert" className="text-[12.5px] text-danger">{startError}</p> : null}
              <label htmlFor="gsr-new-person" className="sr-only">Person</label>
              <select id="gsr-new-person" value={picked} onChange={(e) => setPicked(e.target.value)} className={`${compactSelectClass} w-auto`}>
                <option value="">Choose a person</option>
                {startable.map((p) => (
                  <option key={p.id} value={p.id}>{displayName(p)}</option>
                ))}
              </select>
              <Button disabled={busy || !startable.some((p) => p.id === picked)} onClick={() => void start(picked)}>
                <PencilLine size={14} aria-hidden /> New GSR
              </Button>
            </>
          ) : null,
      )}
      {tabs}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {windowControls}
        {split ? (
          <div className="sm:ml-auto">
            <p className={`${labelClass} mb-1.5`}>Division</p>
            <DivisionSwitch divisions={divisions} value={scope} onChange={setScope} combinedLabel={limited ? "In your divisions" : "Combined"} />
          </div>
        ) : null}
      </div>

      <section aria-label="GSRs in this window" className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 shadow-xs sm:px-6">
        <p data-testid="gsr-headline" className="tnum font-display text-[18px] leading-snug text-heading">
          {gsrHeadline(figures)}
        </p>
        <p className={`mt-0.5 ${metaClass}`}>{formatPeriod(range.from, range.to)}</p>
      </section>

      {rows.length === 0 ? (
        <p className={secondaryClass}>Nobody to show here yet.</p>
      ) : (
        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
          <table role="table" aria-label="People and their GSRs" className={`${tableClass} max-md:block`}>
            <thead role="rowgroup" className="bg-surface-2 max-md:sr-only">
              <tr role="row" className="md:[&>*:first-child]:pl-6 md:[&>*:last-child]:pr-6">
                <th scope="col" role="columnheader" className={thClass}>Person</th>
                <th scope="col" role="columnheader" className={thClass}>Last GSR</th>
                <th scope="col" role="columnheader" className={thClass}>Rhythm</th>
                <th scope="col" role="columnheader" className={`${thClass} text-right`}>Done</th>
                <th scope="col" role="columnheader" className={`${thClass} text-right`}>Average</th>
                <th scope="col" role="columnheader" className={thClass}>Status</th>
                <th scope="col" role="columnheader" className={thClass}><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="max-md:block">
              {rows.map((row) => (
                <PersonRow key={row.person.id} row={row} meta={metaOf(row.person)} busy={busy} onStart={(id) => void start(id)} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
