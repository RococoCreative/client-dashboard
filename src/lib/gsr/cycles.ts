// Review cycle period math: given a cadence and a date, the canonical period it falls in, its end
// and a default name. Date-only strings in, date-only strings out, all in local time so a
// September cycle never begins on August 31 in Chicago. A GSR period is canonical (0046): a week
// runs Monday to Sunday, two weeks are blocks of Mondays counted from Monday 2024-01-01, a month is
// the calendar month and a quarter the calendar quarter, so each period has exactly one row.
import { formatPeriod, parseDate, toDateOnly } from "../format.ts";
import type { Cadence, CycleKind, GsrCadence } from "../../types/database.ts";

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  custom: "Custom dates",
};

// The rhythms a Goal Setting Review runs at, in order, and how each reads on a select.
export const GSR_CADENCES: readonly GsrCadence[] = ["weekly", "biweekly", "monthly", "quarterly"];
export const GSR_RHYTHM_LABELS: Record<GsrCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export function isGsrCadence(cadence: string): cadence is GsrCadence {
  return (GSR_CADENCES as readonly string[]).includes(cadence);
}

// A person's rhythm, monthly when the row predates 0046 or a caller built it without one.
export function rhythmOf(person: { gsr_cadence?: GsrCadence | null }): GsrCadence {
  return person.gsr_cadence ?? "monthly";
}

// How a GSR period reads to people, from its rhythm: "Goals for this week", "Last month at a
// glance", "This quarter's GSR". `noun` names one period ("open that week instead"), `plural`
// several ("The weeks in this period"), `adjective` the rhythm ("their weekly GSR") and `every`
// how often it runs ("runs every two weeks", the words 0046's refusal uses).
export interface GsrPeriodCopy {
  noun: string;
  plural: string;
  adjective: string;
  every: string;
  this: string;
  possessive: string;
  last: string;
  heading: string;
}
function periodCopy(noun: string, plural: string, adjective: string, every: string, thisPeriod: string, possessive: string, last: string): GsrPeriodCopy {
  return { noun, plural, adjective, every, this: thisPeriod, possessive, last, heading: `${upperFirst(possessive)} GSR` };
}
const PERIOD_COPY: Record<GsrCadence, GsrPeriodCopy> = {
  weekly: periodCopy("week", "weeks", "weekly", "every week", "this week", "this week's", "last week"),
  biweekly: periodCopy("two-week period", "two-week periods", "two-week", "every two weeks", "these two weeks", "these two weeks'", "the last two weeks"),
  monthly: periodCopy("month", "months", "monthly", "every month", "this month", "this month's", "last month"),
  quarterly: periodCopy("quarter", "quarters", "quarterly", "every quarter", "this quarter", "this quarter's", "last quarter"),
};
export function gsrPeriodCopy(cadence: Cadence): GsrPeriodCopy {
  return isGsrCadence(cadence) ? PERIOD_COPY[cadence] : PERIOD_COPY.monthly;
}

// "last week" to "Last week", for copy that opens a sentence.
export function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Monday 2024-01-01, where the first two-week block begins. Every block is counted from it, both
// ways, so a company's biweekly periods line up whoever opens them.
const BIWEEKLY_ANCHOR = new Date(2024, 0, 1);

function monthsFor(cadence: Cadence): number | null {
  switch (cadence) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "annual": return 12;
    default: return null;
  }
}

