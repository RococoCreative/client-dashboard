// Review cycle period math for the New Cycle form: given a cadence and a start date, the
// natural end date and a default name. Date-only strings in, date-only strings out, all in
// local time so a September cycle never begins on August 31 in Chicago.
import { parseDate, toDateOnly } from "../format.ts";
import type { Cadence } from "../../types/database.ts";

export const CADENCE_LABELS: Record<Cadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  custom: "Custom dates",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthsFor(cadence: Cadence): number | null {
  switch (cadence) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "annual": return 12;
    default: return null;
  }
}

// First day of the period that contains `date` for a fixed cadence; the date itself for
// custom cycles.
export function periodStart(cadence: Cadence, date: Date): string {
  const months = monthsFor(cadence);
  if (months === null) return toDateOnly(date);
  const startMonth = Math.floor(date.getMonth() / months) * months;
  return toDateOnly(new Date(date.getFullYear(), startMonth, 1));
}

// Last day of the period that begins on `start`; null for custom cycles (the admin picks).
export function periodEnd(cadence: Cadence, start: string): string | null {
  const months = monthsFor(cadence);
  const date = parseDate(start);
  if (months === null || !date) return null;
  // Day 0 of the following month is the last day of the target month.
  return toDateOnly(new Date(date.getFullYear(), date.getMonth() + months, 0));
}

// "September 2026", "Q3 2026", "H2 2026", "2026", or "Sep 1 to Oct 15, 2026" for custom.
export function defaultCycleName(cadence: Cadence, start: string, end?: string | null): string {
  const date = parseDate(start);
  if (!date) return "";
  const year = date.getFullYear();
  switch (cadence) {
    case "monthly":
      return `${MONTHS[date.getMonth()]} ${year}`;
    case "quarterly":
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${year}`;
    case "annual":
      return `${year}`;
    default: {
      const finish = end ? parseDate(end) : null;
      const startText = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!finish) return `${startText}, ${year}`;
      return `${startText} to ${finish.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
}

// The cycle whose period contains today, else the most recently started one.
export function currentCycle<T extends { period_start: string; period_end: string; status: string }>(
  cycles: T[],
  today = new Date(),
): T | null {
  const todayIso = toDateOnly(today);
  const open = cycles.filter((c) => c.status === "open");
  const containing = open.find((c) => c.period_start <= todayIso && c.period_end >= todayIso);
  if (containing) return containing;
  const sorted = [...open].sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  return sorted[0] ?? null;
}

// The cycle before `current` with the same cadence: the latest one that started earlier.
export function previousCycle<T extends { id: string; cadence: string; period_start: string }>(cycles: T[], current: T): T | null {
  return (
    cycles
      .filter((c) => c.id !== current.id && c.cadence === current.cadence && c.period_start < current.period_start)
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0] ?? null
  );
}

// The calendar year a cycle belongs to, from its start date.
export function cycleYear(cycle: { period_start: string }): number {
  return parseDate(cycle.period_start)?.getFullYear() ?? new Date().getFullYear();
}

// A cycle is settled once it is closed or its period is over: its goals read as hit or miss.
export function cycleSettled(cycle: { status: string; period_end: string }, today = new Date()): boolean {
  return cycle.status === "closed" || cycle.period_end < toDateOnly(today);
}
