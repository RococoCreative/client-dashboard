// Proves the shared sync parser: header matching, cell types that never guess a number from text
// or turn blank into zero, blank rows skipped and counted, and any bad row failing the table.
import { describe, expect, it } from "vitest";
import { isBlankCell, mapRows, normalizeHeader, parseCell, serialToIsoDate } from "../../../supabase/functions/_shared/sync/parse.ts";
import type { CellValue, FieldMapEntry, RawRow, RawTable } from "../../../supabase/functions/_shared/sync/types.ts";

const FM: FieldMapEntry[] = [
  { header: "Job", key: "job", label: "Job", type: "text", unit: null, required: true },
  { header: "Contract amount", key: "amount", label: "Contract amount", type: "currency", unit: "USD", required: true },
  { header: "Margin", key: "margin", label: "Margin", type: "percent", unit: null, required: false },
  { header: "Signed on", key: "signed", label: "Signed on", type: "date", unit: null, required: false },
];
const HEADERS: CellValue[] = ["Job ", "Contract Amount ($)", "MARGIN", "Signed on"];

// Data rows start on sheet row 2, under the header.
function rows(...cells: CellValue[][]): RawRow[] {
  return cells.map((c, i) => ({ cells: c, ref: { row: i + 2 } }));
}
function table(headers: CellValue[], ...cells: CellValue[][]): RawTable {
  return { headers, rows: rows(...cells) };
}

describe("normalizeHeader", () => {
  it("lowercases, drops parenthesised text and collapses punctuation", () => {
    expect(normalizeHeader("Net Profit ($)")).toBe("net_profit");
    expect(normalizeHeader("  Period Start ")).toBe("period_start");
  });
});

describe("serialToIsoDate", () => {
  it("reads a spreadsheet serial as a UTC calendar date", () => {
    expect(serialToIsoDate(45658)).toBe("2025-01-01");
    expect(serialToIsoDate(45658.75)).toBe("2025-01-01");
    expect(serialToIsoDate(25569)).toBe("1970-01-01");
    expect(serialToIsoDate(46022)).toBe("2025-12-31");
  });
});

describe("isBlankCell", () => {
  it("treats missing, null, empty and whitespace as blank and nothing else", () => {
    expect(isBlankCell(undefined)).toBe(true);
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell("")).toBe(true);
    expect(isBlankCell("   ")).toBe(true);
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell(false)).toBe(false);
    expect(isBlankCell("x")).toBe(false);
  });
});

describe("parseCell", () => {
  it("reads blank as null for every type", () => {
    expect(parseCell(null, "currency")).toEqual({ ok: true, value: null });
    expect(parseCell("", "number")).toEqual({ ok: true, value: null });
    expect(parseCell(undefined, "date")).toEqual({ ok: true, value: null });
    expect(parseCell("  ", "text")).toEqual({ ok: true, value: null });
  });

  it("reads text as a trimmed string", () => {
    expect(parseCell(" Sample ", "text")).toEqual({ ok: true, value: "Sample" });
    expect(parseCell(101, "text")).toEqual({ ok: true, value: "101" });
    expect(parseCell(true, "text")).toEqual({ ok: true, value: "true" });
  });

  it("takes only a finite number for numeric types", () => {
    expect(parseCell(1250.5, "currency")).toEqual({ ok: true, value: 1250.5 });
    expect(parseCell(0, "number")).toEqual({ ok: true, value: 0 });
    expect(parseCell(0.25, "percent")).toEqual({ ok: true, value: 0.25 });
    expect(parseCell("1,250", "currency")).toEqual({ ok: false, message: 'Expected a number but found "1,250".' });
    expect(parseCell("$5", "currency").ok).toBe(false);
    expect(parseCell("25%", "percent").ok).toBe(false);
    expect(parseCell(true, "number").ok).toBe(false);
    expect(parseCell(Infinity, "number").ok).toBe(false);
  });

  it("reads a date from a serial or an ISO date and nothing else", () => {
    expect(parseCell(45658, "date")).toEqual({ ok: true, value: "2025-01-01" });
    expect(parseCell("2026-08-14", "date")).toEqual({ ok: true, value: "2026-08-14" });
    expect(parseCell("08/14/2026", "date")).toEqual({ ok: false, message: 'Expected a date but found "08/14/2026".' });
    expect(parseCell(true, "date").ok).toBe(false);
  });
});

