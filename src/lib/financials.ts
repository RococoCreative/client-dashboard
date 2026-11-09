// Financial snapshot math and the CSV import mapping. Pure and tested. Margins derive from
// the stored figures; periods snap to the first day of their month, quarter, or year so
// two uploads of the same month land on the same row.
import { CsvError, lineCells, otherDelimiter, physicalLines, readCsv, type CsvTable } from "./csv.ts";
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

// The period_type cell: the words, their plural and -ly forms, and the abbreviations exports use.
// The whole cell has to be one of them. A phrase that only starts with one ("Year to date",
// "Annual maintenance") is no period type, and reading it as one files the figures under the
// wrong period.
const TYPE_WORDS = new Map<string, PeriodType>([
  ["m", "month"],
  ["mo", "month"],
  ["mth", "month"],
  ["month", "month"],
  ["months", "month"],
  ["monthly", "month"],
  ["q", "quarter"],
  ["qtr", "quarter"],
  ["quarter", "quarter"],
  ["quarters", "quarter"],
  ["quarterly", "quarter"],
  ["y", "year"],
  ["yr", "year"],
  ["year", "year"],
  ["years", "year"],
  ["yearly", "year"],
  ["annual", "year"],
  ["annually", "year"],
]);

function normalizeType(raw: string): PeriodType | null {
  return TYPE_WORDS.get(raw.trim().toLowerCase().replace(/\.$/, "")) ?? null;
}

// The date the numbers name, or null when they name none. Built without a check, April 31 or
// month 13 rolls forward into the next period and overwrites it.
function calendarDate(year: number, month: number, day = 1): Date | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

// The years a period may name. Postgres has no year 0000 and refuses that date outright, and a
// year far from the present is a typo, not a period to write figures over.
const PERIOD_YEARS = { first: 1900, last: 2100 } as const;

function saneYear(year: number): boolean {
  return year >= PERIOD_YEARS.first && year <= PERIOD_YEARS.last;
}

// What a period cell says, as written and before any check on the date: its type, and the year,
// month and day it names. Null when it is none of the forms parsePeriod reads.
interface PeriodParts {
  type: PeriodType;
  year: number;
  month: number;
  day: number;
}

function periodParts(raw: string, typeHint: PeriodType | null): PeriodParts | null {
  const text = raw.trim();
  if (!text) return null;
  const dated = typeHint ?? "month";
  let match: RegExpExecArray | null;

  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    return { type: dated, year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if ((match = /^(\d{4})[-/](\d{1,2})$/.exec(text))) {
    return { type: dated, year: Number(match[1]), month: Number(match[2]), day: 1 };
  }
  if ((match = /^(\d{1,2})[-/](\d{4})$/.exec(text))) {
    return { type: dated, year: Number(match[2]), month: Number(match[1]), day: 1 };
  }
  if ((match = /^q([1-4])\s*[-\s]?\s*(\d{4})$/i.exec(text)) || (match = /^(\d{4})\s*[-\s]?\s*q([1-4])$/i.exec(text))) {
    if (typeHint && typeHint !== "quarter") return null;
    const quarter = Number(match[1].length === 4 ? match[2] : match[1]);
    const year = Number(match[1].length === 4 ? match[1] : match[2]);
    return { type: "quarter", year, month: (quarter - 1) * 3 + 1, day: 1 };
  }
  if ((match = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(text))) {
    const index = MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase());
    if (index === -1) return null;
    return { type: dated, year: Number(match[2]), month: index + 1, day: 1 };
  }
  if ((match = /^(\d{4})$/.exec(text))) {
    if (typeHint && typeHint !== "year") return null;
    return { type: "year", year: Number(match[1]), month: 1, day: 1 };
  }
  return null;
}

// Reads the period cell of a spreadsheet export in the forms people actually type:
// 2026-09-01, 2026-09, 9/2026, Sep 2026, September 2026, Q3 2026, 2026-Q3, 2026.
// A date or a month takes its period type from the hint (a month by default). A quarter or a
// bare year names its own type, so a hint that says otherwise reads as nothing at all rather
// than one of the two quietly winning. A year outside PERIOD_YEARS reads as nothing too.
export function parsePeriod(raw: string, typeHint: PeriodType | null = null): { type: PeriodType; start: string } | null {
  const parts = periodParts(raw, typeHint);
  if (!parts || !saneYear(parts.year)) return null;
  const date = calendarDate(parts.year, parts.month, parts.day);
  return date ? { type: parts.type, start: snapPeriodStart(parts.type, date) } : null;
}

