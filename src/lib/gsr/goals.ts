// Goal Setting Review logic, pure and tested: what a goal's progress means, how a missed goal
// carries into the next cycle, and how one person's goals split across last cycle, this
// cycle, and the year. Scores live in scoring.ts; this never touches them.
import { cycleSettled } from "./cycles.ts";
import type { ActionStep, Goal, GoalKind, GoalStatus } from "../../types/database.ts";

export type GoalOutcome = "hit" | "miss" | "open";

// 100 is a hit. Anything less is a miss once the period is settled (its cycle is closed or
// over) and still open while the period runs.
export function goalOutcome(goal: Pick<Goal, "progress" | "status">, settled: boolean): GoalOutcome {
  if (goal.progress >= 100 || goal.status === "achieved") return "hit";
  return settled ? "miss" : "open";
}

// Whether a goal's period is over, so goalOutcome can call an unfinished goal a miss.
//
// Two shapes of goal, two rules: a cycle goal settles when its cycle closes or its period ends,
// a yearly goal when the year it belongs to is behind us. A caller that handled only the cycle
// case treated every yearly goal as never settled, so an unfinished 2026 goal stayed on the
// employee dashboard's open list through 2027 and beyond while My Goals printed the same goal
// as a miss. Two screens, one goal, opposite verdicts, which is why the rule lives here now.
export function goalSettled(
  goal: Pick<Goal, "scope" | "year" | "cycle_id">,
  cycles: Array<{ id: string; status: string; period_end: string }>,
  today = new Date(),
): boolean {
  if (goal.scope === "year") return (goal.year ?? today.getFullYear()) < today.getFullYear();
  const cycle = goal.cycle_id ? cycles.find((c) => c.id === goal.cycle_id) : undefined;
  return cycle ? cycleSettled(cycle, today) : false;
}

// The slider drives status: 100 marks the goal achieved, moving back off 100 reopens it, and
// the first movement off zero starts it.
export function progressPatch(raw: number, status: GoalStatus): { progress: number; status: GoalStatus } {
  const progress = Math.min(100, Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0)));
  if (progress >= 100) return { progress, status: "achieved" };
  if (status === "achieved" || status === "missed") return { progress, status: progress > 0 ? "in_progress" : "not_started" };
  if (progress > 0 && status === "not_started") return { progress, status: "in_progress" };
  return { progress, status };
}

export function stepsTaken(goal: Pick<Goal, "action_steps">): { done: number; total: number } {
  return { done: goal.action_steps.filter((s) => s.done).length, total: goal.action_steps.length };
}

// A missed goal restated for the next cycle: same title, kind, and description; only the
// steps not yet taken, all unticked; progress back to zero; and a link to where it came from.
export interface CarriedGoal {
  company_id: string;
  employee_id: string;
  title: string;
  kind: GoalKind;
  description: string | null;
  scope: "cycle";
  cycle_id: string;
  status: GoalStatus;
  progress: number;
  action_steps: ActionStep[];
  carried_from_goal_id: string;
  sort_order: number;
}

export function carryForward(goal: Goal, cycleId: string, sortOrder = goal.sort_order): CarriedGoal {
  return {
    company_id: goal.company_id,
    employee_id: goal.employee_id,
    title: goal.title,
    kind: goal.kind,
    description: goal.description,
    scope: "cycle",
    cycle_id: cycleId,
    status: "not_started",
    progress: 0,
    action_steps: goal.action_steps.filter((s) => !s.done).map((s) => ({ text: s.text, done: false })),
    carried_from_goal_id: goal.id,
    sort_order: sortOrder,
  };
}

const byOrder = (a: Goal, b: Goal) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

// One person's goals the way the monthly review reads them.
export function splitGoals(
  goals: Goal[],
  where: { cycleId: string; previousCycleId: string | null; year: number },
): { thisCycle: Goal[]; lastCycle: Goal[]; yearly: Goal[] } {
  return {
    thisCycle: goals.filter((g) => g.scope === "cycle" && g.cycle_id === where.cycleId).sort(byOrder),
    lastCycle: goals.filter((g) => g.scope === "cycle" && where.previousCycleId !== null && g.cycle_id === where.previousCycleId).sort(byOrder),
    yearly: goals.filter((g) => g.scope === "year" && g.year === where.year).sort(byOrder),
  };
}

export function hitCount(goals: Goal[], settled: boolean): { hit: number; total: number } {
  return { hit: goals.filter((g) => goalOutcome(g, settled) === "hit").length, total: goals.length };
}