function daysFor(cadence: Cadence): number | null {
  switch (cadence) {
    case "weekly": return 7;
    case "biweekly": return 14;
    default: return null;
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Whole days since the epoch for a local calendar date, so a daylight saving change never puts a
// day on either side of a boundary.
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

// First day of the period that contains `date` for a fixed cadence; the date itself for
// custom cycles.
export function periodStart(cadence: Cadence, date: Date): string {
  if (cadence === "weekly") return toDateOnly(mondayOf(date));
  if (cadence === "biweekly") {
    const weeks = (dayNumber(mondayOf(date)) - dayNumber(BIWEEKLY_ANCHOR)) / 7;
    return toDateOnly(addDays(BIWEEKLY_ANCHOR, Math.floor(weeks / 2) * 14));
  }
  const months = monthsFor(cadence);
  if (months === null) return toDateOnly(date);
  const startMonth = Math.floor(date.getMonth() / months) * months;
  return toDateOnly(new Date(date.getFullYear(), startMonth, 1));
}

// Last day of the period that begins on `start`; null for custom cycles (the admin picks).
export function periodEnd(cadence: Cadence, start: string): string | null {
  const date = parseDate(start);
  if (!date) return null;
  const days = daysFor(cadence);
  if (days !== null) return toDateOnly(addDays(date, days - 1));
  const months = monthsFor(cadence);
  if (months === null) return null;
  // Day 0 of the following month is the last day of the target month.
  return toDateOnly(new Date(date.getFullYear(), date.getMonth() + months, 0));
}

// Whether these dates are exactly one canonical period of the cadence. The database refuses a GSR
// cycle that is not (0046); the cycle forms compute the dates so they always are.
export function isCanonicalPeriod(cadence: Cadence, start: string, end: string): boolean {
  const date = parseDate(start);
  if (!date || cadence === "custom") return false;
  return periodStart(cadence, date) === start && periodEnd(cadence, start) === end;
}

// "Sep 14 to Sep 20, 2026" for a week, "Sep 14 to Sep 27, 2026" for two weeks, "September 2026",
// "Q3 2026", "2026", or "Sep 1 to Oct 15, 2026" for custom. A period that crosses a year end names
// both years ("Dec 28, 2026 to Jan 3, 2027"), the way formatPeriod does, so it never reads as a
// December a year later. Weeks and two weeks read exactly as the database names a period a member
// opens (private.gsr_period_name, 0046), so a period reads the same whoever opened it.
export function defaultCycleName(cadence: Cadence, start: string, end?: string | null): string {
  const date = parseDate(start);
  if (!date) return "";
  const year = date.getFullYear();
  switch (cadence) {
    case "weekly":
    case "biweekly":
      return formatPeriod(start, periodEnd(cadence, start) ?? start);
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

// The canonical GSR period of a rhythm that covers `today`, with its default name: what opening
// a person's current GSR inserts (ensureGsrCycle).
export function gsrPeriodFor(cadence: GsrCadence, today = new Date()): { period_start: string; period_end: string; name: string } {
  const start = periodStart(cadence, today);
  const end = periodEnd(cadence, start) ?? start;
  return { period_start: start, period_end: end, name: defaultCycleName(cadence, start, end) };
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

// The one cycle of a section that a person's own screens work in: the open cycle covering today
// (the one ending soonest, when several do), else the most recently ended one nobody has closed
// yet, else the next one to begin. Read from cyclesInPlay, never activeCycles alone: on December
// 1, with November still open and December not opened yet, the quarter covering today was all
// activeCycles returned, and the employee lost the month they still had to finish.
//
// The cycle is chosen among its own section only, so a cycle of the other cadence never changes
// the answer. And a cycle that has begun always wins over one opened early: when nothing covers
// today, cyclesInPlay leads with its stand-in, the most recently started open cycle, which can be
// one that has not begun yet. Taking it hid the ended cycle still owed. When nothing open has
// begun, the earliest to begin is next, not the furthest: on October 25, with November and
// December both opened early, November is the one to work in. Ties break on the id, so the answer
// never depends on the order the rows arrived in.
function sectionCycleInPlay<T extends { id: string; kind: CycleKind; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  section: HubSection,
  today: Date,
): T | null {
  const todayIso = toDateOnly(today);
  const own = cycles.filter((c) => sectionOf(c) === section);
  const begun = cyclesInPlay(own, today).find((c) => c.period_start <= todayIso);
  if (begun) return begun;
  return (
    own
      .filter((c) => c.status === "open")
      .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// The GSR period of a person's rhythm that covers today, or null when nobody has opened it yet.
// An open one wins over a closed one of the same dates, and ties break on the id.
export function gsrCycleFor<T extends { id: string; kind: CycleKind; cadence: Cadence; period_start: string; period_end: string; status: string }>(
  person: { gsr_cadence?: GsrCadence | null },
  cycles: T[],
  today = new Date(),
): T | null {
  const todayIso = toDateOnly(today);
  const rhythm = rhythmOf(person);
  return (
    cycles
      .filter((c) => c.kind === "gsr" && c.cadence === rhythm && c.period_start <= todayIso && c.period_end >= todayIso)
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// The GSR period a person's own screens work in: the one of their rhythm covering today, else the
// most recently ended period of their rhythm still open with their GSR in it unfinished, so a
// quarter covering today, or a new week nobody has opened yet, never hides a GSR they still have
// to finish. A period they never started, or one they are left out of, is not owed. Null means
// their current period is not open yet: My GSR offers to open it (ensureGsrCycle). My GSR, the
// dashboard and the person page all read it here, so they agree.
export function gsrCycleInPlayFor<T extends { id: string; kind: CycleKind; cadence: Cadence; period_start: string; period_end: string; status: string }>(
  person: { id: string; gsr_cadence?: GsrCadence | null },
  cycles: T[],
  reviews: Array<{ employee_id: string; cycle_id: string; status: string }>,
  today = new Date(),
  omittedCycleIds: readonly string[] = [],
): T | null {
  const current = gsrCycleFor(person, cycles, today);
  if (current) return current;
  const todayIso = toDateOnly(today);
  const rhythm = rhythmOf(person);
  return (
    cycles
      .filter(
        (c) =>
          c.kind === "gsr" &&
          c.cadence === rhythm &&
          c.status === "open" &&
          c.period_end < todayIso &&
          !omittedCycleIds.includes(c.id) &&
          reviews.some((r) => r.cycle_id === c.id && r.employee_id === person.id && r.status !== "complete"),
      )
      .sort((a, b) => b.period_end.localeCompare(a.period_end) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// Whether a company runs Goal Setting Reviews at all: it has opened at least one GSR period. A
// company that never has gets no GSR blocks and no way to open one from a person's screens.
export function runsGsrs(cycles: Array<{ kind: CycleKind }>): boolean {
  return cycles.some((c) => c.kind === "gsr");
}

// The scored cycle a person's months are adding up toward, for the Monthly GSRs line on the
// dashboard and the person page. Chosen among scored cycles first: read off every cadence, a month
// covering today (or a month standing in between periods) was the only cycle in the list, and the
// quarter still open after its period ended went missing with the line.
export function scoredCycleInPlay<T extends { id: string; kind: CycleKind; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T | null {
  return sectionCycleInPlay(cycles, "reviews", today);
}

// The most pressing open cycle, for a caller that can genuinely only show one. Prefer
// activeCycles anywhere a company's whole review state is being summarised.
export function currentCycle<T extends { id: string; period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T | null {
  return activeCycles(cycles, today)[0] ?? null;
}

// Where a cycle lives in the hub. A GSR cycle (kind 'gsr', whatever its rhythm) is a Goal Setting
// Review and sits in the GSRs section; a scored review (kind 'review') sits in Reviews. The split
// is keyed on kind, a column, so it is data and never a company branch; cadence is only the
// rhythm (0046). Every link to a cycle or a review goes through these, because a sidebar entry
// highlights by path prefix and a review reached under /gsr would light up the wrong section.
export type HubSection = "gsr" | "reviews";
export function sectionOf(cycle: { kind: CycleKind }): HubSection {
  return cycle.kind === "gsr" ? "gsr" : "reviews";
}
export const SECTION_HOME: Record<HubSection, string> = { gsr: "/gsr", reviews: "/reviews" };
export const SECTION_MY: Record<HubSection, string> = { gsr: "/my/gsr", reviews: "/my/reviews" };
export const SECTION_LABEL: Record<HubSection, string> = { gsr: "Goal Setting Reviews", reviews: "Review cycles" };
export function cyclePath(cycle: { id: string; kind: CycleKind }): string {
  return `${SECTION_HOME[sectionOf(cycle)]}/cycles/${cycle.id}`;
}
export function reviewPath(reviewId: string, cycle: { kind: CycleKind }): string {
  return sectionOf(cycle) === "gsr" ? `/gsr/reviews/${reviewId}` : `/reviews/${reviewId}`;
}

// What a cycle's team table carries. A scored cycle has a column per pillar, an overall and a
// team score. A GSR period has none of them: its rows say where each person's GSR stands and, for
// a company that scores its GSRs (an active Monthly GSRs pillar), the score locked in on it.
// Decided here on kind and pillar rows, never on the company.
export function cycleColumns(
  cycle: { kind: CycleKind },
  pillars: Array<{ scoring_type: string; is_active: boolean }>,
): { pillarScores: boolean; gsrScore: boolean } {
  if (sectionOf(cycle) === "reviews") return { pillarScores: true, gsrScore: false };
  return { pillarScores: false, gsrScore: pillars.some((p) => p.scoring_type === "gsr_goals" && p.is_active) };
}

// The existing cycle a new or edited one would run on top of: the same kind and cadence, with a
// period that shares at least one day. Two Novembers split the month's GSRs across twins: the
// manager works a person's GSR in one, My GSR opens the other, and the quarter lists November
// twice. So the cycle dialogs refuse it and name the one already there. A month inside a quarter is
// a different cadence, and a quarterly GSR beside a quarterly review a different kind, and neither
// collides. The earliest overlapping cycle is the one named, whatever the order.
export function overlappingCycle<T extends { id: string; kind: string; cadence: string; period_start: string; period_end: string }>(
  cycles: T[],
  candidate: { id?: string; kind: string; cadence: string; period_start: string; period_end: string },
): T | null {
  return (
    cycles
      .filter(
        (c) =>
          c.id !== candidate.id &&
          c.kind === candidate.kind &&
          c.cadence === candidate.cadence &&
          c.period_start <= candidate.period_end &&
          candidate.period_start <= c.period_end,
      )
      .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// What the cycle dialogs say when overlappingCycle finds one.
export function overlapMessage(existing: { name: string; kind: string; cadence: Cadence; period_start: string; period_end: string }): string {
  const noun = existing.kind === "gsr" ? gsrPeriodCopy(existing.cadence).noun : "cycle";
  return `"${existing.name}" already covers ${formatPeriod(existing.period_start, existing.period_end)}. Pick dates that do not overlap it, or open that ${noun} instead.`;
}

// Who a cycle covers: everyone active on the roster, signed in or not, plus anyone deactivated
// since whose review in it was signed off, less anyone an admin has left out of it (0034). A GSR
// period covers only the people whose rhythm is its cadence (0046): a weekly week is not owed by
// someone on a monthly rhythm. A signed-off review is the record, so deactivating a person or
// changing their rhythm later never changes a closed cycle's counts or team score; a review they
// still owed simply drops out with them. An omission never reaches a signed-off review (the
// database refuses one), so a person whose review here is signed off stays in whatever the
// omission rows say. Every screen that counts or scores a cycle reads its roster here, so the
// dashboard, the cycle page, the cycles list and the portfolio never disagree about who is in it.
export function cycleRoster<P extends { id: string; is_active: boolean; gsr_cadence?: GsrCadence | null }>(
  people: P[],
  reviews: Array<{ employee_id: string; cycle_id: string; status: string }>,
  cycle: { id: string; kind: CycleKind; cadence: Cadence },
  omissions: Array<{ cycle_id: string; employee_id: string }> = [],
): P[] {
  return people.filter((p) => {
    if (reviews.some((r) => r.cycle_id === cycle.id && r.employee_id === p.id && r.status === "complete")) return true;
    if (cycle.kind === "gsr" && rhythmOf(p) !== cycle.cadence) return false;
    return p.is_active && !isOmitted(omissions, cycle.id, p.id);
  });
}

// The people an admin has left out of a cycle who would otherwise be in it: active, omitted,
// and not kept in by a signed-off review. The complement of cycleRoster among the active, so the
// cycle page's "not in this cycle" list and its team table never overlap or miss anyone.
export function cycleOmitted<P extends { id: string; is_active: boolean; gsr_cadence?: GsrCadence | null }>(
  people: P[],
  reviews: Array<{ employee_id: string; cycle_id: string; status: string }>,
  cycle: { id: string; kind: CycleKind; cadence: Cadence },
  omissions: Array<{ cycle_id: string; employee_id: string }>,
): P[] {
  const roster = cycleRoster(people, reviews, cycle, omissions);
  return people.filter(
    (p) => p.is_active && (cycle.kind !== "gsr" || rhythmOf(p) === cycle.cadence) && isOmitted(omissions, cycle.id, p.id) && !roster.includes(p),
  );
}

// The cycles one person is left out of, read the way cycleRoster reads them: an omission never
// reaches a review of theirs that is signed off. Their own screens (My GSR, the dashboard, the
// person page, the review) ask this rather than the omission rows, so they agree with the roster.
export function omittedCycleIdsFor(
  omissions: Array<{ cycle_id: string; employee_id: string }>,
  reviews: Array<{ employee_id: string; cycle_id: string; status: string }>,
  employeeId: string,
): string[] {
  return omissions
    .filter(
      (o) =>
        o.employee_id === employeeId &&
        !reviews.some((r) => r.cycle_id === o.cycle_id && r.employee_id === employeeId && r.status === "complete"),
    )
    .map((o) => o.cycle_id);
}

// Whether an admin has left this person out of this cycle.
export function isOmitted(omissions: Array<{ cycle_id: string; employee_id: string }>, cycleId: string, employeeId: string): boolean {
  return omissions.some((o) => o.cycle_id === cycleId && o.employee_id === employeeId);
}

// How far one cycle has got, counted over the roster it covers rather than over the review rows
// that happen to exist.
//
// A cycle covers its roster (cycleRoster above), and a person with no review row yet is a review still owed.
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

// The Goal Setting Reviews that ran inside a scored period: every GSR period whose whole span sits
// within the cycle's, oldest first, whatever its rhythm. A quarterly review reads them back as the
// periods' goals, hit or miss, which is the record the meeting works from. Containment is on
// dates, so a custom cycle that straddles a boundary counts only the periods it wholly covers, and
// a period is never counted under two quarters. For one person, only their periods: those of their
// rhythm, and any other they have a GSR in (a rhythm they ran before a change keeps its record).
// Leave both out for every GSR period inside.
export function gsrPeriodsWithin<T extends { id: string; kind: CycleKind; cadence: string; period_start: string; period_end: string }>(
  period: { period_start: string; period_end: string },
  cycles: T[],
  personCadence?: GsrCadence,
  personCycleIds: readonly string[] = [],
): T[] {
  return cycles
    .filter((c) => c.kind === "gsr" && c.period_start >= period.period_start && c.period_end <= period.period_end)
    .filter((c) => personCadence === undefined || c.cadence === personCadence || personCycleIds.includes(c.id))
    .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.period_end.localeCompare(b.period_end) || a.id.localeCompare(b.id));
}

// The cycle before `current` of the same kind and cadence: the latest one that started earlier.
export function previousCycle<T extends { id: string; kind: CycleKind; cadence: string; period_start: string }>(cycles: T[], current: T): T | null {
  return (
    cycles
      .filter((c) => c.id !== current.id && c.kind === current.kind && c.cadence === current.cadence && c.period_start < current.period_start)
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
