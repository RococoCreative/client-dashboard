// Financial snapshot math and the CSV import mapping. Pure and tested. Margins derive from
// the stored figures; periods snap to the first day of their month, quarter, or year so
// two uploads of the same month land on the same row.
import { CsvError, otherDelimiter, readCsv, type CsvTable } from "./csv.ts";
import { periodEnd, periodStart } from "./gsr/cycles.ts";
import { MONEY_PROBLEM_TEXT, moneyProblem, parseDate, parseMoney } from "./format.ts";
import type { Cadence, FinancialSnapshot, PeriodType } from "../types/database.ts";

const CADENCE_FOR: Record<PeriodType, Cadence> = { month: "monthly", quarter: "quarterly", year: "annual" };

export function snapPeriodStart(type: PeriodType, date: Date): string {
  return periodStart(CADENCE_FOR[type], date);
}

export function snapPeriodEnd(type: PeriodType, start: string): string {
  return periodEnd(CADENCE_FOR[type], start) ?? start;
}

// "Sep 2026", "Q3 2026", "2026".
export function periodLabel(type: PeriodType, start: string): string {
  const date = parseDate(start);
  if (!date) return start;
  if (type === "year") return String(date.getFullYear());
  if (type === "quarter") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export interface SnapshotDerived {
  grossProfit: number;
  grossMargin: number | null;
  net: number;
  netMargin: number | null;
}

export function deriveSnapshot(s: Pick<FinancialSnapshot, "revenue" | "cogs" | "opex" | "net_profit">): SnapshotDerived {
  const grossProfit = s.revenue - s.cogs;
  const net = s.net_profit ?? s.revenue - s.cogs - s.opex;
  return {
    grossProfit,
    grossMargin: s.revenue > 0 ? grossProfit / s.revenue : null,
    net,
    netMargin: s.revenue > 0 ? net / s.revenue : null,
  };
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The period_type cell: the words, their -ly forms, and the abbreviations exports use.
const TYPE_ABBREVIATIONS = new Map<string, PeriodType>([
  ["m", "month"],
  ["mo", "month"],
  ["mth", "month"],
  ["q", "quarter"],
  ["qtr", "quarter"],
  ["y", "year"],
  ["yr", "year"],
]);

function normalizeType(raw: string): PeriodType | null {
  const text = raw.trim().toLowerCase().replace(/\.$/, "");
  const abbreviated = TYPE_ABBREVIATIONS.get(text);
  if (abbreviated) return abbreviated;
  if (text.startsWith("month")) return "month";
  if (text.startsWith("quarter")) return "quarter";
  if (text.startsWith("year") || text.startsWith("annual")) return "year";
  return null;
}

// The date the numbers name, or null when they name none. Built without a check, April 31 or
// month 13 rolls forward into the next period and overwrites it.
function calendarDate(year: number, month: number, day = 1): Date | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function snapped(type: PeriodType, date: Date | null): { type: PeriodType; start: string } | null {
  return date ? { type, start: snapPeriodStart(type, date) } : null;
}

// Reads the period cell of a spreadsheet export in the forms people actually type:
// 2026-09-01, 2026-09, 9/2026, Sep 2026, September 2026, Q3 2026, 2026-Q3, 2026.
// A date or a month takes its period type from the hint (a month by default). A quarter or a
// bare year names its own type, so a hint that says otherwise reads as nothing at all rather
// than one of the two quietly winning.
export function parsePeriod(raw: string, typeHint: PeriodType | null = null): { type: PeriodType; start: string } | null {
  const text = raw.trim();
  if (!text) return null;
  let match: RegExpExecArray | null;

  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    return snapped(typeHint ?? "month", calendarDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  if ((match = /^(\d{4})[-/](\d{1,2})$/.exec(text))) {
    return snapped(typeHint ?? "month", calendarDate(Number(match[1]), Number(match[2])));
  }
  if ((match = /^(\d{1,2})[-/](\d{4})$/.exec(text))) {
    return snapped(typeHint ?? "month", calendarDate(Number(match[2]), Number(match[1])));
  }
  if ((match = /^q([1-4])\s*[-\s]?\s*(\d{4})$/i.exec(text)) || (match = /^(\d{4})\s*[-\s]?\s*q([1-4])$/i.exec(text))) {
    if (typeHint && typeHint !== "quarter") return null;
    const quarter = Number(match[1].length === 4 ? match[2] : match[1]);
    const year = Number(match[1].length === 4 ? match[1] : match[2]);
    return snapped("quarter", calendarDate(year, (quarter - 1) * 3 + 1));
  }
  if ((match = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(text))) {
    const index = MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase());
    if (index === -1) return null;
    return snapped(typeHint ?? "month", calendarDate(Number(match[2]), index + 1));
  }
  if ((match = /^(\d{4})$/.exec(text))) {
    if (typeHint && typeHint !== "year") return null;
    return { type: "year", start: `${match[1]}-01-01` };
  }
  return null;
}

interface CsvImportRow {
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  opex: number;
  net_profit: number | null;
  cash_on_hand: number | null;
  notes: string | null;
}

export interface CsvImportResult {
  rows: CsvImportRow[];
  errors: string[];
}

function pick(record: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

export const CSV_HEADER_HELP =
  "Columns (any order, header names are flexible): period, revenue, cogs, opex, and optionally period_type, net_profit, cash_on_hand, notes. Separate them with commas.";

export const CSV_SAMPLE = "period,revenue,cogs,opex,net_profit,cash_on_hand\n2026-07,412000,268000,96000,,155000\nAug 2026,455000,290000,98000,,171000\n";

const PERIOD_KEYS = ["period_start", "period", "month", "quarter", "year", "date", "start"];
const TYPE_KEYS = ["period_type", "type"];
const NOTES_KEYS = ["notes", "note"];

type Figure = "revenue" | "cogs" | "opex" | "net_profit" | "cash_on_hand";

// Each figure, the header names it answers to, and how a line error names it.
const FIGURES: Array<{ figure: Figure; label: string; keys: string[] }> = [
  { figure: "revenue", label: "revenue", keys: ["revenue", "sales", "income", "total_revenue"] },
  { figure: "cogs", label: "direct costs", keys: ["cogs", "cost_of_goods_sold", "direct_costs", "job_costs", "cost_of_sales"] },
  { figure: "opex", label: "overhead", keys: ["opex", "operating_expenses", "overhead", "expenses"] },
  { figure: "net_profit", label: "net profit", keys: ["net_profit", "net_income", "net"] },
  { figure: "cash_on_hand", label: "cash on hand", keys: ["cash_on_hand", "cash"] },
];

// Every header key the import reads, and how a message names what it reads as.
const READ_KEYS = new Map<string, string>([
  ...PERIOD_KEYS.map((key): [string, string] => [key, "the period"]),
  ...TYPE_KEYS.map((key): [string, string] => [key, "the period type"]),
  ...NOTES_KEYS.map((key): [string, string] => [key, "notes"]),
  ...FIGURES.flatMap((f) => f.keys.map((key): [string, string] => [key, f.label])),
]);

const PERIOD_NOUN: Record<PeriodType, string> = { month: "a month", quarter: "a quarter", year: "a year" };

// '"A" and "B" both', or '"A", "B" and "C" all'.
function headerList(headers: string[]): string {
  const quoted = headers.map((h) => `"${h}"`);
  const last = quoted.pop();
  return `${quoted.join(", ")} and ${last} ${headers.length === 2 ? "both" : "all"}`;
}

// How a file the CSV reader will not guess at is reported, by what is wrong with it.
function csvProblemText(err: CsvError): string {
  if (err.problem === "extra_cells") {
    return `Line ${err.line}: this line has more cells than the header row has columns, so some of it would be left out. Check it for a stray comma or quote, then import again.`;
  }
  if (err.problem === "text_after_quote") {
    return err.endLine === err.line
      ? `Line ${err.line}: a quoted cell has more text after its closing quote. Remove the stray quote, or double a quote meant to be inside the cell (""), then import again.`
      : `Line ${err.line}: a quote opens here and does not close until partway through a cell on line ${err.endLine}, so every line between would be read as one cell. Close or remove it, then import again.`;
  }
  return `Line ${err.line}: a quote opens here and never closes, so every line after it would be read as one cell. Close or remove it, then import again.`;
}

// A cell that runs over several lines and takes in a line that starts out as a period of its
// own. A stray quote has swallowed the lines after it and closed on a quote that happened to
// end a cell, so the reader cannot tell. Read on, those periods would vanish into one note.
function swallowedPeriods(table: CsvTable): string[] {
  const periodColumns = table.columns.flatMap((c, index) => (PERIOD_KEYS.includes(c.key) ? [index] : []));
  return table.rows.flatMap(({ line, cells }) => {
    const swallowed = cells
      .flatMap((cell) => cell.split(/\r\n|\n|\r/).slice(1))
      .map((inner) => inner.split(","))
      .flatMap((pieces) => (pieces.length > 1 ? periodColumns.map((index) => pieces[index] ?? "") : []))
      .find((piece) => parsePeriod(piece) !== null);
    return swallowed === undefined
      ? []
      : [`Line ${line}: a quoted cell here runs on over several lines and takes in the period "${swallowed.trim()}" as text, so that period would be lost. A quote is probably out of place. Close or remove it, then import again.`];
  });
}

// Columns that read as the same thing, by what they read as rather than by header key:
// "Income (Actual)" beside "Revenue (Budget)" is two revenue columns, and taking either is a
// guess, as is falling back to the other on a line where the first is blank.
function duplicateColumns(table: CsvTable): string[] {
  const byLabel = new Map<string, string[]>();
  for (const { header, key } of table.columns) {
    const label = READ_KEYS.get(key);
    if (label) byLabel.set(label, [...(byLabel.get(label) ?? []), header]);
  }
  return [...byLabel]
    .filter(([, headers]) => headers.length > 1)
    .map(([label, headers]) => `The columns ${headerList(headers)} read as ${label}. Rename or remove one, then import again.`);
}

// The file-level reasons to refuse an import outright: every line would otherwise be misread
// in the same way, or the import would pick between two columns without saying so.
function fileProblems(text: string): string[] {
  const delimiter = otherDelimiter(text);
  if (delimiter === ";") return ["This file is separated by semicolons, not commas. Save it as CSV (comma delimited) and import it again."];
  if (delimiter === "\t") return ["These rows are separated by tabs, which is how a spreadsheet copies cells. Save the sheet as CSV (comma delimited) and import that file."];
  return [];
}

export function parseSnapshotsCsv(text: string): CsvImportResult {
  const rows: CsvImportRow[] = [];
  const errors: string[] = fileProblems(text);
  if (errors.length > 0) return { rows, errors };
  let table: CsvTable;
  try {
    table = readCsv(text);
  } catch (err) {
    if (!(err instanceof CsvError)) throw err;
    errors.push(csvProblemText(err));
    return { rows, errors };
  }
  if (table.columns.length === 0) {
    errors.push("No rows found. The first line must be the header row.");
    return { rows, errors };
  }
  // Two columns that read as the same figure (a budget beside an actual, or a percentage beside
  // an amount), or lines lost inside a note. Whichever the import took, it would be a guess
  // written over a real period.
  errors.push(...duplicateColumns(table), ...swallowedPeriods(table));
  if (errors.length > 0) return { rows, errors };
  if (table.records.length === 0) {
    errors.push("The file has a header row but no periods under it.");
    return { rows, errors };
  }

  table.records.forEach((record, index) => {
    const { line } = table.rows[index];
    const periodText = pick(record, PERIOD_KEYS);
    const typeText = pick(record, TYPE_KEYS);
    const typeHint = typeText === undefined ? null : normalizeType(typeText);
    if (typeText !== undefined && typeHint === null) {
      errors.push(`Line ${line}: the period type "${typeText.trim()}" is not month, quarter or year.`);
      return;
    }
    const period = periodText ? parsePeriod(periodText, typeHint) : null;
    if (!period) {
      const unhinted = periodText && typeHint ? parsePeriod(periodText, null) : null;
      errors.push(
        unhinted
          ? `Line ${line}: "${periodText!.trim()}" is ${PERIOD_NOUN[unhinted.type]}, but the period type says ${typeHint}.`
          : `Line ${line}: could not read the period "${periodText ?? ""}".`,
      );
      return;
    }
    // A cell that is filled in but will not save is reported, never read as zero or blank: a
    // cost read as zero is a 100% margin nobody earned, written over the real period.
    const figures = {} as Record<Figure, number | null>;
    let unreadable = false;
    for (const { figure, label, keys } of FIGURES) {
      const raw = pick(record, keys);
      const problem = moneyProblem(raw);
      if (problem) {
        errors.push(`Line ${line}: ${label} "${raw!.trim()}" ${MONEY_PROBLEM_TEXT[problem]}.`);
        unreadable = true;
      }
      figures[figure] = parseMoney(raw);
    }
    if (unreadable) return;
    if (figures.revenue === null) {
      errors.push(`Line ${line}: revenue is missing.`);
      return;
    }
    rows.push({
      period_type: period.type,
      period_start: period.start,
      period_end: snapPeriodEnd(period.type, period.start),
      revenue: figures.revenue,
      cogs: figures.cogs ?? 0,
      opex: figures.opex ?? 0,
      net_profit: figures.net_profit,
      cash_on_hand: figures.cash_on_hand,
      notes: pick(record, NOTES_KEYS) ?? null,
    });
  });
  // The same period twice in one file: the later line wins.
  const byKey = new Map<string, CsvImportRow>();
  rows.forEach((row) => byKey.set(`${row.period_type}:${row.period_start}`, row));
  return { rows: [...byKey.values()].sort((a, b) => a.period_start.localeCompare(b.period_start)), errors };
}
