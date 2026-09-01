// Display formatting shared across pages: money, percentages, dates, periods, names. No
// em dashes anywhere in output; an empty value renders as a plain hyphen.
import type { Profile } from "../types/database.ts";

export const EMPTY = "-";

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
