// Goal Setting Review logic, pure and tested: what a goal's progress means, the order a month's
// goals are read in, how a missed goal carries into the next cycle, how one person's goals split
// across last cycle, this cycle, and the year, and how a month's goals add up for a company that
// scores its GSRs. The pillar weighting lives in scoring.ts; this only produces the month figures
// a 'gsr_goals' pillar's line item carries, the way deliverables.ts does for its module.
import { cycleSettled, monthsWithin } from "./cycles.ts";
import type { ActionStep, Goal, GoalKind, GoalStatus, Review } from "../../types/database.ts";

// The order goals are read in, on every screen that lists them: role goals first, then
// professional goals, and personal goals last. Shared in code, so every company reads its goals
// in the same order.
export const GOAL_KIND_ORDER: GoalKind[] = ["role", "professional", "personal"];

// A month's goals in that order, the focus topic's GSR ahead of them all, because it is the
// month's #1 GSR; within a kind, the order they were filed in.
export function rankGoals<T extends Pick<Goal, "kind" | "is_focus" | "sort_order" | "created_at">>(goals: T[]): T[] {
  const rank = (goal: T) => (goal.is_focus ? -1 : GOAL_KIND_ORDER.indexOf(goal.kind));
  return [...goals].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

export type GoalOutcome = "hit" | "miss" | "open";

// 100 is a hit. Anything less is a miss once the period is settled (its cycle is closed or
// over) and still open while the period runs.
export function goalOutcome(goal: Pick<Goal, "progress" | "status">, settled: boolean): GoalOutcome {
  if (goal.progress >= 100 || goal.status === "achieved") return "hit";
  return settled ? "miss" : "open";
}

// Whether a goal's period is over, so goalOutcome can call an unfinished goal a miss.
//
// Three shapes of goal, three rules: a cycle goal settles when its cycle closes or its period
// ends, a yearly goal when the year it belongs to is behind us, and a BHAG never: it has no year,
// so it stays open until it is hit. A caller that handled only the cycle case treated every
// yearly goal as never settled, so an unfinished 2026 goal stayed on the employee dashboard's
// open list through 2027 and beyond while My Goals printed the same goal as a miss. Two screens,
// one goal, opposite verdicts, which is why the rule lives here now.
export function goalSettled(
  goal: Pick<Goal, "scope" | "year" | "cycle_id">,
  cycles: Array<{ id: string; status: string; period_end: string }>,
  today = new Date(),
): boolean {
  if (goal.scope === "bhag") return false;
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

// The period a yearly or BHAG goal belongs to, the way the Period pulldown names it.
export function goalPeriodLabel(goal: Pick<Goal, "scope" | "year">, thisYear = new Date().getFullYear()): string {
  if (goal.scope === "bhag") return "BHAG (3 to 5 years)";
  const year = goal.year ?? thisYear;
  if (year === thisYear) return `This year (${year})`;
  if (year === thisYear + 1) return `Next year (${year})`;
  return String(year);
}

// A missed goal restated for the next cycle: same title, kind, and description; only the
// steps not yet taken, all unticked; progress back to zero; and a link to where it came from.
// It is not the new month's focus GSR: that comes from the new month's topic.
export interface CarriedGoal {
  company_id: string;
  employee_id: string;
  title: string;
  kind: GoalKind;
  is_focus: false;
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
    is_focus: false,
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

// How a month's GSRs add up for a company with a Monthly GSRs pillar, which says how many
// mandatory GSRs a month carries. The mandatory GSRs are the first that many goals that are not
// personal, read in rank order: the focus topic's GSR is #1, then role goals, then professional
// ones. Everything else is a stretch goal. A month adds up the completion of all its goals,
// mandatory and stretch alike, up to 100 for each mandatory GSR: two mandatory GSRs make 200, and
// a stretch goal adds to the total without ever lowering it. Justin's example: 50 and 30 on the
// mandatory two and 80 on a stretch goal is 160 of 200, a month score of 80.
export function requiredAndStretch<T extends Pick<Goal, "kind" | "is_focus" | "sort_order" | "created_at">>(
  goals: T[],
  required: number,
): { required: T[]; stretch: T[]; missing: number } {
  const ranked = rankGoals(goals);
  const counted = ranked.filter((g) => g.kind !== "personal").slice(0, Math.max(0, required));
  return { required: counted, stretch: ranked.filter((g) => !counted.includes(g)), missing: Math.max(0, required - counted.length) };
}

// The month's completion across all its goals, capped at 100 for each mandatory GSR.
export function monthTotal(goals: Array<Pick<Goal, "progress">>, required: number): { total: number; cap: number } {
  const cap = Math.max(0, required) * 100;
  const sum = goals.reduce((acc, g) => acc + Math.min(100, Math.max(0, g.progress)), 0);
  return { total: Math.min(sum, cap), cap };
}

// The month's score, 0 to 100: its total as a share of the cap. This is the figure an admin locks
// in when they mark the month complete (reviews.gsr_score, 0023).
export function scoreMonth(goals: Array<Pick<Goal, "progress">>, required: number): number {
  const { total, cap } = monthTotal(goals, required);
  return cap === 0 ? 0 : Math.round((total / cap) * 100);
}

export interface GsrMonthsFigure<C> {
  // Every month in the period. `locked` is the score its GSR was locked in at, or null while the
  // month is still open to change; `live` is where it stands now, for reading, never for scoring.
  months: Array<{ cycle: C; locked: number | null; live: number }>;
  target: number;
  actual: number;
}

// The months a scored review reads for its Monthly GSRs pillar, and the one line item they make.
// The months are the Goal Setting Reviews wholly inside its period (monthsWithin). A month counts
// once an admin has locked its GSR in, and not before: an open month is shown but never applied.
// The line item is 100 a locked month as the target and their locked scores as the actual, so the
// pillar's score is their average. A quarter's three months are a third of its pillar each, and
// across four quarters each month is a twelfth of the year's, the 1.67 points of 20 Justin set.
export function scoreGsrMonths<C extends { id: string; cadence: string; period_start: string; period_end: string }>(
  period: { period_start: string; period_end: string },
  cycles: C[],
  goals: Array<Pick<Goal, "scope" | "cycle_id" | "progress">>,
  reviews: Array<Pick<Review, "cycle_id" | "status" | "gsr_score">>,
  required: number,
): GsrMonthsFigure<C> {
  const months = monthsWithin(period, cycles).map((cycle) => {
    const review = reviews.find((r) => r.cycle_id === cycle.id);
    const locked = review?.status === "complete" && review.gsr_score !== null ? review.gsr_score : null;
    const live = scoreMonth(goals.filter((g) => g.scope === "cycle" && g.cycle_id === cycle.id), required);
    return { cycle, locked, live };
  });
  const counted = months.filter((m) => m.locked !== null);
  return { months, target: counted.length * 100, actual: counted.reduce((sum, m) => sum + (m.locked ?? 0), 0) };
}

// Whether a person's month is locked in: their GSR for it marked complete with its score.
export function monthLocked(review: Pick<Review, "status" | "gsr_score"> | null | undefined): boolean {
  return review?.status === "complete" && review.gsr_score !== null;
}
