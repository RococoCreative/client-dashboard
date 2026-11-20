// The rules for Goal Setting Reviews that stand on their own, shared by every company whose setting
// says on demand. Pure, so every screen reads one rule: the date windows, the counts and averages
// over them, who is due, which GSR is current and which came before, the figure a scored review
// reads, and carrying a goal forward. Dates are day strings worked in UTC, as homeCutoff does.
import type { Goal, Gsr, GsrCadence } from "../../types/database.ts";
import { carryForward, LOCKED_MONTH_TARGET } from "./goals.ts";
import type { CarriedGoal } from "./goals.ts";
import { averageScore } from "./scoring.ts";

export interface DateRange {
  from: string;
  to: string;
}
export type GsrWindow = "week" | "month" | "quarter";
export type GsrFigureRow = Pick<Gsr, "employee_id" | "status" | "started_on" | "done_on" | "gsr_score">;
export type DueState = "none" | "ok" | "due" | "overdue";

export const GSR_RHYTHMS: readonly GsrCadence[] = ["none", "daily", "weekly", "biweekly", "monthly", "quarterly"];
export const GSR_RHYTHM_LABELS: Record<GsrCadence, string> = {
  none: "None",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};
export const GSR_WINDOW_LABELS: Record<GsrWindow | "custom", string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  custom: "Custom dates",
};

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(day: string, days: number): string {
  const [y, m, d] = parts(day);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
}
// A month with no such day takes its last day: 31 January plus one month is the last of February.
function addMonths(day: string, months: number): string {
  const [y, m, d] = parts(day);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))));
}

export function windowRange(window: GsrWindow, today: string): DateRange {
  const [y, m, d] = parts(today);
  if (window === "week") {
    const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const from = addDays(today, -sinceMonday);
    return { from, to: addDays(from, 6) };
  }
  const startMonth = window === "month" ? m - 1 : Math.floor((m - 1) / 3) * 3;
  const span = window === "month" ? 1 : 3;
  return {
    from: iso(new Date(Date.UTC(y, startMonth, 1))),
    to: iso(new Date(Date.UTC(y, startMonth + span, 0))),
  };
}

export function isOpen(gsr: Pick<Gsr, "status">): boolean {
  return gsr.status !== "complete";
}

const inRange = (day: string | null, range: DateRange) => day !== null && day >= range.from && day <= range.to;

export function windowFigures(gsrs: GsrFigureRow[], range: DateRange): { done: number; average: number | null; inProgress: number } {
  const done = gsrs.filter((g) => inRange(g.done_on, range));
  return { done: done.length, average: averageScore(done.map((g) => g.gsr_score)), inProgress: gsrs.filter(isOpen).length };
}

export function figuresByPerson(gsrs: GsrFigureRow[], range: DateRange): Map<string, { done: number; average: number | null; open: number }> {
  const byPerson = new Map<string, GsrFigureRow[]>();
  for (const g of gsrs) byPerson.set(g.employee_id, [...(byPerson.get(g.employee_id) ?? []), g]);
  const out = new Map<string, { done: number; average: number | null; open: number }>();
  for (const [id, rows] of byPerson) {
    const { done, average, inProgress } = windowFigures(rows, range);
    out.set(id, { done, average, open: inProgress });
  }
  return out;
}

function nextWorkingDay(day: string): string {
  let next = addDays(day, 1);
  for (;;) {
    const dow = new Date(`${next}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return next;
    next = addDays(next, 1);
  }
}

export function dueFor(cadence: GsrCadence, lastStartedOn: string | null, today: string): { state: DueState; dueOn: string | null } {
  if (cadence === "none") return { state: "none", dueOn: null };
  let dueOn = today;
  if (lastStartedOn !== null) {
    dueOn =
      cadence === "daily" ? nextWorkingDay(lastStartedOn)
      : cadence === "weekly" ? addDays(lastStartedOn, 7)
      : cadence === "biweekly" ? addDays(lastStartedOn, 14)
      : cadence === "monthly" ? addMonths(lastStartedOn, 1)
      : addMonths(lastStartedOn, 3);
  }
  return { state: today < dueOn ? "ok" : today === dueOn ? "due" : "overdue", dueOn };
}

// Newest start first; the later-created row wins a tie.
const newestFirst = (a: Pick<Gsr, "started_on" | "created_at">, b: Pick<Gsr, "started_on" | "created_at">) =>
  b.started_on.localeCompare(a.started_on) || b.created_at.localeCompare(a.created_at);

export function currentGsr<T extends Pick<Gsr, "status" | "started_on" | "created_at">>(gsrs: T[]): T | null {
  return gsrs.filter(isOpen).sort(newestFirst)[0] ?? null;
}

export function previousGsr<T extends Pick<Gsr, "id" | "started_on" | "created_at">>(gsrs: T[], current: T): T | null {
  return (
    gsrs
      .filter((g) => g.id !== current.id && (g.started_on < current.started_on || (g.started_on === current.started_on && g.created_at < current.created_at)))
      .sort(newestFirst)[0] ?? null
  );
}

export function gsrGoals(goals: Goal[], reviewId: string): Goal[] {
  return goals.filter((g) => g.scope === "cycle" && g.review_id === reviewId);
}

// What a scored review reads from the GSRs: those done inside its period, counted when they have a
// score, then those open now, never counted. Each counted GSR is worth LOCKED_MONTH_TARGET.
export function scoreGsrsInPeriod<T extends GsrFigureRow>(
  period: { period_start: string; period_end: string },
  gsrs: T[],
): { gsrs: Array<{ gsr: T; counted: boolean }>; target: number; actual: number } {
  const range = { from: period.period_start, to: period.period_end };
  const listed = [
    ...gsrs.filter((g) => inRange(g.done_on, range)).map((gsr) => ({ gsr, counted: gsr.gsr_score !== null })),
    ...gsrs.filter(isOpen).map((gsr) => ({ gsr, counted: false })),
  ];
  const counted = listed.filter((l) => l.counted);
  return { gsrs: listed, target: counted.length * LOCKED_MONTH_TARGET, actual: counted.reduce((sum, l) => sum + (l.gsr.gsr_score ?? 0), 0) };
}

// How many GSRs a signed-off review's GSR line item counted, read back from its target: a signed-off
// review keeps only that line item, and scoreGsrsInPeriod wrote LOCKED_MONTH_TARGET for each.
export function gsrsCountedIn(target: number): number {
  return Math.round(target / LOCKED_MONTH_TARGET);
}

// The same carry as a cycle's, aimed at a GSR: it keeps and drops exactly what carryForward does.
export function carryForwardToGsr(goal: Goal, reviewId: string, sortOrder?: number): Omit<CarriedGoal, "cycle_id"> & { cycle_id: null; review_id: string } {
  const carried = carryForward(goal, "", sortOrder);
  return { ...carried, cycle_id: null, review_id: reviewId };
}
