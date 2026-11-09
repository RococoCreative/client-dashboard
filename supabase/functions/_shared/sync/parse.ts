// Turns a provider's raw table into the rows a sync stores, by the source's own column map. It
// never guesses: text is never read as a number, blank is never zero, and one bad row fails the
// whole table so a half-read sheet never replaces good data. Shared by the app (the CSV upload
// reuses normalizeHeader) and the connections Edge Function.
import { buildRecordKey } from "./keys.ts";
import type { CellValue, FieldMapEntry, FieldType, MapResult, ParsedRow, ParsedValue, RawTable, ValidationError } from "./types.ts";

// Header keys are lowercased with spaces and punctuation collapsed to underscores, so
// "Net Profit" and "net_profit" and "NET PROFIT ($)" all read as net_profit.
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Day zero of a spreadsheet date serial, as days since 1970-01-01 (serial 25569).
export const SHEETS_SERIAL_EPOCH = 25569;

// A serial's calendar date in UTC; a fractional time of day never moves the date.
export function serialToIsoDate(serial: number): string {
  return new Date((serial - SHEETS_SERIAL_EPOCH) * 86400000).toISOString().slice(0, 10);
}

export function isBlankCell(cell: CellValue | undefined): boolean {
  return cell === undefined || cell === null || (typeof cell === "string" && cell.trim() === "");
}

export type CellParse = { ok: true; value: ParsedValue } | { ok: false; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCell(cell: CellValue | undefined, type: FieldType): CellParse {
  if (isBlankCell(cell)) return { ok: true, value: null };
  switch (type) {
    case "text":
      return { ok: true, value: typeof cell === "string" ? cell.trim() : String(cell) };
    case "number":
    case "currency":
    case "percent":
      // A percent stays a fraction: 0.25 is 25%.
      if (typeof cell === "number" && Number.isFinite(cell)) return { ok: true, value: cell };
      return { ok: false, message: `Expected a number but found "${String(cell)}".` };
    case "date":
      // A serial past the calendar's range (an id typed into a date column) is no date at all.
      if (typeof cell === "number" && Number.isFinite(cell) && !Number.isNaN(new Date((cell - SHEETS_SERIAL_EPOCH) * 86400000).getTime())) {
        return { ok: true, value: serialToIsoDate(cell) };
      }
      if (typeof cell === "string" && ISO_DATE.test(cell.trim())) return { ok: true, value: cell.trim() };
      return { ok: false, message: `Expected a date but found "${String(cell)}".` };
  }
}

const MAX_ERRORS = 50;

export function mapRows(table: RawTable, fieldMap: FieldMapEntry[], recordKey: string[]): MapResult {
  const rowsRead = table.rows.length;

  // The column map itself, before any row.
  const configErrors: ValidationError[] = [];
  const badConfig = (message: string) => configErrors.push({ code: "bad_config", message, row: null, field: null });
  if (fieldMap.length === 0) badConfig("No fields are mapped.");
  const keys = new Set<string>();
  const repeated = new Set<string>();
  for (const entry of fieldMap) {
    if (keys.has(entry.key) && !repeated.has(entry.key)) {
      repeated.add(entry.key);
      badConfig(`Two fields share the key ${entry.key}.`);
    }
    keys.add(entry.key);
  }
  for (const key of recordKey) {
    if (!keys.has(key)) badConfig(`The record key names a field that is not mapped: ${key}.`);
  }
  if (configErrors.length > 0) return { ok: false, errors: configErrors, rowsRead, rowsBlank: 0 };

  // Each entry's column: the first header that normalizes the same way. -1 reads blank.
  const headers = table.headers.map((cell) => normalizeHeader(String(cell ?? "")));
  const columns = fieldMap.map((entry) => headers.indexOf(normalizeHeader(entry.header)));
  const headerErrors: ValidationError[] = [];
  fieldMap.forEach((entry, i) => {
    if (columns[i] === -1 && entry.required) {
      headerErrors.push({ code: "missing_header", message: `The column "${entry.header}" is missing.`, row: null, field: entry.key });
    }
  });
  if (headerErrors.length > 0) return { ok: false, errors: headerErrors, rowsRead, rowsBlank: 0 };

  const labels = new Map(fieldMap.map((entry) => [entry.key, entry.label]));
  const errors: ValidationError[] = [];
  let failed = false;
  const report = (error: ValidationError) => {
    failed = true;
    if (errors.length < MAX_ERRORS) errors.push(error);
  };

  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  let rowsBlank = 0;

  table.rows.forEach((raw, index) => {
    const rowNumber = typeof raw.ref.row === "number" ? raw.ref.row : index + 1;
    const cells = columns.map((column) => (column === -1 ? undefined : raw.cells[column]));
    if (cells.every(isBlankCell)) {
      rowsBlank += 1;
      return;
    }

    const data: Record<string, ParsedValue> = {};
    const reported = new Set<string>();
    fieldMap.forEach((entry, i) => {
      const parsed = parseCell(cells[i], entry.type);
      if (!parsed.ok) {
        data[entry.key] = null;
        reported.add(entry.key);
        report({ code: "wrong_type", message: `Row ${rowNumber}, ${entry.label}: ${parsed.message}`, row: rowNumber, field: entry.key });
        return;
      }
      data[entry.key] = parsed.value;
      if (parsed.value === null && entry.required) {
        reported.add(entry.key);
        report({ code: "required_blank", message: `Row ${rowNumber}: ${entry.label} is blank.`, row: rowNumber, field: entry.key });
      }
    });

    const key = buildRecordKey(data, recordKey, rowNumber);
    if (key === null) {
      for (const field of recordKey) {
        const value = data[field];
        if ((value === null || value === "") && !reported.has(field)) {
          report({
            code: "required_blank",
            message: `Row ${rowNumber}: ${labels.get(field)} is part of the record key and is blank.`,
            row: rowNumber,
            field,
          });
        }
      }
      return;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      report({ code: "duplicate_key", message: `Row ${rowNumber} repeats the record key of row ${first}.`, row: rowNumber, field: null });
      return;
    }
    seen.set(key, rowNumber);
    rows.push({ key, data, source_ref: raw.ref });
  });

  if (failed) return { ok: false, errors, rowsRead, rowsBlank };
  return { ok: true, rows, rowsRead, rowsBlank };
}
