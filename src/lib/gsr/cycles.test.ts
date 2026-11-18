// Pins the cycle rules every GSR screen shares: periods and their canonical boundaries for every
// rhythm, cadences and kinds, which cycles are in play, default names, who a cycle covers, and the
// GSR periods inside a quarter.
import { describe, expect, it } from "vitest";
import {
  activeCycles,
  currentCycle,
  cycleColumns,
  cycleOmitted,
  cycleProgress,
  cycleRoster,
  cyclesInPlay,
  defaultCycleName,
  gsrCycleFor,
  gsrCycleInPlayFor,
  gsrPeriodCopy,
  gsrPeriodFor,
  gsrPeriodsWithin,
  isCanonicalPeriod,
  isOmitted,
  omittedCycleIdsFor,
  overlapMessage,
  overlappingCycle,
  periodEnd,
  periodStart,
  previousCycle,
  reviewPath,
  runsGsrs,
  scoredCycleInPlay,
  sectionOf,
} from "./cycles.ts";
import { parseDate } from "../format.ts";
import type { GsrCadence } from "../../types/database.ts";

// A cycle as the roster reads it: a scored review unless said otherwise.
const review = (id: string) => ({ id, kind: "review" as const, cadence: "quarterly" as const });

describe("cycle periods", () => {
  it("snaps fixed cadences to the containing period", () => {
    const sep17 = new Date(2026, 8, 17);
    expect(periodStart("monthly", sep17)).toBe("2026-09-01");
    expect(periodStart("quarterly", sep17)).toBe("2026-07-01");
    expect(periodStart("annual", sep17)).toBe("2026-01-01");
    expect(periodStart("custom", sep17)).toBe("2026-09-17");
  });

  it("ends on the last day of the period, across month lengths and year ends", () => {
    expect(periodEnd("monthly", "2026-02-01")).toBe("2026-02-28");
    expect(periodEnd("monthly", "2028-02-01")).toBe("2028-02-29");
    expect(periodEnd("quarterly", "2026-10-01")).toBe("2026-12-31");
    expect(periodEnd("annual", "2026-01-01")).toBe("2026-12-31");
    expect(periodEnd("custom", "2026-01-01")).toBeNull();
  });

  it("names cycles the way people say them", () => {
    expect(defaultCycleName("monthly", "2026-09-01")).toBe("September 2026");
    expect(defaultCycleName("quarterly", "2026-07-01")).toBe("Q3 2026");
    expect(defaultCycleName("annual", "2026-01-01")).toBe("2026");
    expect(defaultCycleName("custom", "2026-09-01", "2026-10-15")).toBe("Sep 1 to Oct 15, 2026");
  });

  it("names a custom cycle that crosses a year end with both years", () => {
    // Without the start year, Dec 1 2026 to Jan 31 2027 read "Dec 1 to Jan 31, 2027", which
    // says December 2027.
    expect(defaultCycleName("custom", "2026-12-01", "2027-01-31")).toBe("Dec 1, 2026 to Jan 31, 2027");
    expect(defaultCycleName("custom", "2026-12-01")).toBe("Dec 1, 2026");
  });

  it("finds the cycle a new or edited one would run on top of", () => {
    const cycles = [
      { id: "nov", name: "November 2026", kind: "gsr", cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30" },
      { id: "q4", name: "Q4 2026", kind: "review", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31" },
      { id: "oct", name: "October 2026", kind: "gsr", cadence: "monthly" as const, period_start: "2026-10-01", period_end: "2026-10-31" },
    ];
    // A second November is refused, and so is any month that shares a day with it.
    expect(overlappingCycle(cycles, { kind: "gsr", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" })?.id).toBe("nov");
    expect(overlappingCycle(cycles, { kind: "gsr", cadence: "monthly", period_start: "2026-10-31", period_end: "2026-11-01" })?.id).toBe("oct");
    // A month inside a quarter is the normal shape: different cadences never collide.
    expect(overlappingCycle(cycles, { kind: "review", cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" })).toBeNull();
    expect(overlappingCycle(cycles, { kind: "gsr", cadence: "monthly", period_start: "2026-12-01", period_end: "2026-12-31" })).toBeNull();
    // An edited cycle is never in the way of itself.
    expect(overlappingCycle(cycles, { id: "nov", kind: "gsr", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" })).toBeNull();
    expect(overlapMessage(cycles[0])).toBe('"November 2026" already covers Nov 1 to Nov 30, 2026. Pick dates that do not overlap it, or open that month instead.');
    expect(overlapMessage(cycles[1])).toMatch(/or open that cycle instead\.$/);
    // A quarterly GSR beside a quarterly review is a different kind and never collides.
    expect(overlappingCycle(cycles, { kind: "gsr", cadence: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31" })).toBeNull();
    const week = { id: "w", name: "Sep 14 to Sep 20, 2026", kind: "gsr", cadence: "weekly" as const, period_start: "2026-09-14", period_end: "2026-09-20" };
    expect(overlappingCycle([week], { kind: "gsr", cadence: "weekly", period_start: "2026-09-14", period_end: "2026-09-20" })?.id).toBe("w");
    expect(overlapMessage(week)).toMatch(/or open that week instead\.$/);
  });

  it("keeps an employee's month in play while a quarter covers today, when their GSR in it is unfinished", () => {
    // December 1: November is over but still open with Sam's GSR in progress, December is not
    // opened yet, and Q4 covers today. activeCycles returns only the quarter, so reading the month
    // from it lost November.
    const sam = { id: "sam", gsr_cadence: "monthly" as const };
    const cycles = [
      { id: "q4", kind: "review" as const, cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
      { id: "nov", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
      { id: "oct", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-10-01", period_end: "2026-10-31", status: "open" },
      { id: "sep", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-09-01", period_end: "2026-09-30", status: "closed" },
    ];
    const reviews = [
      { employee_id: "sam", cycle_id: "nov", status: "in_progress" },
      { employee_id: "sam", cycle_id: "oct", status: "in_progress" },
    ];
    const dec1 = new Date(2026, 11, 1, 12);
    expect(gsrCycleInPlayFor(sam, cycles, reviews, dec1)?.id).toBe("nov");
    expect(gsrCycleInPlayFor(sam, [...cycles].reverse(), reviews, dec1)?.id).toBe("nov");
    // Once December is opened it leads, because it covers today.
    const withDec = [...cycles, { id: "dec", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-12-01", period_end: "2026-12-31", status: "open" }];
    expect(gsrCycleInPlayFor(sam, withDec, reviews, dec1)?.id).toBe("dec");
    // November signed off, or never started, is not owed: December is the one to open.
    expect(gsrCycleInPlayFor(sam, cycles, [{ employee_id: "sam", cycle_id: "nov", status: "complete" }], dec1)).toBeNull();
    expect(gsrCycleInPlayFor(sam, cycles, [], dec1)).toBeNull();
    // Someone else's unfinished GSR owes Sam nothing, and nor does a month Sam is left out of.
    expect(gsrCycleInPlayFor(sam, cycles, [{ employee_id: "ana", cycle_id: "nov", status: "in_progress" }], dec1)).toBeNull();
    expect(gsrCycleInPlayFor(sam, cycles, reviews, dec1, ["nov"])?.id).toBe("oct");
    // Every month closed: nothing owed.
    expect(gsrCycleInPlayFor(sam, cycles.map((c) => ({ ...c, status: "closed" })), reviews, dec1)).toBeNull();
  });

  it("never offers a period opened early: the current one is opened instead", () => {
    // October 25: October is closed, and November and December have both been opened early.
    // Nothing begun is owed, so the person's own period, October, is what My GSR offers to open.
    const sam = { id: "sam", gsr_cadence: "monthly" as const };
    const months = [
      { id: "nov", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
      { id: "dec", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-12-01", period_end: "2026-12-31", status: "open" },
    ];
    expect(gsrCycleInPlayFor(sam, months, [], new Date(2026, 9, 25, 12))).toBeNull();
    expect(gsrPeriodFor("monthly", new Date(2026, 9, 25, 12))).toEqual({ period_start: "2026-10-01", period_end: "2026-10-31", name: "October 2026" });
    // A closed period covering today is still the person's: their GSR in it reads as it was left.
    const closedOct = { id: "oct", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-10-01", period_end: "2026-10-31", status: "closed" };
    expect(gsrCycleInPlayFor(sam, [...months, closedOct], [], new Date(2026, 9, 25, 12))?.id).toBe("oct");
  });

  it("reads only the person's own rhythm", () => {
    const sep15 = new Date(2026, 8, 15, 12);
    const cycles = [
      { id: "sep", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2026-09-01", period_end: "2026-09-30", status: "open" },
      { id: "w37", kind: "gsr" as const, cadence: "weekly" as const, period_start: "2026-09-14", period_end: "2026-09-20", status: "open" },
      { id: "w36", kind: "gsr" as const, cadence: "weekly" as const, period_start: "2026-09-07", period_end: "2026-09-13", status: "open" },
      { id: "q3", kind: "review" as const, cadence: "quarterly" as const, period_start: "2026-07-01", period_end: "2026-09-30", status: "open" },
      { id: "q3-gsr", kind: "gsr" as const, cadence: "quarterly" as const, period_start: "2026-07-01", period_end: "2026-09-30", status: "open" },
    ];
    expect(gsrCycleFor({ gsr_cadence: "weekly" }, cycles, sep15)?.id).toBe("w37");
    expect(gsrCycleFor({ gsr_cadence: "monthly" }, cycles, sep15)?.id).toBe("sep");
    // A quarterly GSR, never the scored quarter beside it.
    expect(gsrCycleFor({ gsr_cadence: "quarterly" }, cycles, sep15)?.id).toBe("q3-gsr");
    expect(gsrCycleFor({ gsr_cadence: "biweekly" }, cycles, sep15)).toBeNull();
    // A row without a rhythm reads as monthly.
    expect(gsrCycleFor({}, cycles, sep15)?.id).toBe("sep");
    // Last week, still open and unfinished, is owed only once this week is not open.
    const reviews = [{ employee_id: "mo", cycle_id: "w36", status: "in_progress" }];
    expect(gsrCycleInPlayFor({ id: "mo", gsr_cadence: "weekly" }, cycles, reviews, sep15)?.id).toBe("w37");
    expect(gsrCycleInPlayFor({ id: "mo", gsr_cadence: "weekly" }, cycles.filter((c) => c.id !== "w37"), reviews, sep15)?.id).toBe("w36");
    expect(runsGsrs(cycles)).toBe(true);
    expect(runsGsrs(cycles.filter((c) => c.kind === "review"))).toBe(false);
  });

  it("finds the scored cycle in play by cadence first, so a month never hides the quarter", () => {
    // January 5: January's GSR covers today, Q4 is over but still open, and no Q1 exists. Read
    // across every cadence, the month covering today was all there was, and the quarter whose
    // months the person is being scored on went missing.
    const cycles = [
      { id: "jan", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2027-01-01", period_end: "2027-01-31", status: "open" },
      { id: "q4", kind: "review" as const, cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
      { id: "q3", kind: "review" as const, cadence: "quarterly" as const, period_start: "2026-07-01", period_end: "2026-09-30", status: "closed" },
    ];
    const jan5 = new Date(2027, 0, 5, 12);
    expect(scoredCycleInPlay(cycles, jan5)?.id).toBe("q4");
    expect(scoredCycleInPlay([...cycles].reverse(), jan5)?.id).toBe("q4");
    // Nothing covers today and the most recently started open cycle is a month opened early.
    const between = [
      { id: "feb", kind: "gsr" as const, cadence: "monthly" as const, period_start: "2027-02-01", period_end: "2027-02-28", status: "open" },
      { id: "q4", kind: "review" as const, cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
    ];
    expect(scoredCycleInPlay(between, jan5)?.id).toBe("q4");
    // A quarter covering today leads, ahead of the year it sits in and the quarter still owed.
    const year = { id: "fy", kind: "review" as const, cadence: "annual" as const, period_start: "2027-01-01", period_end: "2027-12-31", status: "open" };
    const q1 = { id: "q1", kind: "review" as const, cadence: "quarterly" as const, period_start: "2027-01-01", period_end: "2027-03-31", status: "open" };
    expect(scoredCycleInPlay([...cycles, year, q1], jan5)?.id).toBe("q1");
    // A quarter opened early comes back when nothing begun is open, the earliest first.
    const q2 = { id: "q2", kind: "review" as const, cadence: "quarterly" as const, period_start: "2027-04-01", period_end: "2027-06-30", status: "open" };
    const q3next = { id: "q3-27", kind: "review" as const, cadence: "quarterly" as const, period_start: "2027-07-01", period_end: "2027-09-30", status: "open" };
    expect(scoredCycleInPlay([q3next, q2], jan5)?.id).toBe("q2");
    expect(scoredCycleInPlay(cycles.filter((c) => c.kind === "gsr"), jan5)).toBeNull();
  });

  it("gives a month no pillar columns, and the locked GSR score only where the company scores GSRs", () => {
    const rating = { scoring_type: "rating", is_active: true };
    const gsr = { scoring_type: "gsr_goals", is_active: true };
    const scored = { kind: "review" as const };
    const period = { kind: "gsr" as const };
    expect(cycleColumns(scored, [rating, gsr])).toEqual({ pillarScores: true, gsrScore: false });
    expect(cycleColumns(scored, [rating])).toEqual({ pillarScores: true, gsrScore: false });
    expect(cycleColumns(period, [rating])).toEqual({ pillarScores: false, gsrScore: false });
    expect(cycleColumns(period, [rating, gsr])).toEqual({ pillarScores: false, gsrScore: true });
    expect(cycleColumns(period, [rating, { ...gsr, is_active: false }])).toEqual({ pillarScores: false, gsrScore: false });
  });

  it("returns every open cycle covering today, shortest first", () => {
    // The real shape: a monthly Goal Setting Review running inside a quarterly scored review.
    // Both cover today, so anything summarising review state has to see both. Picking one is
    // how a review finished in the other gets reported as not started.
    const cycles = [
      { id: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", status: "open" },
      { id: "month", period_start: "2026-09-01", period_end: "2026-09-30", status: "open" },
      { id: "past", period_start: "2026-08-01", period_end: "2026-08-31", status: "open" },
      { id: "shut", period_start: "2026-09-01", period_end: "2026-09-30", status: "closed" },
    ];
    expect(activeCycles(cycles, new Date(2026, 8, 21)).map((c) => c.id)).toEqual(["month", "quarter"]);
    // The answer cannot depend on the order the rows arrived in.
    expect(activeCycles([...cycles].reverse(), new Date(2026, 8, 21)).map((c) => c.id)).toEqual(["month", "quarter"]);
    // Nothing covers today: the most recently started open cycle stands in, on its own.
    expect(activeCycles(cycles, new Date(2026, 11, 1)).map((c) => c.id)).toEqual(["month"]);
    expect(activeCycles([], new Date())).toEqual([]);
  });

  it("keeps an open cycle in play after its period ends, until it is closed", () => {
    // October 23: October's GSR and Q4 cover today, while September's GSR and Q3 are over but
    // still open, with reviews being signed off in them. Closed and not-yet-started cycles are
    // owed nothing.
    const cycles = [
      { id: "q3", period_start: "2026-07-01", period_end: "2026-09-30", status: "open" },
      { id: "sep", period_start: "2026-09-01", period_end: "2026-09-30", status: "open" },
      { id: "aug", period_start: "2026-08-01", period_end: "2026-08-31", status: "closed" },
      { id: "oct", period_start: "2026-10-01", period_end: "2026-10-31", status: "open" },
      { id: "q4", period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
      { id: "nov", period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
    ];
    const today = new Date(2026, 9, 23);
    expect(cyclesInPlay(cycles, today).map((c) => c.id)).toEqual(["oct", "q4", "sep", "q3"]);
    expect(cyclesInPlay([...cycles].reverse(), today).map((c) => c.id)).toEqual(["oct", "q4", "sep", "q3"]);
    // Nothing covers today: activeCycles' stand-in leads, and the ended ones still follow.
    const between = cycles.filter((c) => c.id === "sep" || c.id === "nov");
    expect(cyclesInPlay(between, today).map((c) => c.id)).toEqual(["nov", "sep"]);
    expect(cyclesInPlay([], today)).toEqual([]);
  });

  it("covers everybody active in a cycle, less anyone an admin left out of it", () => {
    const people = [
      { id: "ana", is_active: true },
      { id: "ben", is_active: true },
      { id: "cy", is_active: true },
      { id: "dee", is_active: false },
    ];
    const omissions = [{ cycle_id: "oct", employee_id: "ben" }, { cycle_id: "nov", employee_id: "cy" }];
    // Progress counts only the people in the cycle: everyone October covers has signed off, and
    // the review set aside for the person left out is not owed.
    const reviews = [
      { employee_id: "ana", cycle_id: "oct", status: "complete" },
      { employee_id: "cy", cycle_id: "oct", status: "complete" },
      { employee_id: "ben", cycle_id: "oct", status: "in_progress" },
    ];
    expect(cycleRoster(people, reviews, review("oct"), omissions).map((p) => p.id)).toEqual(["ana", "cy"]);
    expect(cycleRoster(people, reviews, review("nov"), omissions).map((p) => p.id)).toEqual(["ana", "ben"]);
    expect(cycleRoster(people, reviews, review("dec"), omissions).map((p) => p.id)).toEqual(["ana", "ben", "cy"]);
    expect(isOmitted(omissions, "oct", "ben")).toBe(true);
    expect(isOmitted(omissions, "nov", "ben")).toBe(false);
    expect(cycleProgress(cycleRoster(people, reviews, review("oct"), omissions), reviews, "oct")).toEqual({ complete: 2, total: 2 });
  });

  it("finds the GSR periods that ran inside a scored period, oldest first", () => {
    const cycles = [
      { id: "q3", kind: "review" as const, cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" },
      { id: "sep", kind: "gsr" as const, cadence: "monthly", period_start: "2026-09-01", period_end: "2026-09-30" },
      { id: "jul", kind: "gsr" as const, cadence: "monthly", period_start: "2026-07-01", period_end: "2026-07-31" },
      { id: "jun", kind: "gsr" as const, cadence: "monthly", period_start: "2026-06-01", period_end: "2026-06-30" },
      { id: "oct", kind: "gsr" as const, cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31" },
    ];
    expect(gsrPeriodsWithin(cycles[0], cycles).map((c) => c.id)).toEqual(["jul", "sep"]);
    // A custom period straddling a month boundary counts only the months it wholly covers.
    expect(gsrPeriodsWithin({ period_start: "2026-07-15", period_end: "2026-09-30" }, cycles).map((c) => c.id)).toEqual(["sep"]);
    expect(gsrPeriodsWithin({ period_start: "2026-01-01", period_end: "2026-03-31" }, cycles)).toEqual([]);
  });

  it("reads one person's GSR periods inside a scored period: their rhythm, and any they have a GSR in", () => {
    const q3 = { period_start: "2026-07-01", period_end: "2026-09-30" };
    const cycles = [
      { id: "q3", kind: "review" as const, cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" },
      { id: "q3-gsr", kind: "gsr" as const, cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" },
      { id: "jul", kind: "gsr" as const, cadence: "monthly", period_start: "2026-07-01", period_end: "2026-07-31" },
      { id: "w37", kind: "gsr" as const, cadence: "weekly", period_start: "2026-09-14", period_end: "2026-09-20" },
      { id: "w36", kind: "gsr" as const, cadence: "weekly", period_start: "2026-09-07", period_end: "2026-09-13" },
      { id: "b", kind: "gsr" as const, cadence: "biweekly", period_start: "2026-09-07", period_end: "2026-09-20" },
      // Ends after the quarter does, so it is never counted under it.
      { id: "w40", kind: "gsr" as const, cadence: "weekly", period_start: "2026-09-28", period_end: "2026-10-04" },
    ];
    expect(gsrPeriodsWithin(q3, cycles, "weekly").map((c) => c.id)).toEqual(["w36", "w37"]);
    expect(gsrPeriodsWithin(q3, cycles, "monthly").map((c) => c.id)).toEqual(["jul"]);
    expect(gsrPeriodsWithin(q3, cycles, "quarterly").map((c) => c.id)).toEqual(["q3-gsr"]);
    expect(gsrPeriodsWithin(q3, cycles, "biweekly").map((c) => c.id)).toEqual(["b"]);
    // Moved from monthly to weekly mid-quarter: July's GSR keeps its place beside the weeks.
    expect(gsrPeriodsWithin(q3, cycles, "weekly", ["jul"]).map((c) => c.id)).toEqual(["jul", "w36", "w37"]);
    // Without a person, every GSR period inside, of every rhythm, oldest first and the shorter of
    // two that start together first.
    expect(gsrPeriodsWithin(q3, cycles).map((c) => c.id)).toEqual(["jul", "q3-gsr", "w36", "b", "w37"]);
  });

  it("picks the open cycle containing today, else the latest open one", () => {
    const cycles = [
      { id: "a", period_start: "2026-08-01", period_end: "2026-08-31", status: "open" },
      { id: "b", period_start: "2026-09-01", period_end: "2026-09-30", status: "open" },
      { id: "c", period_start: "2026-10-01", period_end: "2026-10-31", status: "closed" },
    ];
    expect(currentCycle(cycles, new Date(2026, 8, 15))?.id).toBe("b");
    expect(currentCycle(cycles, new Date(2026, 11, 1))?.id).toBe("b");
    expect(currentCycle([], new Date())).toBeNull();
  });
});

describe("cycleRoster", () => {
  const people = [
    { id: "a", is_active: true },
    { id: "b", is_active: false },
    { id: "c", is_active: false },
    { id: "d", is_active: true },
  ];
  const reviews = [
    { employee_id: "a", cycle_id: "q3", status: "complete" },
    { employee_id: "b", cycle_id: "q3", status: "complete" },
    { employee_id: "c", cycle_id: "q3", status: "in_progress" },
    { employee_id: "c", cycle_id: "q2", status: "complete" },
  ];
  it("keeps a deactivated person whose review in this cycle was signed off, and only them", () => {
    expect(cycleRoster(people, reviews, review("q3")).map((p) => p.id)).toEqual(["a", "b", "d"]);
    expect(cycleRoster(people, reviews, review("q2")).map((p) => p.id)).toEqual(["a", "c", "d"]);
    expect(cycleRoster(people, reviews, review("q4")).map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("takes out anyone omitted from this cycle, and only from this cycle", () => {
    const omissions = [
      { cycle_id: "q3", employee_id: "d" },
      { cycle_id: "q2", employee_id: "a" },
    ];
    expect(cycleRoster(people, reviews, review("q3"), omissions).map((p) => p.id)).toEqual(["a", "b"]);
    expect(cycleRoster(people, reviews, review("q4"), omissions).map((p) => p.id)).toEqual(["a", "d"]);
    // No omissions reads exactly as the deactivation rule alone.
    expect(cycleRoster(people, reviews, review("q3"), [])).toEqual(cycleRoster(people, reviews, review("q3")));
  });

  it("keeps a person whose review in this cycle is signed off, whatever the omission rows say", () => {
    // The database refuses to omit a signed-off review, so a row like this is stale: the signed-off
    // review is the record and stays counted, active or deactivated since.
    const omissions = [
      { cycle_id: "q3", employee_id: "a" },
      { cycle_id: "q3", employee_id: "b" },
      { cycle_id: "q3", employee_id: "c" },
    ];
    expect(cycleRoster(people, reviews, review("q3"), omissions).map((p) => p.id)).toEqual(["a", "b", "d"]);
    expect(cycleProgress(cycleRoster(people, reviews, review("q3"), omissions), reviews, "q3")).toEqual({ complete: 2, total: 3 });
    // An omitted person whose review is still open is out, so it is not owed.
    const open = [{ employee_id: "d", cycle_id: "q3", status: "in_progress" }];
    expect(cycleRoster(people, [...reviews, ...open], review("q3"), [{ cycle_id: "q3", employee_id: "d" }]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("lists who is left out: active, omitted here, and not kept in by a signed-off review", () => {
    const omissions = [
      { cycle_id: "q3", employee_id: "a" },
      { cycle_id: "q3", employee_id: "c" },
      { cycle_id: "q3", employee_id: "d" },
      { cycle_id: "q2", employee_id: "a" },
    ];
    // a is signed off (stays in the cycle), c is deactivated (out of it either way), d is out.
    expect(cycleOmitted(people, reviews, review("q3"), omissions).map((p) => p.id)).toEqual(["d"]);
    expect(cycleOmitted(people, reviews, review("q2"), omissions).map((p) => p.id)).toEqual(["a"]);
    expect(cycleOmitted(people, reviews, review("q4"), omissions)).toEqual([]);
  });

  it("reads the cycles one person is left out of the way the roster does", () => {
    const omissions = [
      { cycle_id: "q3", employee_id: "a" },
      { cycle_id: "q4", employee_id: "a" },
      { cycle_id: "q4", employee_id: "d" },
    ];
    // a's q3 review is signed off, so the q3 row never reaches it; q4 is still open to omit.
    expect(omittedCycleIdsFor(omissions, reviews, "a")).toEqual(["q4"]);
    expect(omittedCycleIdsFor(omissions, reviews, "d")).toEqual(["q4"]);
    expect(omittedCycleIdsFor(omissions, reviews, "b")).toEqual([]);
  });
});

describe("GSR rhythms", () => {
  it("runs a week Monday to Sunday, across month and year ends", () => {
    // Tuesday September 15, 2026 is in the week of Monday the 14th.
    expect(periodStart("weekly", new Date(2026, 8, 15))).toBe("2026-09-14");
    expect(periodStart("weekly", new Date(2026, 8, 14))).toBe("2026-09-14");
    // A Sunday belongs to the week that began the Monday before it.
    expect(periodStart("weekly", new Date(2026, 8, 20))).toBe("2026-09-14");
    expect(periodEnd("weekly", "2026-09-14")).toBe("2026-09-20");
    // Friday January 1, 2027 is in the week of Monday December 28, 2026, which ends in 2027.
    expect(periodStart("weekly", new Date(2027, 0, 1))).toBe("2026-12-28");
    expect(periodEnd("weekly", "2026-12-28")).toBe("2027-01-03");
    // Across the end of February in a leap year.
    expect(periodEnd("weekly", "2028-02-28")).toBe("2028-03-05");
  });

  it("counts two-week blocks of Mondays from Monday 2024-01-01, both ways", () => {
    // The anchor and the day before the next block.
    expect(periodStart("biweekly", new Date(2024, 0, 1))).toBe("2024-01-01");
    expect(periodStart("biweekly", new Date(2024, 0, 14))).toBe("2024-01-01");
    expect(periodStart("biweekly", new Date(2024, 0, 15))).toBe("2024-01-15");
    expect(periodEnd("biweekly", "2024-01-01")).toBe("2024-01-14");
    // September 15, 2026: 140 weeks after the anchor is Monday September 7, an even week, so the
    // block runs September 7 to 20.
    expect(periodStart("biweekly", new Date(2026, 8, 15))).toBe("2026-09-07");
    expect(periodStart("biweekly", new Date(2026, 8, 21))).toBe("2026-09-21");
    expect(periodEnd("biweekly", "2026-09-07")).toBe("2026-09-20");
    // Across a year end: the block holding January 1, 2027.
    expect(periodStart("biweekly", new Date(2027, 0, 1))).toBe("2026-12-28");
    expect(periodEnd("biweekly", "2026-12-28")).toBe("2027-01-10");
    // Before the anchor, blocks count backwards on the same grid.
    expect(periodStart("biweekly", new Date(2023, 11, 31))).toBe("2023-12-18");
    expect(periodStart("biweekly", new Date(2023, 11, 17))).toBe("2023-12-04");
  });

  it("keeps the same day a day across a daylight saving change", () => {
    // US clocks move on March 8 and November 1, 2026; the week and the block still hold.
    expect(periodStart("weekly", new Date(2026, 2, 10))).toBe("2026-03-09");
    expect(periodStart("weekly", new Date(2026, 10, 2))).toBe("2026-11-02");
    expect(periodStart("biweekly", new Date(2026, 10, 2))).toBe("2026-11-02");
  });

  it("names a week and two weeks the way people say them", () => {
    // The same words the database gives a period a member opens (private.gsr_period_name, 0040).
    expect(defaultCycleName("weekly", "2026-09-14")).toBe("Sep 14 to Sep 20, 2026");
    expect(defaultCycleName("weekly", "2026-12-28")).toBe("Dec 28, 2026 to Jan 3, 2027");
    expect(defaultCycleName("biweekly", "2026-09-07")).toBe("Sep 7 to Sep 20, 2026");
    expect(defaultCycleName("biweekly", "2026-12-28")).toBe("Dec 28, 2026 to Jan 10, 2027");
    expect(gsrPeriodFor("weekly", new Date(2026, 8, 15))).toEqual({ period_start: "2026-09-14", period_end: "2026-09-20", name: "Sep 14 to Sep 20, 2026" });
    expect(gsrPeriodFor("biweekly", new Date(2026, 8, 15))).toEqual({ period_start: "2026-09-07", period_end: "2026-09-20", name: "Sep 7 to Sep 20, 2026" });
    expect(gsrPeriodFor("quarterly", new Date(2026, 8, 15))).toEqual({ period_start: "2026-07-01", period_end: "2026-09-30", name: "Q3 2026" });
  });

  it("knows a canonical period from one that is not", () => {
    expect(isCanonicalPeriod("weekly", "2026-09-14", "2026-09-20")).toBe(true);
    expect(isCanonicalPeriod("weekly", "2026-09-15", "2026-09-21")).toBe(false);
    expect(isCanonicalPeriod("biweekly", "2026-09-07", "2026-09-20")).toBe(true);
    expect(isCanonicalPeriod("biweekly", "2026-09-14", "2026-09-27")).toBe(false);
    expect(isCanonicalPeriod("monthly", "2026-09-01", "2026-09-30")).toBe(true);
    expect(isCanonicalPeriod("monthly", "2026-09-01", "2026-09-29")).toBe(false);
    expect(isCanonicalPeriod("quarterly", "2026-07-01", "2026-09-30")).toBe(true);
    expect(isCanonicalPeriod("custom", "2026-07-01", "2026-09-30")).toBe(false);
  });

  // The same periods, refusals and names 0040's SQL test asserts for private.gsr_period_ok and
  // private.gsr_period_name (case periods_match_the_app), so the two sides cannot drift apart.
  it("agrees with the database on the periods around a year end, the anchor, a leap February and a fourth quarter", () => {
    const canonical: Array<[GsrCadence, string, string, string]> = [
      ["weekly", "2026-12-28", "2027-01-03", "Dec 28, 2026 to Jan 3, 2027"],
      ["biweekly", "2026-12-14", "2026-12-27", "Dec 14 to Dec 27, 2026"],
      ["biweekly", "2026-12-28", "2027-01-10", "Dec 28, 2026 to Jan 10, 2027"],
      ["biweekly", "2027-01-11", "2027-01-24", "Jan 11 to Jan 24, 2027"],
      ["biweekly", "2023-12-18", "2023-12-31", "Dec 18 to Dec 31, 2023"],
      ["biweekly", "2024-01-01", "2024-01-14", "Jan 1 to Jan 14, 2024"],
      ["monthly", "2028-02-01", "2028-02-29", "February 2028"],
      ["quarterly", "2026-10-01", "2026-12-31", "Q4 2026"],
    ];
    for (const [cadence, start, end, name] of canonical) {
      expect(isCanonicalPeriod(cadence, start, end)).toBe(true);
      expect(defaultCycleName(cadence, start, end)).toBe(name);
      expect(gsrPeriodFor(cadence, parseDate(start)!)).toEqual({ period_start: start, period_end: end, name });
      expect(gsrPeriodFor(cadence, parseDate(end)!)).toEqual({ period_start: start, period_end: end, name });
    }
    const refused: Array<[GsrCadence, string, string]> = [
      ["weekly", "2026-12-29", "2027-01-04"],
      ["weekly", "2026-12-28", "2027-01-04"],
      ["biweekly", "2027-01-04", "2027-01-17"],
      ["biweekly", "2023-12-25", "2024-01-07"],
      ["biweekly", "2026-12-28", "2027-01-03"],
      ["monthly", "2028-02-01", "2028-02-28"],
      ["quarterly", "2026-10-01", "2026-12-30"],
      ["quarterly", "2026-11-01", "2027-01-31"],
    ];
    for (const [cadence, start, end] of refused) expect(isCanonicalPeriod(cadence, start, end)).toBe(false);
    // Monday January 11, 2027 opens a block; the Sunday before it closes the block of December 28.
    expect(gsrPeriodFor("biweekly", new Date(2027, 0, 10)).period_start).toBe("2026-12-28");
    expect(gsrPeriodFor("biweekly", new Date(2027, 0, 11)).period_start).toBe("2027-01-11");
  });

  it("files a cycle by kind, never by cadence", () => {
    expect(sectionOf({ kind: "gsr" })).toBe("gsr");
    expect(sectionOf({ kind: "review" })).toBe("reviews");
    expect(reviewPath("r1", { kind: "gsr" })).toBe("/gsr/reviews/r1");
    expect(reviewPath("r1", { kind: "review" })).toBe("/reviews/r1");
  });

  it("finds the previous period of the same kind and rhythm", () => {
    const cycles = [
      { id: "w36", kind: "gsr" as const, cadence: "weekly", period_start: "2026-09-07" },
      { id: "w37", kind: "gsr" as const, cadence: "weekly", period_start: "2026-09-14" },
      { id: "sep", kind: "gsr" as const, cadence: "monthly", period_start: "2026-09-01" },
      { id: "aug", kind: "gsr" as const, cadence: "monthly", period_start: "2026-08-01" },
      { id: "q3", kind: "review" as const, cadence: "quarterly", period_start: "2026-07-01" },
      { id: "q2-gsr", kind: "gsr" as const, cadence: "quarterly", period_start: "2026-04-01" },
      { id: "q3-gsr", kind: "gsr" as const, cadence: "quarterly", period_start: "2026-07-01" },
    ];
    expect(previousCycle(cycles, cycles[1])?.id).toBe("w36");
    expect(previousCycle(cycles, cycles[2])?.id).toBe("aug");
    expect(previousCycle(cycles, cycles[6])?.id).toBe("q2-gsr");
    // The scored quarter has no earlier review, whatever GSR quarters sit before it.
    expect(previousCycle(cycles, cycles[4])).toBeNull();
  });

  it("reads each rhythm in its own words", () => {
    expect(gsrPeriodCopy("weekly")).toMatchObject({ this: "this week", last: "last week", heading: "This week's GSR", noun: "week" });
    expect(gsrPeriodCopy("biweekly")).toMatchObject({ this: "these two weeks", heading: "These two weeks' GSR", every: "every two weeks" });
    expect(gsrPeriodCopy("monthly")).toMatchObject({ this: "this month", last: "last month", heading: "This month's GSR", plural: "months" });
    expect(gsrPeriodCopy("quarterly")).toMatchObject({ this: "this quarter", heading: "This quarter's GSR" });
  });
});

describe("cycleRoster by rhythm", () => {
  const people = [
    { id: "mo", is_active: true, gsr_cadence: "monthly" as const },
    { id: "wk", is_active: true, gsr_cadence: "weekly" as const },
    { id: "was-weekly", is_active: true, gsr_cadence: "monthly" as const },
    { id: "old", is_active: true },
  ];
  const week = { id: "w37", kind: "gsr" as const, cadence: "weekly" as const };
  const month = { id: "sep", kind: "gsr" as const, cadence: "monthly" as const };
  const quarter = { id: "q3", kind: "review" as const, cadence: "quarterly" as const };

  it("covers only the people on a GSR period's rhythm, and everybody in a scored review", () => {
    expect(cycleRoster(people, [], week).map((p) => p.id)).toEqual(["wk"]);
    // A person with no rhythm on their row reads as monthly.
    expect(cycleRoster(people, [], month).map((p) => p.id)).toEqual(["mo", "was-weekly", "old"]);
    expect(cycleRoster(people, [], quarter).map((p) => p.id)).toEqual(["mo", "wk", "was-weekly", "old"]);
  });

  it("keeps a signed-off GSR after the person's rhythm changes, and lets an unfinished one go", () => {
    const reviews = [
      { employee_id: "was-weekly", cycle_id: "w37", status: "complete" },
      { employee_id: "mo", cycle_id: "w37", status: "in_progress" },
    ];
    expect(cycleRoster(people, reviews, week).map((p) => p.id)).toEqual(["wk", "was-weekly"]);
    expect(cycleProgress(cycleRoster(people, reviews, week), reviews, "w37")).toEqual({ complete: 1, total: 2 });
  });

  it("lists as left out only the people the period would otherwise cover", () => {
    const omissions = [{ cycle_id: "w37", employee_id: "wk" }, { cycle_id: "w37", employee_id: "mo" }];
    expect(cycleRoster(people, [], week, omissions)).toEqual([]);
    expect(cycleOmitted(people, [], week, omissions).map((p) => p.id)).toEqual(["wk"]);
  });
});