// Whether a period cell is in a form parsePeriod reads but names a year outside PERIOD_YEARS.
// Read without the hint, so a year typed wrong is the thing a line error names first.
function yearOutOfRange(raw: string): boolean {
  const parts = periodParts(raw, null);
  return parts !== null && !saneYear(parts.year);
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
const REVENUE_KEYS = ["revenue", "sales", "income", "total_revenue"];

type Figure = "revenue" | "cogs" | "opex" | "net_profit" | "cash_on_hand";

// Each figure, the header names it answers to, and how a line error names it.
const FIGURES: Array<{ figure: Figure; label: string; keys: string[] }> = [
  { figure: "revenue", label: "revenue", keys: REVENUE_KEYS },
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

// The period a physical line reads as when it stands alone as a line of the import, or null.
// It does when its period cell is in a period form and it either fills every column or reaches a
// revenue that is blank or a number. A note that only mentions a month ("Paid\nMar 2026, on
// time") does neither. The form is enough, as written and before any check on the date: a line
// whose year is out of range ("0000") would get its own line error, so it is a line too.
function linePeriod(cells: string[], width: number, periodColumns: number[], revenueColumns: number[]): string | null {
  const bare = (index: number) => (cells[index] ?? "").trim().replace(/^"|"$/g, "").trim();
  const period = periodColumns.map(bare).find((text) => periodParts(text, null) !== null);
  if (period === undefined) return null;
  if (cells.length >= width || revenueColumns.length === 0) return period;
  const revenue = revenueColumns.find((index) => index < cells.length);
  return revenue !== undefined && (bare(revenue) === "" || parseMoney(bare(revenue)) !== null) ? period : null;
}

function samePeriod(a: string, b: string): boolean {
  const left = parsePeriod(a);
  const right = parsePeriod(b);
  return left !== null && right !== null && left.type === right.type && left.start === right.start;
}

// A row whose physical lines read as a period the row does not keep, or as more periods than it
// holds: the header row holds none, and a line of the import holds one, its own period, and only
// when its period cell is in a period form. A quote out of place has run those lines together into one
// cell, and closed on a quote that happened to end a cell, so the reader cannot tell. Read on, a
// period vanishes into a note or a column name, or its figures land on another period. The lines
// are checked as written, so the columns can come in any order, and the row's own period is
// worked out first: a row whose own line is malformed (no period, an impossible one, or short of
// its revenue) still loses whatever other period its quote took in.
function swallowedPeriods(table: CsvTable, text: string): string[] {
  const lines = physicalLines(text);
  const indexes = (keys: string[]) => table.columns.flatMap((c, index) => (keys.includes(c.key) ? [index] : []));
  const periodColumns = indexes(PERIOD_KEYS);
  const revenueColumns = indexes(REVENUE_KEYS);
  const rows = table.header ? [{ row: table.header, holds: 0 }, ...table.rows.map((row) => ({ row, holds: 1 }))] : [];
  return rows.flatMap(({ row, holds }) => {
    if (row.endLine === row.line) return [];
    const periods = lines
      .slice(row.line - 1, row.endLine)
      // Read as the parser would first, then with every quote as a plain character: a stray-quote
      // run that closes on a ditto mark can leave a line whose own quotes pair up differently
      // (`Mar 2026,",300,6"`), and that line is still a period taken in.
      .map((line) => {
        const read = (cells: string[]) => linePeriod(cells, table.columns.length, periodColumns, revenueColumns);
        return read(lineCells(line)) ?? read(line.split(","));
      })
      .filter((period): period is string => period !== null);
    // The row's own period cell, read by form as linePeriod reads a line: "2026-04-31" or "0000"
    // is still the row's own (its line error names it), while a blank cell is none.
    const own = holds === 0 ? undefined : periodColumns.map((index) => (row.cells[index] ?? "").trim()).find((cell) => periodParts(cell, null) !== null);
    const foreign = periods.filter((period) => own === undefined || (period !== own && !samePeriod(period, own)));
    if (periods.length <= holds && foreign.length === 0) return [];
    // Name a period the row does not keep as its own: the one lost, not the one that survives.
    const lost = foreign[0] ?? periods[holds];
    return [`Line ${row.line}: a quoted cell here runs on over several lines and takes in the period "${lost}" as text, so that period would be lost. A quote is probably out of place. Close or remove it, then import again.`];
  });
}

// Whether a cell in a column headed just "Type" is about the period at all: it is a period type,
// or it holds a word that starts like one ("Quarter-end", "Qtrly", "Year-end", "Fiscal year",
// "Annual maintenance", "FY"). Looser than normalizeType on purpose. It only decides whether the
// column is the period type; normalizeType still decides what each cell reads as, so a cell
// that passes here and not there is refused on its line, never read as a month by default.
function mentionsPeriod(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  return normalizeType(text) !== null || /\b(month|mth|quarter|qtr|year|yr|annual|fy\b|ytd\b)/.test(text);
}

// Whether a cell says which set of figures a line is (actual, budget, forecast, plan). A Type
// column like that changes what every figure beside it means, so it is never left out: reading
// a budget line as actuals would be a silent wrong number.
function namesScenario(raw: string): boolean {
  return /\b(actuals?|budget(ed)?|forecast(ed)?|plan(ned)?|projected|projection|estimated?|target)\b/.test(raw.trim().toLowerCase());
}

// A column headed just "Type" is the period type unless none of its cells is about the period:
// then it means something else (a job type), and the import leaves it out like any other column
// it does not read, rather than refuse every line over it. One cell that mentions a period, or
// that names a set of figures (actual against budget), keeps the column, and any cell in it that
// is not a plain month, quarter or year is then refused on its line. A column with every cell blank names nothing and is kept
// too, so a period on two lines beside it is handled as in a file without it. A column headed
// "Period type" is always the period type. Returns the header of a column left out, or null.
function foreignTypeColumn(table: CsvTable): string | null {
  const typeColumns = table.columns.flatMap((c, index) => (c.key === "type" ? [index] : []));
  if (typeColumns.length === 0) return null;
  const cells = table.rows.flatMap((row) => typeColumns.map((index) => row.cells[index] ?? ""));
  if (cells.every((cell) => cell.trim() === "") || cells.some((cell) => mentionsPeriod(cell) || namesScenario(cell))) return null;
  return table.columns[typeColumns[0]].header;
}

// The table with the columns that read as `key` left out, as if their header named nothing.
function withoutKey(table: CsvTable, key: string): CsvTable {
  return {
    ...table,
    columns: table.columns.map((c) => (c.key === key ? { ...c, key: "" } : c)),
    records: table.records.map((record) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))),
  };
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
  const foreignType = foreignTypeColumn(table);
  if (foreignType !== null) table = withoutKey(table, "type");
  // Two columns that read as the same figure (a budget beside an actual, or a percentage beside
  // an amount), or lines lost inside a note. Whichever the import took, it would be a guess
  // written over a real period.
  errors.push(...duplicateColumns(table), ...swallowedPeriods(table, text));
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
    if (periodText && !period && yearOutOfRange(periodText)) {
      errors.push(`Line ${line}: the year in "${periodText.trim()}" is not between ${PERIOD_YEARS.first} and ${PERIOD_YEARS.last}.`);
      return;
    }
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
  // The same period twice in one file: the later line wins. Not beside a Type column the import
  // left out, which may be what tells those lines apart (an actual and a budget, or one line per
  // job): keeping the later one would drop the other with nothing said.
  const byKey = new Map<string, CsvImportRow>();
  for (const row of rows) {
    const key = `${row.period_type}:${row.period_start}`;
    if (foreignType !== null && byKey.has(key)) {
      errors.push(
        `${periodLabel(row.period_type, row.period_start)} is on more than one line, and the "${foreignType}" column, which the import does not read, may be what tells them apart. Keep one line per period, then import again.`,
      );
      return { rows: [], errors };
    }
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()].sort((a, b) => a.period_start.localeCompare(b.period_start)), errors };
}
