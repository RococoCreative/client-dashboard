// Date rules for wins: which day it is for a company, and the earliest win date that still shows
// on Home when the company limits how many days a win stays there. Pure, so the card and the
// Wins page read one rule.
import { todayIso } from "./format.ts";

// Today as YYYY-MM-DD in the company's own IANA time zone. An unreadable zone falls back to the
// browser's date rather than throwing.
export function companyToday(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fall through to the browser's date.
  }
  return todayIso();
}

// The earliest won_on still on Home: a win is on Home for `days` days counting the day it was
// won, so a win from days - 1 days ago is the last one kept. Null when the company has no limit.
// Date arithmetic is on the date string in UTC, never on local time. The database holds the days
// to 1 to 3650 (0042); anything outside that, or a date that cannot be read, is no cut-off rather
// than a throw, so a bad value never breaks Home or the Wins page.
export const MAX_WINS_HOME_DAYS = 3650;

export function homeCutoff(days: number | null, today: string): string | null {
  if (days === null || !Number.isInteger(days) || days < 1 || days > MAX_WINS_HOME_DAYS) return null;
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d - (days - 1)));
  if (Number.isNaN(cutoff.getTime())) return null;
  return cutoff.toISOString().slice(0, 10);
}
