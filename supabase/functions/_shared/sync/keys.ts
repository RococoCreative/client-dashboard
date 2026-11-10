// A synced row's identity within its run: the values of the source's record-key fields, so the
// same job or invoice keeps the same key from one sync to the next. Shared by the app and the
// connections Edge Function.
import type { ParsedValue } from "./types.ts";

function isBlank(value: ParsedValue | undefined): boolean {
  return value === null || value === undefined || value === "";
}

// Empty recordKey -> `row:${rowNumber}`. Otherwise JSON.stringify of the key fields' values in
// recordKey order; null when any key field is blank (mapRows reports required_blank).
export function buildRecordKey(data: Record<string, ParsedValue>, recordKey: string[], rowNumber: number): string | null {
  if (recordKey.length === 0) return `row:${rowNumber}`;
  const values = recordKey.map((key) => data[key]);
  if (values.some(isBlank)) return null;
  return JSON.stringify(values);
}
