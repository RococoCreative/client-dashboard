// The Goal Setting Review rules: progress to status, hit or miss, the order goals are read in,
// carry forward, splitting, and the period a yearly goal belongs to.
import { describe, expect, it } from "vitest";
import { carryForward, goalOutcome, goalPeriodLabel, goalSettled, hitCount, monthLocked, monthTotal, progressPatch, rankGoals, requiredAndStretch, scoreGsrMonths, scoreMonth, splitGoals } from "./goals.ts";
import type { Goal } from "../../types/database.ts";

function goal(over: Partial<Goal>): Goal {
  return {
    id: "g",
    company_id: "c",
    employee_id: "e",
    cycle_id: "cycle-1",
    kind: "professional",
    is_focus: false,
    title: "Ship it",
    description: "Done means shipped.",
    status: "in_progress",
    action_steps: [
      { text: "Draft", done: true },
      { text: "Review", done: false },
    ],
    progress: 40,
    scope: "cycle",
    year: null,
    carried_from_goal_id: null,
    outcome_note: null,
    sort_order: 2,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("progressPatch", () => {
  it("marks 100 achieved and reopens when moved back", () => {
    expect(progressPatch(100, "in_progress")).toEqual({ progress: 100, status: "achieved" });
    expect(progressPatch(60, "achieved")).toEqual({ progress: 60, status: "in_progress" });
    expect(progressPatch(0, "achieved")).toEqual({ progress: 0, status: "not_started" });
  });
  it("starts a goal on the first movement and clamps the range", () => {
    expect(progressPatch(5, "not_started")).toEqual({ progress: 5, status: "in_progress" });
    expect(progressPatch(140, "not_started")).toEqual({ progress: 100, status: "achieved" });
    expect(progressPatch(-3, "on_track")).toEqual({ progress: 0, status: "on_track" });
  });
});

describe("goalOutcome", () => {
  it("reads 100 as a hit, less as a miss once settled, and open while the period runs", () => {
    expect(goalOutcome({ progress: 100, status: "achieved" }, true)).toBe("hit");
    expect(goalOutcome({ progress: 55, status: "in_progress" }, true)).toBe("miss");
    expect(goalOutcome({ progress: 55, status: "in_progress" }, false)).toBe("open");
  });
  it("counts hits", () => {
    expect(hitCount([goal({ progress: 100 }), goal({ id: "b", progress: 10 })], true)).toEqual({ hit: 1, total: 2 });
  });
});

describe("rankGoals", () => {
  it("reads the focus topic's GSR first, then role goals, then professional, and personal last", () => {
    const list = [
      goal({ id: "personal", kind: "personal", sort_order: 1 }),
      goal({ id: "pro-late", kind: "professional", sort_order: 4 }),
      goal({ id: "focus", kind: "professional", is_focus: true, sort_order: 5 }),
      goal({ id: "pro-early", kind: "professional", sort_order: 2 }),
      goal({ id: "role", kind: "role", sort_order: 3 }),
    ];
    expect(rankGoals(list).map((g) => g.id)).toEqual(["focus", "role", "pro-early", "pro-late", "personal"]);
  });
  it("keeps the order goals were filed in within a kind, and leaves the list it was given alone", () => {
    const list = [
      goal({ id: "second", sort_order: 1, created_at: "2026-09-02T00:00:00Z" }),
      goal({ id: "first", sort_order: 1, created_at: "2026-09-01T00:00:00Z" }),
    ];
    expect(rankGoals(list).map((g) => g.id)).toEqual(["first", "second"]);
    expect(list.map((g) => g.id)).toEqual(["second", "first"]);
  });
});

describe("carryForward", () => {
  it("restates the goal for the next cycle with only the steps not taken", () => {
    const carried = carryForward(goal({ is_focus: true }), "cycle-2");
    // The new month's focus GSR comes from the new month's topic, so a carried goal is not it.
    expect(carried).toMatchObject({ title: "Ship it", cycle_id: "cycle-2", scope: "cycle", progress: 0, status: "not_started", carried_from_goal_id: "g", is_focus: false });
    expect(carried.action_steps).toEqual([{ text: "Review", done: false }]);
  });
});

describe("splitGoals", () => {
  it("separates this cycle, last cycle, and the year's goals", () => {
    const list = [
      goal({ id: "now", cycle_id: "cycle-2", sort_order: 2 }),
      goal({ id: "now-first", cycle_id: "cycle-2", sort_order: 1 }),
      goal({ id: "then", cycle_id: "cycle-1" }),
      goal({ id: "year", scope: "year", year: 2026, cycle_id: null }),
      goal({ id: "other-year", scope: "year", year: 2025, cycle_id: null }),
    ];
    const split = splitGoals(list, { cycleId: "cycle-2", previousCycleId: "cycle-1", year: 2026 });
    expect(split.thisCycle.map((g) => g.id)).toEqual(["now-first", "now"]);
    expect(split.lastCycle.map((g) => g.id)).toEqual(["then"]);
    expect(split.yearly.map((g) => g.id)).toEqual(["year"]);
    expect(splitGoals(list, { cycleId: "cycle-2", previousCycleId: null, year: 2026 }).lastCycle).toEqual([]);
  });
});

describe("when a goal's period is over", () => {
  const cycles = [
    { id: "open-now", status: "open", period_end: "2026-12-31" },
    { id: "over", status: "open", period_end: "2026-08-31" },
    { id: "shut", status: "closed", period_end: "2026-12-31" },
  ];
  const today = new Date(2026, 8, 21);
  const yearly = (year: number | null) => ({ scope: "year" as const, year, cycle_id: null });
  const onCycle = (cycleId: string | null) => ({ scope: "cycle" as const, year: null, cycle_id: cycleId });

  it("settles a yearly goal once its year is behind us", () => {
    expect(goalSettled(yearly(2025), cycles, today)).toBe(true);
    expect(goalSettled(yearly(2026), cycles, today)).toBe(false);
    expect(goalSettled(yearly(null), cycles, today)).toBe(false);
  });

  it("never settles a BHAG: it stays open until it is hit", () => {
    const bhag = { scope: "bhag" as const, year: null, cycle_id: null };
    expect(goalSettled(bhag, cycles, new Date(2031, 0, 1))).toBe(false);
    expect(goalOutcome({ progress: 60, status: "in_progress", ...bhag }, goalSettled(bhag, cycles, today))).toBe("open");
  });

  it("settles a cycle goal when its cycle is closed or its period is over", () => {
    expect(goalSettled(onCycle("open-now"), cycles, today)).toBe(false);
    expect(goalSettled(onCycle("over"), cycles, today)).toBe(true);
    expect(goalSettled(onCycle("shut"), cycles, today)).toBe(true);
    // A goal whose cycle was deleted has no period to be over.
    expect(goalSettled(onCycle(null), cycles, today)).toBe(false);
    expect(goalSettled(onCycle("gone"), cycles, today)).toBe(false);
  });

  it("keeps an unfinished goal from a past year off an open-goals list forever", () => {
    // The employee dashboard passed settled=false for every yearly goal, so a 2026 goal at 40
    // per cent counted as open through 2027 while My Goals printed it as a miss.
    const stale = { progress: 40, status: "in_progress" as const, ...yearly(2026) };
    expect(goalOutcome(stale, goalSettled(stale, cycles, new Date(2027, 0, 2)))).toBe("miss");
    expect(goalOutcome(stale, goalSettled(stale, cycles, today))).toBe("open");
  });
});

describe("goalPeriodLabel", () => {
  it("names a goal's period the way the Period pulldown does", () => {
    expect(goalPeriodLabel({ scope: "year", year: 2026 }, 2026)).toBe("This year (2026)");
    expect(goalPeriodLabel({ scope: "year", year: 2027 }, 2026)).toBe("Next year (2027)");
    expect(goalPeriodLabel({ scope: "year", year: 2025 }, 2026)).toBe("2025");
    expect(goalPeriodLabel({ scope: "bhag", year: null }, 2026)).toBe("BHAG (3 to 5 years)");
  });
});

describe("a month's GSRs, for a company that scores them", () => {
  const g = (id: string, kind: Goal["kind"], progress: number, sortOrder = 1, cycleId = "cycle-1", isFocus = false) =>
    goal({ id, kind, progress, sort_order: sortOrder, cycle_id: cycleId, is_focus: isFocus });

  it("makes the focus topic's GSR the #1 mandatory GSR, then role goals, then professional; never a personal one", () => {
    const split = requiredAndStretch(
      [g("me", "personal", 100, 1), g("pro", "professional", 75, 2), g("role", "role", 100, 3), g("focus", "professional", 60, 4, "cycle-1", true)],
      2,
    );
    expect(split.required.map((x) => x.id)).toEqual(["focus", "role"]);
    expect(split.stretch.map((x) => x.id)).toEqual(["pro", "me"]);
    expect(requiredAndStretch([g("me", "personal", 100)], 2).missing).toBe(2);
  });

  it("adds every goal's completion up to 100 for each mandatory GSR: Justin's 160 of 200 is 80", () => {
    const month = [g("one", "professional", 50, 1, "cycle-1", true), g("two", "role", 30, 2), g("stretch", "personal", 80, 3)];
    expect(monthTotal(month, 2)).toEqual({ total: 160, cap: 200 });
    expect(scoreMonth(month, 2)).toBe(80);
  });

  it("caps the month at 200, so a full month with a stretch goal on top is 100", () => {
    expect(monthTotal([g("role", "role", 100), g("pro", "professional", 75), g("me", "personal", 50)], 2)).toEqual({ total: 200, cap: 200 });
    expect(scoreMonth([g("role", "role", 100), g("pro", "professional", 75), g("me", "personal", 50)], 2)).toBe(100);
  });

  it("lets a stretch goal assist a short month, and never lowers one", () => {
    expect(scoreMonth([g("pro", "professional", 50), g("me", "personal", 40)], 2)).toBe(45);
    const base = [g("role", "role", 80), g("pro", "professional", 60)];
    expect(scoreMonth([...base, g("pro-2", "professional", 0, 9), g("me", "personal", 0, 9)], 2)).toBe(scoreMonth(base, 2));
  });

  it("reads the completion slider, never the action steps", () => {
    expect(scoreMonth([goal({ kind: "professional", progress: 0, action_steps: [{ text: "Done", done: true }] })], 1)).toBe(0);
  });

  it("counts a month in a scored review only once its GSR is locked in", () => {
    const quarter = { period_start: "2026-10-01", period_end: "2026-12-31" };
    const cycles = [
      { id: "oct", cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31" },
      { id: "nov", cadence: "monthly", period_start: "2026-11-01", period_end: "2026-11-30" },
      { id: "dec", cadence: "monthly", period_start: "2026-12-01", period_end: "2026-12-31" },
      { id: "q4", cadence: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31" },
    ];
    const goals = [g("oct-1", "role", 100, 1, "oct"), g("nov-1", "professional", 90, 1, "nov"), g("nov-2", "role", 60, 2, "nov")];
    const reviews = [
      { cycle_id: "oct", status: "complete", gsr_score: 80 },
      // November is marked complete with no score, the way a company that scores nothing would.
      { cycle_id: "nov", status: "in_progress", gsr_score: null },
    ] as Array<{ cycle_id: string; status: "complete" | "in_progress"; gsr_score: number | null }>;
    const figure = scoreGsrMonths(quarter, cycles, goals, reviews, 2);
    expect(figure.months.map((m) => [m.cycle.id, m.locked, m.live])).toEqual([["oct", 80, 50], ["nov", null, 75], ["dec", null, 0]]);
    // Only October is applied: its locked 80, not its live 50, and not November's 75 so far.
    expect([figure.target, figure.actual]).toEqual([100, 80]);
  });

  it("says when a month is locked in", () => {
    expect(monthLocked({ status: "complete", gsr_score: 80 })).toBe(true);
    expect(monthLocked({ status: "complete", gsr_score: null })).toBe(false);
    expect(monthLocked({ status: "in_progress", gsr_score: null })).toBe(false);
    expect(monthLocked(null)).toBe(false);
  });
});
