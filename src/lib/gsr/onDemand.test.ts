// Pins the rules for GSRs that stand on their own: windows, counts, due flags, current and
// previous, the figure a scored review reads, and carrying a goal forward.
import { describe, expect, it } from "vitest";
import { RBA } from "../../test/fixtures.ts";
import { carryForwardToGsr, currentGsr, dueFor, figuresByPerson, gsrsCountedIn, previousGsr, scoreGsrsInPeriod, windowFigures, windowRange } from "./onDemand.ts";
import type { GsrFigureRow } from "./onDemand.ts";

describe("GSRs on demand", () => {
  it("runs a week Monday to Sunday", () => {
    expect(windowRange("week", "2026-09-15")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(windowRange("month", "2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(windowRange("quarter", "2026-09-15")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });
  it("counts done GSRs in the window and open ones whatever the window", () => {
    const rows: GsrFigureRow[] = [
      { employee_id: "a", status: "complete", started_on: "2026-09-07", done_on: "2026-09-14", gsr_score: 80 },
      { employee_id: "a", status: "complete", started_on: "2026-09-14", done_on: "2026-09-16", gsr_score: 90 },
      { employee_id: "b", status: "complete", started_on: "2026-09-01", done_on: "2026-09-10", gsr_score: 50 },
      { employee_id: "c", status: "not_started", started_on: "2026-08-01", done_on: null, gsr_score: null },
      { employee_id: "d", status: "complete", started_on: "2026-09-15", done_on: "2026-09-15", gsr_score: null },
    ];
    expect(windowFigures(rows, { from: "2026-09-14", to: "2026-09-20" })).toEqual({ done: 3, average: 85, inProgress: 1 });
    expect(figuresByPerson(rows, { from: "2026-09-14", to: "2026-09-20" }).get("a")).toEqual({ done: 2, average: 85, open: 0 });
    expect(windowFigures(rows, { from: "2026-10-01", to: "2026-10-31" })).toEqual({ done: 0, average: null, inProgress: 1 });
  });
  it("says when a person is due", () => {
    expect(dueFor("none", null, "2026-09-15")).toEqual({ state: "none", dueOn: null });
    expect(dueFor("weekly", null, "2026-09-15")).toEqual({ state: "due", dueOn: "2026-09-15" });
    expect(dueFor("daily", "2026-09-11", "2026-09-14")).toEqual({ state: "due", dueOn: "2026-09-14" }); // Friday to Monday
    expect(dueFor("daily", "2026-09-11", "2026-09-15").state).toBe("overdue");
    expect(dueFor("weekly", "2026-09-08", "2026-09-15").state).toBe("due");
    expect(dueFor("biweekly", "2026-09-08", "2026-09-15")).toEqual({ state: "ok", dueOn: "2026-09-22" });
    expect(dueFor("monthly", "2026-01-31", "2026-02-27").dueOn).toBe("2026-02-28");
    expect(dueFor("quarterly", "2026-11-30", "2027-03-01")).toEqual({ state: "overdue", dueOn: "2027-02-28" });
  });
  it("scores a review period from the GSRs done inside it", () => {
    const rows: GsrFigureRow[] = [
      { employee_id: "a", status: "complete", started_on: "2026-07-01", done_on: "2026-07-10", gsr_score: 70 },
      { employee_id: "a", status: "complete", started_on: "2026-09-01", done_on: "2026-09-30", gsr_score: 90 },
      { employee_id: "a", status: "complete", started_on: "2026-09-20", done_on: "2026-10-01", gsr_score: 100 },
      { employee_id: "a", status: "in_progress", started_on: "2026-10-01", done_on: null, gsr_score: null },
    ];
    const figure = scoreGsrsInPeriod({ period_start: "2026-07-01", period_end: "2026-09-30" }, rows);
    expect([figure.target, figure.actual]).toEqual([200, 160]);
    expect(figure.gsrs.map((g) => g.counted)).toEqual([true, true, false]); // the two done inside, then the open one
  });
  it("reads back how many GSRs a signed-off line item counted", () => {
    const rows = [
      { employee_id: "a", status: "complete" as const, started_on: "2026-07-01", done_on: "2026-07-10", gsr_score: 70 },
      { employee_id: "a", status: "complete" as const, started_on: "2026-09-01", done_on: "2026-09-30", gsr_score: 90 },
      { employee_id: "a", status: "complete" as const, started_on: "2026-08-01", done_on: "2026-08-04", gsr_score: null },
    ];
    const figure = scoreGsrsInPeriod({ period_start: "2026-07-01", period_end: "2026-09-30" }, rows);
    // Done with no score is listed, never counted.
    expect(gsrsCountedIn(figure.target)).toBe(2);
    expect(gsrsCountedIn(0)).toBe(0);
  });
  it("finds the current and the previous GSR", () => {
    const g = (id: string, started_on: string, status: "complete" | "in_progress") => ({ id, started_on, status, created_at: `${started_on}T09:00:00Z` });
    const all = [g("1", "2026-06-02", "complete"), g("2", "2026-09-08", "in_progress"), g("3", "2026-09-15", "in_progress")];
    expect(currentGsr(all)?.id).toBe("3");
    expect(previousGsr(all, all[2])?.id).toBe("2");
    expect(previousGsr(all, all[0])).toBeNull();
    expect(currentGsr([all[0]])).toBeNull();
  });
  it("carries a goal to a GSR, never to a cycle", () => {
    const goal = { ...RBA.goals[0], is_focus: true, progress: 60, action_steps: [{ text: "Done", done: true }, { text: "Open", done: false }] };
    const carried = carryForwardToGsr(goal, "gsr-9");
    expect(carried).toMatchObject({ review_id: "gsr-9", cycle_id: null, scope: "cycle", is_focus: false, progress: 0, carried_from_goal_id: goal.id });
    expect(carried.action_steps).toEqual([{ text: "Open", done: false }]);
  });
});
