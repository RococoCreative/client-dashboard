// Review cycle period math for the New Cycle form: given a cadence and a start date, the
// natural end date and a default name. Date-only strings in, date-only strings out, all in
// local time so a September cycle never begins on August 31 in Chicago.
import { formatPeriod, parseDate, toDateOnly } from "../format.ts";
import type { Cadence } from "../../types/database.ts";

export const CADENCE_LABELS: Record<Cadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  custom: "Custom dates",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthsFor(cadence: Cadence): number | null {
  switch (cadence) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "annual": return 12;
    default: return null;
  }
}

// First day of the period that contains `date` for a fixed cadence; the date itself for
// custom cycles.
export function periodStart(cadence: Cadence, date: Date): string {
  const months = monthsFor(cadence);
  if (months === null) return toDateOnly(date);
  const startMonth = Math.floor(date.getMonth() / months) * months;
  return toDateOnly(new Date(date.getFullYear(), startMonth, 1));
}

// Last day of the period that begins on `start`; null for custom cycles (the admin picks).
export function periodEnd(cadence: Cadence, start: string): string | null {
  const months = monthsFor(cadence);
  const date = parseDate(start);
  if (months === null || !date) return null;
  // Day 0 of the following month is the last day of the target month.
  return toDateOnly(new Date(date.getFullYear(), date.getMonth() + months, 0));
}

// "September 2026", "Q3 2026", "H2 2026", "2026", or "Sep 1 to Oct 15, 2026" for custom. A
// custom period that crosses a year end names both years ("Dec 1, 2026 to Jan 31, 2027"), the
// way formatPeriod does, so it never reads as a December a year later.
export function defaultCycleName(cadence: Cadence, start: string, end?: string | null): string {
  const date = parseDate(start);
  if (!date) return "";
  const year = date.getFullYear();
  switch (cadence) {
    case "monthly":
      return `${MONTHS[date.getMonth()]} ${year}`;
    case "quarterly":
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${year}`;
    case "annual":
      return `${year}`;
    default: {
      if (!end || !parseDate(end)) return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${year}`;
      return formatPeriod(start, end);
    }
  }
}

