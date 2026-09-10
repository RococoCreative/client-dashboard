// Goal Setting Review logic, pure and tested: what a goal's progress means, how a missed goal
// carries into the next cycle, and how one person's goals split across last cycle, this
// cycle, and the year. Scores live in scoring.ts; this never touches them.
import type { ActionStep, Goal, GoalKind, GoalStatus } from "../../types/database.ts";

export type GoalOutcome = "hit" | "miss" | "open";

// 100 is a hit. Anything less is a miss once the period is settled (its cycle is closed or
// over) and still open while the period runs.
export function goalOutcome(goal: Pick<Goal, "progress" | "status">, settled: boolean): GoalOutcome {
  if (goal.progress >= 100 || goal.status === "achieved") return "hit";
  return settled ? "miss" : "open";
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

// Focus topics typed as a comma or line separated list, trimmed and deduplicated against
// the ones already there (case-insensitive).
export function parseTopics(raw: string, existing: string[] = []): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const out = [...existing];
  for (const part of raw.split(/[,\n]/)) {
    const topic = part.trim();
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    out.push(topic);
  }
  return out;
}
