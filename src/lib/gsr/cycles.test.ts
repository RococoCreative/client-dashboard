// Pins the cycle rules every GSR screen shares: periods, cadences, which cycles are in play,
// default names, and the months inside a quarter.
import { describe, expect, it } from "vitest";
import { activeCycles, currentCycle, cycleColumns, cyclesInPlay, defaultCycleName, gsrCycleInPlay, monthsWithin, overlapMessage, overlappingCycle, periodEnd, periodStart, scoredCycleInPlay } from "./cycles.ts";

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
      { id: "nov", name: "November 2026", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" },
      { id: "q4", name: "Q4 2026", cadence: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31" },
      { id: "oct", name: "October 2026", cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31" },
    ];
    // A second November is refused, and so is any month that shares a day with it.
    expect(overlappingCycle(cycles, { cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" })?.id).toBe("nov");
    expect(overlappingCycle(cycles, { cadence: "monthly", period_start: "2026-10-31", period_end: "2026-11-01" })?.id).toBe("oct");
    // A month inside a quarter is the normal shape: different cadences never collide.
    expect(overlappingCycle(cycles, { cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" })).toBeNull();
    expect(overlappingCycle(cycles, { cadence: "monthly", period_start: "2026-12-01", period_end: "2026-12-31" })).toBeNull();
    // An edited cycle is never in the way of itself.
    expect(overlappingCycle(cycles, { id: "nov", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" })).toBeNull();
    expect(overlapMessage(cycles[0])).toBe('"November 2026" already covers Nov 1 to Nov 30, 2026. Pick dates that do not overlap it, or open that month instead.');
    expect(overlapMessage(cycles[1])).toMatch(/or open that cycle instead\.$/);
  });

  it("keeps an employee's month in play while a quarter covers today", () => {
    // December 1: November is over but still open, December is not opened yet, and Q4 covers
    // today. activeCycles returns only the quarter, so reading the month from it lost November.
    const cycles = [
      { id: "q4", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
      { id: "nov", cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
      { id: "oct", cadence: "monthly" as const, period_start: "2026-10-01", period_end: "2026-10-31", status: "open" },
      { id: "sep", cadence: "monthly" as const, period_start: "2026-09-01", period_end: "2026-09-30", status: "closed" },
    ];
    expect(gsrCycleInPlay(cycles, new Date(2026, 11, 1))?.id).toBe("nov");
    // Once December is opened it leads, because it covers today.
    const withDec = [...cycles, { id: "dec", cadence: "monthly" as const, period_start: "2026-12-01", period_end: "2026-12-31", status: "open" }];
    expect(gsrCycleInPlay(withDec, new Date(2026, 11, 1))?.id).toBe("dec");
    // Every month closed: nothing to work in.
    expect(gsrCycleInPlay(cycles.map((c) => ({ ...c, status: c.cadence === "monthly" ? "closed" : c.status })), new Date(2026, 11, 1))).toBeNull();
  });

  it("keeps the ended month still owed ahead of a month opened early, with or without a quarter", () => {
    // December 1: November is over but still open, December is not opened, and January has been
    // opened early. Nothing covers today, so activeCycles' stand-in is January, which has not
    // begun. The employee still owes November, and a quarter existing or not cannot change that.
    const months = [
      { id: "nov", cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
      { id: "jan", cadence: "monthly" as const, period_start: "2027-01-01", period_end: "2027-01-31", status: "open" },
    ];
    const dec1 = new Date(2026, 11, 1, 12);
    expect(gsrCycleInPlay(months, dec1)?.id).toBe("nov");
    expect(gsrCycleInPlay([...months].reverse(), dec1)?.id).toBe("nov");
    const q4 = { id: "q4", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" };
    expect(gsrCycleInPlay([...months, q4], dec1)?.id).toBe("nov");
    // A month opened early still comes back when it is the only open month, quarter or not.
    const novClosed = months.map((c) => (c.id === "nov" ? { ...c, status: "closed" } : c));
    expect(gsrCycleInPlay(novClosed, dec1)?.id).toBe("jan");
    expect(gsrCycleInPlay([...novClosed, q4], dec1)?.id).toBe("jan");
  });

  it("opens the earliest month opened early when no open month has begun", () => {
    // October 25: October is closed, and November and December have both been opened early.
    // Nothing begun is owed, so the next month is the one to work in, not the furthest.
    const months = [
      { id: "oct", cadence: "monthly" as const, period_start: "2026-10-01", period_end: "2026-10-31", status: "closed" },
      { id: "nov", cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
      { id: "dec", cadence: "monthly" as const, period_start: "2026-12-01", period_end: "2026-12-31", status: "open" },
    ];
    const oct25 = new Date(2026, 9, 25, 12);
    expect(gsrCycleInPlay(months, oct25)?.id).toBe("nov");
    expect(gsrCycleInPlay([...months].reverse(), oct25)?.id).toBe("nov");
    // A quarter covering today changes nothing.
    const q4 = { id: "q4", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" };
    expect(gsrCycleInPlay([q4, ...months], oct25)?.id).toBe("nov");
    // Two months starting together (a twin the dialogs now refuse) still give one stable answer.
    const twin = { id: "nov-b", cadence: "monthly" as const, period_start: "2026-11-01", period_end: "2026-11-30", status: "open" };
    expect(gsrCycleInPlay([twin, ...months], oct25)?.id).toBe("nov");
    expect(gsrCycleInPlay([...months, twin].reverse(), oct25)?.id).toBe("nov");
  });

  it("finds the scored cycle in play by cadence first, so a month never hides the quarter", () => {
    // January 5: January's GSR covers today, Q4 is over but still open, and no Q1 exists. Read
    // across every cadence, the month covering today was all there was, and the quarter whose
    // months the person is being scored on went missing.
    const cycles = [
      { id: "jan", cadence: "monthly" as const, period_start: "2027-01-01", period_end: "2027-01-31", status: "open" },
      { id: "q4", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
      { id: "q3", cadence: "quarterly" as const, period_start: "2026-07-01", period_end: "2026-09-30", status: "closed" },
    ];
    const jan5 = new Date(2027, 0, 5, 12);
    expect(scoredCycleInPlay(cycles, jan5)?.id).toBe("q4");
    expect(scoredCycleInPlay([...cycles].reverse(), jan5)?.id).toBe("q4");
    // Nothing covers today and the most recently started open cycle is a month opened early.
    const between = [
      { id: "feb", cadence: "monthly" as const, period_start: "2027-02-01", period_end: "2027-02-28", status: "open" },
      { id: "q4", cadence: "quarterly" as const, period_start: "2026-10-01", period_end: "2026-12-31", status: "open" },
    ];
    expect(scoredCycleInPlay(between, jan5)?.id).toBe("q4");
    // A quarter covering today leads, ahead of the year it sits in and the quarter still owed.
    const year = { id: "fy", cadence: "annual" as const, period_start: "2027-01-01", period_end: "2027-12-31", status: "open" };
    const q1 = { id: "q1", cadence: "quarterly" as const, period_start: "2027-01-01", period_end: "2027-03-31", status: "open" };
    expect(scoredCycleInPlay([...cycles, year, q1], jan5)?.id).toBe("q1");
    // A quarter opened early comes back when nothing begun is open, the earliest first.
    const q2 = { id: "q2", cadence: "quarterly" as const, period_start: "2027-04-01", period_end: "2027-06-30", status: "open" };
    const q3next = { id: "q3-27", cadence: "quarterly" as const, period_start: "2027-07-01", period_end: "2027-09-30", status: "open" };
    expect(scoredCycleInPlay([q3next, q2], jan5)?.id).toBe("q2");
    expect(scoredCycleInPlay(cycles.filter((c) => c.cadence === "monthly"), jan5)).toBeNull();
  });

  it("gives a month no pillar columns, and the locked GSR score only where the company scores GSRs", () => {
    const rating = { scoring_type: "rating", is_active: true };
    const gsr = { scoring_type: "gsr_goals", is_active: true };
    expect(cycleColumns("quarterly", [rating, gsr])).toEqual({ pillarScores: true, gsrScore: false });
    expect(cycleColumns("custom", [rating])).toEqual({ pillarScores: true, gsrScore: false });
    expect(cycleColumns("monthly", [rating])).toEqual({ pillarScores: false, gsrScore: false });
    expect(cycleColumns("monthly", [rating, gsr])).toEqual({ pillarScores: false, gsrScore: true });
    expect(cycleColumns("monthly", [rating, { ...gsr, is_active: false }])).toEqual({ pillarScores: false, gsrScore: false });
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

  it("finds the months that ran inside a scored period, oldest first", () => {
    const cycles = [
      { id: "q3", cadence: "quarterly", period_start: "2026-07-01", period_end: "2026-09-30" },
      { id: "sep", cadence: "monthly", period_start: "2026-09-01", period_end: "2026-09-30" },
      { id: "jul", cadence: "monthly", period_start: "2026-07-01", period_end: "2026-07-31" },
      { id: "jun", cadence: "monthly", period_start: "2026-06-01", period_end: "2026-06-30" },
      { id: "oct", cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31" },
    ];
    expect(monthsWithin(cycles[0], cycles).map((c) => c.id)).toEqual(["jul", "sep"]);
    // A custom period straddling a month boundary counts only the months it wholly covers.
    expect(monthsWithin({ period_start: "2026-07-15", period_end: "2026-09-30" }, cycles).map((c) => c.id)).toEqual(["sep"]);
    expect(monthsWithin({ period_start: "2026-01-01", period_end: "2026-03-31" }, cycles)).toEqual([]);
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