describe("mapRows", () => {
  it("matches headers however they are written", () => {
    const result = mapRows(
      table(HEADERS, ["Sample job 101", 1000, 0.2, "2026-08-14"], ["Sample job 102", 2000, 0.3, 45658]),
      FM,
      ["job"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].data).toEqual({ job: "Sample job 101", amount: 1000, margin: 0.2, signed: "2026-08-14" });
    expect(result.rows[1].data.signed).toBe("2025-01-01");
    expect(result.rows[0].key).toBe('["Sample job 101"]');
  });

  it("fails when a required column is missing", () => {
    const result = mapRows(table(["Job", "Margin"], ["Sample job 101", 0.2]), FM, ["job"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "missing_header", field: "amount", row: null });
    expect(result.errors[0].message).toBe('The column "Contract amount" is missing.');
    expect(result.rowsBlank).toBe(0);
    expect(result.rowsRead).toBe(1);
  });

  it("reads a missing optional column as blank", () => {
    const result = mapRows(table(["Job", "Contract amount"], ["Sample job 101", 1000], ["Sample job 102", 2000]), FM, ["job"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.data.margin)).toEqual([null, null]);
  });

  it("reads missing trailing cells as blank", () => {
    const result = mapRows(table(HEADERS, ["Sample job 101", 1000]), FM, ["job"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].data).toEqual({ job: "Sample job 101", amount: 1000, margin: null, signed: null });
  });

  it("skips and counts a row whose mapped cells are all blank", () => {
    const result = mapRows(
      table(
        [...HEADERS, "Notes"],
        ["Sample job 101", 1000, null, null, ""],
        ["", null, "  ", null, "A note on an empty row"],
        ["Sample job 102", 2000],
      ),
      FM,
      ["job"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowsRead).toBe(3);
    expect(result.rowsBlank).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it("reports text in a number column with its row and field", () => {
    const result = mapRows(table(HEADERS, ["Sample job 101", 1000], ["Sample job 102", "abc"]), FM, ["job"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { code: "wrong_type", row: 3, field: "amount", message: 'Row 3, Contract amount: Expected a number but found "abc".' },
    ]);
  });

  it("reports a blank required cell", () => {
    const result = mapRows(table(HEADERS, ["Sample job 101", null]), FM, ["job"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ code: "required_blank", row: 2, field: "amount", message: "Row 2: Contract amount is blank." }]);
  });

  it("fails the whole table on a repeated record key", () => {
    const result = mapRows(table(HEADERS, ["Sample job 101", 1000], ["Sample job 101", 2000]), FM, ["job"]);
    expect(result.ok).toBe(false);
    expect("rows" in result).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { code: "duplicate_key", row: 3, field: null, message: "Row 3 repeats the record key of row 2." },
    ]);
  });

  it("keys rows by their row number when there is no record key", () => {
    const withRef = mapRows(table(HEADERS, ["Sample job 101", 1000], ["Sample job 101", 2000]), FM, []);
    expect(withRef.ok && withRef.rows.map((r) => r.key)).toEqual(["row:2", "row:3"]);
    const withoutRef = mapRows(
      { headers: HEADERS, rows: [{ cells: ["Sample job 101", 1000], ref: {} }, { cells: ["Sample job 102", 2000], ref: {} }] },
      FM,
      [],
    );
    expect(withoutRef.ok && withoutRef.rows.map((r) => r.key)).toEqual(["row:1", "row:2"]);
  });

  it("keeps unmapped columns out of the data", () => {
    const result = mapRows(table([...HEADERS, "Notes"], ["Sample job 101", 1000, null, null, "A note"]), FM, ["job"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.rows[0].data).sort()).toEqual(["amount", "job", "margin", "signed"]);
  });

  it("carries the row's reference as its source_ref", () => {
    const ref = { spreadsheet_id: "sample-sheet", sheet_gid: 0, row: 2 };
    const result = mapRows({ headers: HEADERS, rows: [{ cells: ["Sample job 101", 1000], ref }] }, FM, ["job"]);
    expect(result.ok && result.rows[0].source_ref).toEqual(ref);
  });

  it("rejects a field map that cannot work before reading any row", () => {
    const empty = mapRows(table(HEADERS, ["Sample job 101", 1000]), [], []);
    expect(empty).toEqual({
      ok: false,
      errors: [{ code: "bad_config", row: null, field: null, message: "No fields are mapped." }],
      rowsRead: 1,
      rowsBlank: 0,
    });
    const twice = mapRows(table(HEADERS), [FM[0], { ...FM[1], key: "job" }], ["job"]);
    expect(!twice.ok && twice.errors.map((e) => [e.code, e.message])).toEqual([["bad_config", "Two fields share the key job."]]);
    const unmappedKey = mapRows(table(HEADERS), FM, ["phase"]);
    expect(!unmappedKey.ok && unmappedKey.errors.map((e) => [e.code, e.message])).toEqual([
      ["bad_config", "The record key names a field that is not mapped: phase."],
    ]);
  });

  it("stops listing errors at 50 but fails the table", () => {
    const many = Array.from({ length: 60 }, (_, i): CellValue[] => [`Sample job ${i + 1}`, "abc"]);
    const result = mapRows(table(HEADERS, ...many), FM, ["job"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(50);
    expect(result.rowsRead).toBe(60);
  });

  it("reads numeric and null header cells", () => {
    const fieldMap: FieldMapEntry[] = [
      { header: "2026", key: "year_total", label: "2026", type: "number", unit: null, required: true },
      { header: "Notes", key: "notes", label: "Notes", type: "text", unit: null, required: false },
    ];
    const result = mapRows(table([2026, null, "Notes"], [5, "ignored", "Sample note"]), fieldMap, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].data).toEqual({ year_total: 5, notes: "Sample note" });
  });
});
