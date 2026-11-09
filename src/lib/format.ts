// Display formatting shared across pages: money, percentages, dates, periods, names. No
// em dashes anywhere in output; an empty value renders as a plain hyphen.
import type { Profile } from "../types/database.ts";

const EMPTY = "-";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const moneyCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatMoney(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return compact ? moneyCompact.format(value) : money.format(value);
}

// Typed money text reduced to a sign and plain digits, or null when it is not a number.
function readMoneyText(value: string): { negative: boolean; digits: string } | null {
  // A unicode minus is what some spreadsheets and word processors put in place of a hyphen.
  let text = value.trim().replace(/\u2212/g, "-").replace(/[$,\s]/g, "");
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(text)) return null;
  return { negative, digits: text };
}

// The inverse of formatMoney, for anything a person types into a money or number field:
// "$1,240,000.50" -> 1240000.5; "(500)" and "$(500)" -> -500; "1 200" -> 1200; "" and "n/a"
// -> null. One implementation, because a copy that forgets one of these shapes silently saves
// null and the figure disappears from the screen it was typed into.
export function parseMoney(value: string | undefined): number | null {
  if (value === undefined) return null;
  const read = readMoneyText(value);
  if (!read) return null;
  const number = Number(read.digits);
  return read.negative ? -number : number;
}

// Every money column is numeric(14,2): twelve digits before the point and two after. A larger
// figure fails the whole save with a database error, and a third decimal is rounded away
// without a word, so a field or an import line checks typed text against both first. Text
// parseMoney cannot read at all is the third problem: saved as is, it becomes a blank or a zero
// nobody typed.
const MONEY_LIMIT = 1e12;

export type MoneyProblem = "not_a_number" | "too_large" | "too_precise";

// The import's phrasing: 'direct costs "6O000" is not a number.'
export const MONEY_PROBLEM_TEXT: Record<MoneyProblem, string> = {
  not_a_number: "is not a number",
  too_large: "is too large to save",
  too_precise: "has more than two decimal places",
};

// Why typed text will not save as a money figure, or null when it will. A blank is not a
// problem here: whether a field may be left empty is the caller's call.
export function moneyProblem(value: string | undefined): MoneyProblem | null {
  if (value === undefined || value.trim() === "") return null;
  const read = readMoneyText(value);
  if (!read) return "not_a_number";
  if (Number(read.digits) >= MONEY_LIMIT) return "too_large";
  const decimals = (read.digits.split(".")[1] ?? "").replace(/0+$/, "");
  if (decimals.length > 2) return "too_precise";
  return null;
}

// The message under a money field in a dialog, saying what to type: "Enter the budget as a
// number, like 12000." Null when the text will save.
export function moneyFieldError(label: string, value: string, example: string): string | null {
  const problem = moneyProblem(value);
  if (problem === "not_a_number") return `Enter ${label} as a number, like ${example}.`;
  if (problem === "too_large") return `Check ${label}: the figure is too large to save.`;
  if (problem === "too_precise") return `Enter ${label} with at most two decimal places.`;
  return null;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return number.format(value);
}

// fraction 0.427 -> "43%"
export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return EMPTY;
  return `${(fraction * 100).toFixed(digits)}%`;
}

// Date-only strings ("2026-09-01") are parsed as local dates so a period never shifts a
// day in western time zones; full timestamps parse as-is.
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined, style: "short" | "long" = "short"): string {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return date.toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "Sep 1 to Sep 30, 2026" or "Dec 1, 2026 to Jan 31, 2027" across a year boundary.
export function formatPeriod(start: string, end: string): string {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return EMPTY;
  const sameYear = a.getFullYear() === b.getFullYear();
  const startText = a.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endText = b.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startText} to ${endText}`;
}

// Today as a date-only string in local time (for date inputs and period defaults).
export function todayIso(): string {
  return toDateOnly(new Date());
}

export function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function displayName(profile: Pick<Profile, "full_name" | "email">): string {
  const name = profile.full_name?.trim();
  return name && name.length > 0 ? name : profile.email;
}

export function initials(profile: Pick<Profile, "full_name" | "email">): string {
  const name = profile.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase();
  }
  return profile.email.slice(0, 2).toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
