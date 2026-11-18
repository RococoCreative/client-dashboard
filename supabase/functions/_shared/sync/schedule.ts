// When a source is due: at a local time on each of a set of weekdays, in the source's own time
// zone, which keeps its wall-clock time across daylight saving changes and judges the weekday by
// the source's own calendar, never UTC's. Built on Intl.DateTimeFormat alone so the app and the
// Edge Function share it with no date library.
import type { SyncSourceSpec } from "./types.ts";

export interface WeeklySchedule { weekdays: number[]; time: string; timezone: string } // weekdays 0 = Sunday .. 6 (JS getDay, PG dow), sorted, at least one; time "HH:MM" or "HH:MM:SS"; IANA zone

// The set may be missing (a row read by a column list from before 0045) or null (a row 0045 has not
// filled): the single day then stands in for it.
type ScheduleColumns = Pick<SyncSourceSpec, "sync_weekday" | "sync_time" | "sync_timezone"> & Partial<Pick<SyncSourceSpec, "sync_weekdays">>;

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

// The wall clock in the zone at an instant.
function wallAt(instant: number, timezone: string): Wall {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(instant))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

// A wall clock written as if it were UTC, so two can be compared and offsets read as a difference.
function wallMs(wall: Omit<Wall, "weekday">): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

// The zone's offset from UTC at an instant, in milliseconds (whole seconds).
function offsetAt(instant: number, timezone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallMs(wallAt(whole, timezone)) - whole;
}

// The instant a wall time happens in the zone. Twice (the clocks fell back): the earlier. Never
// (the clocks sprang forward): the first instant after the gap, which is the transition itself.
function resolveWall(target: number, timezone: string): number {
  const candidates = [...new Set([
    target - offsetAt(target - DAY_MS, timezone),
    target - offsetAt(target + DAY_MS, timezone),
  ])].sort((a, b) => a - b);
  const valid = candidates.filter((instant) => wallMs(wallAt(instant, timezone)) === target);
  if (valid.length > 0) return valid[0];
  let lo = candidates[0];
  let hi = candidates[candidates.length - 1];
  const before = offsetAt(lo, timezone);
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (offsetAt(mid, timezone) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

// Whether Intl.DateTimeFormat can read the zone. The database admits named zones only, but a
// zone it reads and this cannot (a POSIX-style 'UTC+5') must never throw out of a tick.
function isReadableZone(timezone: string): boolean {
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

// Null when any part is missing or no day is set, which means the source is never due.
export function scheduleOf(source: ScheduleColumns): WeeklySchedule | null {
  const days = source.sync_weekdays ?? (source.sync_weekday === null ? [] : [source.sync_weekday]);
  const weekdays = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (weekdays.length === 0 || source.sync_time === null || source.sync_timezone === null) return null;
  return { weekdays, time: source.sync_time, timezone: source.sync_timezone };
}

// The latest instant at or before now that falls on one of the schedule's local weekdays at its
// local time. Walks back over the zone's own calendar days, today first, so the first slot found
// that has already happened is the latest; eight days always reach one.
export function latestSlot(schedule: WeeklySchedule, now: Date): Date {
  const [hour, minute, second = 0] = schedule.time.split(":").map(Number);
  const local = wallAt(now.getTime(), schedule.timezone);
  const days = new Set(schedule.weekdays);
  for (let back = 0; back <= 7; back += 1) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day - back));
    if (!days.has(date.getUTCDay())) continue;
    const slot = resolveWall(
      wallMs({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute, second }),
      schedule.timezone,
    );
    if (slot <= now.getTime()) return new Date(slot);
  }
  throw new Error("A schedule needs at least one day from Sunday (0) to Saturday (6).");
}

// Due when enabled, scheduled in a zone this can read, and not tried since the latest slot.
export function isDue(
  source: ScheduleColumns & Pick<SyncSourceSpec, "enabled" | "last_attempt_at">,
  now: Date,
): boolean {
  if (!source.enabled) return false;
  const schedule = scheduleOf(source);
  if (!schedule || !isReadableZone(schedule.timezone)) return false;
  if (source.last_attempt_at === null) return true;
  return new Date(source.last_attempt_at).getTime() < latestSlot(schedule, now).getTime();
}
