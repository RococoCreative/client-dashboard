// The Goal Setting Review rules: progress to status, hit or miss, carry forward, splitting.
import { describe, expect, it } from "vitest";
import { carryForward, goalOutcome, goalSettled, hitCount, progressPatch, splitGoals } from "./goals.ts";
import type { Goal } from "../../types/database.ts";

function goal(over: Partial<Goal>): Goal {
  return {
    id: "g",
    company_id: "c",
    employee_id: "e",
    cycle_id: "cycle-1",
    kind: "professional",
    title: "Ship it",
    description: "Done means shipped.",
    status: "in_progress",
    action_steps: [
      { text: "Draft", done: true },
      { text: "Review", done: false },
    ],
    progress_notes: null,
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

describe("carryForward", () => {
  it("restates the goal for the next cycle with only the steps not taken", () => {
    const carried = carryForward(goal({}), "cycle-2");
    expect(carried).toMatchObject({ title: "Ship it", cycle_id: "cycle-2", scope: "cycle", progress: 0, status: "not_started", carried_from_goal_id: "g" });
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
