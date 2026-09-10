// The Goal Setting Review rules: progress to status, hit or miss, carry forward, splitting.
import { describe, expect, it } from "vitest";
import { carryForward, goalOutcome, hitCount, parseTopics, progressPatch, splitGoals } from "./goals.ts";
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

describe("parseTopics", () => {
  it("splits, trims, and deduplicates against existing topics", () => {
    expect(parseTopics(" Safety, client updates ,safety\nSchedule", ["Client updates"])).toEqual(["Client updates", "Safety", "Schedule"]);
  });
});
