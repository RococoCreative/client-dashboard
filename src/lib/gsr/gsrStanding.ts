// Where a viewer's people stand on GSRs on demand, in one place, so the GSRs log and Home's "GSRs
// this week" card cannot disagree: who the viewer sees (every active person for an admin, the people
// they lead for anyone else, signed in or not), the window's headline over those people, and each
// person's last start, open GSR and due state. Every count, average and date rule underneath is
// lib/gsr/onDemand.ts; this only gathers them per person and orders who is most overdue.
import type { Gsr, GsrLastStarted, Profile } from "../../types/database.ts";
import { displayName, formatNumber, pluralize } from "../format.ts";
import { ledBy } from "../people.ts";
import { currentGsr, dueFor, figuresByPerson, windowFigures, type DateRange, type DueState } from "./onDemand.ts";

export interface GsrStandingRow {
  person: Profile;
  // The day their last GSR began, or null when they have never had one.
  last: string | null;
  done: number;
  average: number | null;
  open: Gsr | null;
  due: DueState;
  dueOn: string | null;
  // A Rococo admin placed on a roster has no GSRs of their own.
  canStart: boolean;
}

export type GsrHeadlineFigures = ReturnType<typeof windowFigures>;

// The people a viewer sees GSRs for, by name: an admin everyone active, anyone else the active
// people they lead. The chain is walked through everyone the database showed, so a lapsed manager
// in the middle still links it.
export function gsrPeopleFor(viewer: Profile, isAdmin: boolean, people: readonly Profile[]): Profile[] {
  return (isAdmin ? [...people] : ledBy(viewer, people))
    .filter((p) => p.is_active)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

// The window's figures over these people's GSRs, and one row per person in the order given.
// `gsrs` is a log read (listGsrsForLog: done inside the range, and every one open now).
export function gsrStanding(
  people: readonly Profile[],
  gsrs: readonly Gsr[],
  lastDates: ReadonlyArray<Pick<GsrLastStarted, "employee_id" | "last_started_on">>,
  range: DateRange,
  today: string,
): { figures: GsrHeadlineFigures; rows: GsrStandingRow[] } {
  const ids = new Set(people.map((p) => p.id));
  const theirs = gsrs.filter((g) => ids.has(g.employee_id));
  const byPerson = figuresByPerson(theirs, range);
  const lastBy = new Map(lastDates.map((d) => [d.employee_id, d.last_started_on] as const));
  const rows = people.map((person) => {
    const own = byPerson.get(person.id);
    const last = lastBy.get(person.id) ?? null;
    const { state, dueOn } = dueFor(person.gsr_cadence, last, today);
    return {
      person,
      last,
      done: own?.done ?? 0,
      average: own?.average ?? null,
      open: own?.open ? currentGsr(theirs.filter((g) => g.employee_id === person.id)) : null,
      due: state,
      dueOn,
      canStart: !person.is_rococo_admin,
    };
  });
  return { figures: windowFigures(theirs, range), rows };
}

// The one line both the log and Home lead with.
export function gsrHeadline(figures: GsrHeadlineFigures): string {
  return `${pluralize(figures.done, "GSR")} done · Average ${formatNumber(figures.average)} · ${figures.inProgress} in progress`;
}

// The overdue, most overdue first: the earliest day one fell due, then by name.
export function mostOverdue(rows: readonly GsrStandingRow[]): GsrStandingRow[] {
  return rows
    .filter((r) => r.due === "overdue")
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || displayName(a.person).localeCompare(displayName(b.person)));
}

// The day a person's last GSR began, from their own GSRs, or null when they have none.
export function lastStartedOn(gsrs: ReadonlyArray<Pick<Gsr, "started_on">>): string | null {
  return gsrs.reduce<string | null>((latest, g) => (latest === null || g.started_on > latest ? g.started_on : latest), null);
}
