// How an imported value reads on screen, by the type its source maps it to. One place, so every
// table of synced values says the same thing: a blank is a hyphen and never a zero, and a value
// that is not what its type expects shows as it came rather than being coerced into a figure.
import type { FieldType } from "../../types/database.ts";
import { formatDate, formatMoney, formatNumber, formatPercent, parseDate, pluralize } from "../format.ts";

const EMPTY = "-";

export function formatMappedValue(value: string | number | null, type: FieldType): string {
  if (value === null || value === "") return EMPTY;
  if (type === "text") return String(value);
  if (type === "date") return typeof value === "string" && parseDate(value) ? formatDate(value) : String(value);
  if (typeof value !== "number" || Number.isNaN(value)) return String(value);
  if (type === "currency") return formatMoney(value);
  if (type === "percent") return formatPercent(value, 1);
  return formatNumber(value);
}

// How long ago a source last synced, in the plainest unit that reads well.
export function formatAge(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours < 48) return pluralize(Math.floor(hours), "hour");
  return pluralize(Math.floor(hours / 24), "day");
}