// Every open cycle whose period covers today, the one ending soonest first.
//
// A company can have several at once and usually does: a monthly Goal Setting Review runs inside
// a quarterly scored review, so both cover today. Collapsing that to one cycle is how a finished
// review goes missing, because the summary shows whichever cycle won and reports the other's
// people as not started. Anything summarising a company's review state reads all of these.
//
// When nothing covers today the most recently started open cycle stands in, so a company between
// periods still sees where it left off. Ties break on the dates and then the id, so the answer
// never depends on the order the rows arrived in.
export function activeCycles<T extends { id: string; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T[] {
  const todayIso = toDateOnly(today);
  const open = cycles.filter((c) => c.status === "open");
  const live = open.filter((c) => c.period_start <= todayIso && c.period_end >= todayIso);
  if (live.length > 0) {
    // Ending soonest first, because that is the one with a deadline on it. When two end together
    // the shorter one leads: a September review inside Q3 is the more immediate of the two.
    return [...live].sort(
      (a, b) =>
        a.period_end.localeCompare(b.period_end) ||
        b.period_start.localeCompare(a.period_start) ||
        a.id.localeCompare(b.id),
    );
  }
  return [...open]
    .sort((a, b) => b.period_start.localeCompare(a.period_start) || b.period_end.localeCompare(a.period_end) || a.id.localeCompare(b.id))
    .slice(0, 1);
}

// Every open cycle with reviews still owed: the ones covering today (activeCycles), then every
// open cycle whose period has already ended, the most recently ended first.
//
// An open cycle stays open until an admin closes it, and its reviews keep being worked and
// signed off after the period is over. A summary that read only the cycles covering today lost
// that work the day the period ended: September's GSRs and last quarter's reviews were still
// being completed, and the dashboard counted none of it and showed none of their scores. A cycle
// that has not started yet is not owed anything and stays out, unless it is activeCycles' stand-in.
export function cyclesInPlay<T extends { id: string; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T[] {
  const todayIso = toDateOnly(today);
  const current = activeCycles(cycles, today);
  const shown = new Set(current.map((c) => c.id));
  const ended = cycles
    .filter((c) => c.status === "open" && c.period_end < todayIso && !shown.has(c.id))
    .sort((a, b) => b.period_end.localeCompare(a.period_end) || b.period_start.localeCompare(a.period_start) || a.id.localeCompare(b.id));
  return [...current, ...ended];
}

// The month a person's own Goal Setting Review is worked in: the open monthly cycle covering
// today, else the most recently ended month nobody has closed yet. Read from cyclesInPlay, never
// activeCycles alone: on December 1, with November still open and December not opened yet, the
// quarter covering today was all activeCycles returned, and the employee lost the month they still
// had to finish. My GSR and the employee dashboard both read it here, so they agree.
export function gsrCycleInPlay<T extends { id: string; cadence: Cadence; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T | null {
  return cyclesInPlay(cycles, today).find((c) => sectionOf(c.cadence) === "gsr") ?? null;
}

// The most pressing open cycle, for a caller that can genuinely only show one. Prefer
// activeCycles anywhere a company's whole review state is being summarised.
export function currentCycle<T extends { id: string; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T | null {
  return activeCycles(cycles, today)[0] ?? null;
}

// Where a cycle lives in the hub. A monthly cycle is a Goal Setting Review and sits in the GSRs
// section; every scored cadence (quarterly, annual, custom) is a review and sits in Reviews. The
// split is keyed on cadence, a column, so it is data and never a company branch. Every link to a
// cycle or a review goes through these, because a sidebar entry highlights by path prefix and a
// quarterly cycle reached under /gsr would light up the wrong section.
export type HubSection = "gsr" | "reviews";
export function sectionOf(cadence: Cadence): HubSection {
  return cadence === "monthly" ? "gsr" : "reviews";
}
export const SECTION_HOME: Record<HubSection, string> = { gsr: "/gsr", reviews: "/reviews" };
export const SECTION_MY: Record<HubSection, string> = { gsr: "/my/gsr", reviews: "/my/reviews" };
export const SECTION_LABEL: Record<HubSection, string> = { gsr: "Goal Setting Reviews", reviews: "Review cycles" };
export function cyclePath(cycle: { id: string; cadence: Cadence }): string {
  return `${SECTION_HOME[sectionOf(cycle.cadence)]}/cycles/${cycle.id}`;
}
export function reviewPath(reviewId: string, cadence: Cadence): string {
  return sectionOf(cadence) === "gsr" ? `/gsr/reviews/${reviewId}` : `/reviews/${reviewId}`;
}

// What a cycle's team table carries. A scored cycle has a column per pillar, an overall and a
// team score. A month is a Goal Setting Review and has none of them: its rows say where each
// person's GSR stands and, for a company that scores its GSRs (an active Monthly GSRs pillar), the
// score an admin locked in on it. Decided here on cadence and pillar rows, never on the company.
export function cycleColumns(
  cadence: Cadence,
  pillars: Array<{ scoring_type: string; is_active: boolean }>,
): { pillarScores: boolean; gsrScore: boolean } {
  if (sectionOf(cadence) === "reviews") return { pillarScores: true, gsrScore: false };
  return { pillarScores: false, gsrScore: pillars.some((p) => p.scoring_type === "gsr_goals" && p.is_active) };
}

// The existing cycle a new or edited one would run on top of: the same cadence, with a period
// that shares at least one day. Two Novembers split the month's GSRs across twins: the manager
// works a person's GSR in one, My GSR opens the other, and the quarter lists November twice. So the
// cycle dialogs refuse it and name the one already there. A month inside a quarter is a different
// cadence and never collides. The earliest overlapping cycle is the one named, whatever the order.
export function overlappingCycle<T extends { id: string; cadence: string; period_start: string; period_end: string }>(
  cycles: T[],
  candidate: { id?: string; cadence: string; period_start: string; period_end: string },
): T | null {
  return (
    cycles
      .filter(
        (c) =>
          c.id !== candidate.id &&
          c.cadence === candidate.cadence &&
          c.period_start <= candidate.period_end &&
          candidate.period_start <= c.period_end,
      )
      .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// What the cycle dialogs say when overlappingCycle finds one.
export function overlapMessage(existing: { name: string; cadence: string; period_start: string; period_end: string }): string {
  const noun = existing.cadence === "monthly" ? "month" : "cycle";
  return `"${existing.name}" already covers ${formatPeriod(existing.period_start, existing.period_end)}. Pick dates that do not overlap it, or open that ${noun} instead.`;
}

// How far one cycle has got, counted over the roster it covers rather than over the review rows
// that happen to exist.
//
// A cycle covers everybody active, and a person with no review row yet is a review still owed.
// Counting rows put that person in neither half of the fraction, so a cycle owing four reviews
// read "0 of 0 complete" and a cycle with three rows all signed off read "3 of 3" while a fourth
// person had no row at all. Starting the missing reviews then moved the denominator instead of
// the progress, which is backwards.
export function cycleProgress(
  roster: Array<{ id: string }>,
  reviews: Array<{ employee_id: string; cycle_id: string; status: string }>,
  cycleId: string,
): { complete: number; total: number } {
  const own = reviews.filter((r) => r.cycle_id === cycleId);
  return {
    complete: roster.filter((person) => own.some((r) => r.employee_id === person.id && r.status === "complete")).length,
    total: roster.length,
  };
}

// The Goal Setting Reviews that ran inside a scored period: every monthly cycle whose whole
// period sits within the cycle's, oldest first. A quarterly review reads them back as the
// months' goals, hit or miss, which is the record the meeting works from. Containment is on
// dates, so a custom cycle that straddles a month boundary counts only the months it wholly
// covers, and a month is never counted under two quarters.
export function monthsWithin<T extends { cadence: string; period_start: string; period_end: string }>(
  cycle: { period_start: string; period_end: string },
  cycles: T[],
): T[] {
  return cycles
    .filter((c) => c.cadence === "monthly" && c.period_start >= cycle.period_start && c.period_end <= cycle.period_end)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
}

// The cycle before `current` with the same cadence: the latest one that started earlier.
export function previousCycle<T extends { id: string; cadence: string; period_start: string }>(cycles: T[], current: T): T | null {
  return (
    cycles
      .filter((c) => c.id !== current.id && c.cadence === current.cadence && c.period_start < current.period_start)
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0] ?? null
  );
}

// The calendar year a cycle belongs to, from its start date.
export function cycleYear(cycle: { period_start: string }): number {
  return parseDate(cycle.period_start)?.getFullYear() ?? new Date().getFullYear();
}

// A cycle is settled once it is closed or its period is over: its goals read as hit or miss.
export function cycleSettled(cycle: { status: string; period_end: string }, today = new Date()): boolean {
  return cycle.status === "closed" || cycle.period_end < toDateOnly(today);
}
