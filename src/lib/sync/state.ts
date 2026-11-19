// The one honest state a data source shows, so every screen that names a source's freshness says
// the same thing: not connected, waiting for its first sync, syncing, failed, stale past its own
// threshold, or synced. Pure, so the precedence is proven in one place. A sync still marked
// running past the runner's stale window was cut off, so it reads as failed rather than Syncing
// forever.
import { staleRunCutoff } from "../../../supabase/functions/_shared/sync/runner.ts";
import type { CompanyConnection, SyncSource } from "../../types/database.ts";

export type SyncState = "not_connected" | "awaiting_first_sync" | "syncing" | "failed" | "stale" | "synced";
export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  not_connected: "Not connected",
  awaiting_first_sync: "Awaiting first sync",
  syncing: "Syncing",
  failed: "Sync failed",
  stale: "Stale data",
  synced: "Synced",
};

// Hours since the last success, or null when there has never been one.
export function ageHours(lastSuccessAt: string | null, now: Date): number | null {
  if (lastSuccessAt === null) return null;
  return (now.getTime() - new Date(lastSuccessAt).getTime()) / 3600000;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
const formatters = new Map<string, Intl.DateTimeFormat>();

// The local calendar day and weekday in the zone at an instant, read through Intl alone (the same
// approach the schedule code uses), so daylight saving and the zone's own date are always right.
function localDay(instant: number, timeZone: string): { key: string; weekday: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instant))) parts[part.type] = part.value;
  return { key: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAY_NAMES.indexOf(parts.weekday) };
}

// The first instant after `instant` that falls on a later local day: the zone's next midnight.
// Found by bisecting whole minutes, since a day is at most 25 hours long and transitions land on
// minute marks.
function nextLocalMidnight(instant: number, timeZone: string): number {
  const day = localDay(instant, timeZone).key;
  let lo = Math.floor(instant / MINUTE_MS);
  let hi = lo + 26 * 60;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(mid * MINUTE_MS, timeZone).key === day) lo = mid;
    else hi = mid;
  }
  return hi * MINUTE_MS;
}

// Hours between two instants that fall on Monday to Friday in the zone. Each local day counts its
// real elapsed hours, so a 23 or 25 hour day is neither padded nor trimmed.
export function businessHoursBetween(from: Date, to: Date, timeZone: string): number {
  const end = to.getTime();
  let cursor = from.getTime();
  let total = 0;
  while (cursor < end) {
    const next = Math.min(nextLocalMidnight(cursor, timeZone), end);
    const { weekday } = localDay(cursor, timeZone);
    if (weekday >= 1 && weekday <= 5) total += next - cursor;
    cursor = next;
  }
  return total / HOUR_MS;
}

// A sync marked running whose run started before the stale window: the platform cut it off and
// nothing closed it yet. A run start is the source's last_attempt_at.
export function runCutOff(source: Pick<SyncSource, "last_status" | "last_attempt_at">, now: Date): boolean {
  if (source.last_status !== "running" || source.last_attempt_at === null) return false;
  return new Date(source.last_attempt_at).getTime() < staleRunCutoff(now).getTime();
}

// The plain line under a failed source: a cut-off run says so, since any error on the row is
// from an older run; otherwise the source's own error, then the connection's.
export function failureDetail(
  source: Pick<SyncSource, "last_status" | "last_attempt_at" | "last_error">,
  now: Date,
  connection: Pick<CompanyConnection, "last_error"> | null = null,
): string {
  if (runCutOff(source, now)) return "The last sync did not finish.";
  return source.last_error ?? connection?.last_error ?? "The last attempt did not finish.";
}

// The zone a source's weekends are judged in: its own schedule's zone, else the company's.
function staleZone(source: { sync_timezone?: string | null }, companyTimeZone: string | undefined): string | null {
  return source.sync_timezone ?? companyTimeZone ?? null;
}

// How old the data is for the stale rule: elapsed hours, or only the weekday hours when the source
// counts weekdays only. A zone Intl cannot read falls back to elapsed hours, the stricter rule,
// so a bad zone can only ever flag stale data, never hide it.
function staleAge(
  source: { last_success_at: string | null; stale_business_days?: boolean; sync_timezone?: string | null },
  now: Date,
  companyTimeZone: string | undefined,
): number | null {
  if (source.last_success_at === null) return null;
  const zone = source.stale_business_days ? staleZone(source, companyTimeZone) : null;
  if (zone !== null) {
    try {
      return businessHoursBetween(new Date(source.last_success_at), now, zone);
    } catch {
      /* unreadable zone: fall through to elapsed hours */
    }
  }
  return ageHours(source.last_success_at, now);
}

type SyncStateSource = Pick<SyncSource, "last_status" | "last_attempt_at" | "last_success_at" | "stale_after_hours"> & Partial<Pick<SyncSource, "stale_business_days" | "sync_timezone">>;
// A real source row carries the flag, so the company's zone is then required: a caller cannot
// forget it. A narrower shape without the flag has no use for it.
type CompanyZoneArg<S> = S extends { stale_business_days: boolean } ? [companyTimeZone: string] : [companyTimeZone?: string];

// First match wins.
export function syncState<S extends SyncStateSource>(
  source: S,
  connection: Pick<CompanyConnection, "status"> | null,
  now: Date = new Date(),
  ...zone: CompanyZoneArg<S>
): SyncState {
  if (connection === null || connection.status === "not_connected") return "not_connected";
  if (source.last_status === "running") return runCutOff(source, now) ? "failed" : "syncing";
  if (source.last_status === "failed" || source.last_status === "abandoned" || connection.status === "error") return "failed";
  if (source.last_success_at === null) return "awaiting_first_sync";
  const age = staleAge(source, now, (zone as [string?])[0]);
  if (source.stale_after_hours !== null && age !== null && age > source.stale_after_hours) return "stale";
  return "synced";
}
