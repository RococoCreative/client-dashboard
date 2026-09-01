// Financial snapshot math and the CSV import mapping. Pure and tested. Margins derive from
// the stored figures; periods snap to the first day of their month, quarter, or year so
// two uploads of the same month land on the same row.
import { csvToObjects, parseMoney } from "./csv.ts";
import { periodEnd, periodStart } from "./gsr/cycles.ts";
import { parseDate } from "./format.ts";
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

function normalizeType(raw: string | undefined): PeriodType | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("month")) return "month";
  if (text.startsWith("quarter") || text === "q") return "quarter";
  if (text.startsWith("year") || text.startsWith("annual")) return "year";
  return null;
}

// Reads the period cell of a spreadsheet export in the forms people actually type:
// 2026-09-01, 2026-09, 9/2026, Sep 2026, September 2026, Q3 2026, 2026-Q3, 2026.
export function parsePeriod(raw: string, typeHint: PeriodType | null = null): { type: PeriodType; start: string } | null {
  const text = raw.trim();
  if (!text) return null;
  let match: RegExpExecArray | null;

  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    const type = typeHint ?? "month";
    return { type, start: snapPeriodStart(type, new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) };
  }
  if ((match = /^(\d{4})[-/](\d{1,2})$/.exec(text))) {
    const type = typeHint ?? "month";
    return { type, start: snapPeriodStart(type, new Date(Number(match[1]), Number(match[2]) - 1, 1)) };
  }
  if ((match = /^(\d{1,2})[-/](\d{4})$/.exec(text))) {
    const type = typeHint ?? "month";
    return { type, start: snapPeriodStart(type, new Date(Number(match[2]), Number(match[1]) - 1, 1)) };
  }
  if ((match = /^q([1-4])\s*[-\s]?\s*(\d{4})$/i.exec(text)) || (match = /^(\d{4})\s*[-\s]?\s*q([1-4])$/i.exec(text))) {
    const quarter = Number(match[1].length === 4 ? match[2] : match[1]);
    const year = Number(match[1].length === 4 ? match[1] : match[2]);
    return { type: "quarter", start: snapPeriodStart("quarter", new Date(year, (quarter - 1) * 3, 1)) };
  }
  if ((match = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(text))) {
    const index = MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase());
    if (index === -1) return null;
    const type = typeHint === "quarter" ? "quarter" : "month";
    return { type, start: snapPeriodStart(type, new Date(Number(match[2]), index, 1)) };
  }
  if ((match = /^(\d{4})$/.exec(text))) {
    return { type: "year", start: `${match[1]}-01-01` };
  }
  return null;
}

export interface CsvImportRow {
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
  "Columns (any order, header names are flexible): period, revenue, cogs, opex, and optionally period_type, net_profit, cash_on_hand, notes.";

export const CSV_SAMPLE = "period,revenue,cogs,opex,net_profit,cash_on_hand\n2026-07,412000,268000,96000,,155000\nAug 2026,455000,290000,98000,,171000\n";

export function parseSnapshotsCsv(text: string): CsvImportResult {
  const records = csvToObjects(text);
  const rows: CsvImportRow[] = [];
  const errors: string[] = [];
  if (records.length === 0) {
    errors.push("No rows found. The first line must be the header row.");
    return { rows, errors };
  }
  records.forEach((record, index) => {
    const line = index + 2;
    const periodText = pick(record, ["period_start", "period", "month", "quarter", "year", "date", "start"]);
    const typeHint = normalizeType(pick(record, ["period_type", "type"]));
    const period = periodText ? parsePeriod(periodText, typeHint) : null;
    if (!period) {
      errors.push(`Line ${line}: could not read the period "${periodText ?? ""}".`);
      return;
    }
    const revenue = parseMoney(pick(record, ["revenue", "sales", "income", "total_revenue"]));
    if (revenue === null) {
      errors.push(`Line ${line}: revenue is missing or not a number.`);
      return;
    }
    rows.push({
      period_type: period.type,
      period_start: period.start,
      period_end: snapPeriodEnd(period.type, period.start),
      revenue,
      cogs: parseMoney(pick(record, ["cogs", "cost_of_goods_sold", "direct_costs", "job_costs", "cost_of_sales"])) ?? 0,
      opex: parseMoney(pick(record, ["opex", "operating_expenses", "overhead", "expenses"])) ?? 0,
      net_profit: parseMoney(pick(record, ["net_profit", "net_income", "net"])),
      cash_on_hand: parseMoney(pick(record, ["cash_on_hand", "cash"])),
      notes: pick(record, ["notes", "note"]) ?? null,
    });
  });
  // The same period twice in one file: the later line wins.
  const byKey = new Map<string, CsvImportRow>();
  rows.forEach((row) => byKey.set(`${row.period_type}:${row.period_start}`, row));
  return { rows: [...byKey.values()].sort((a, b) => a.period_start.localeCompare(b.period_start)), errors };
}
