import { describe, expect, it } from "vitest";
import { activeCycles, currentCycle, defaultCycleName, periodEnd, periodStart } from "./cycles.ts";

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
