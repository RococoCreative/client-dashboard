import { describe, expect, it } from "vitest";
import { deriveSnapshot, parsePeriod, parseSnapshotsCsv, periodLabel, snapPeriodEnd } from "./financials.ts";

describe("financial snapshots", () => {
  it("derives margins and honors a net override", () => {
    const derived = deriveSnapshot({ revenue: 400000, cogs: 260000, opex: 90000, net_profit: null });
    expect(derived.grossProfit).toBe(140000);
    expect(derived.grossMargin).toBeCloseTo(0.35);
    expect(derived.net).toBe(50000);
    expect(derived.netMargin).toBeCloseTo(0.125);
    expect(deriveSnapshot({ revenue: 100, cogs: 50, opex: 30, net_profit: 12 }).net).toBe(12);
    expect(deriveSnapshot({ revenue: 0, cogs: 0, opex: 0, net_profit: null }).grossMargin).toBeNull();
  });

  it("labels and closes periods", () => {
    expect(periodLabel("month", "2026-09-01")).toBe("Sep 2026");
    expect(periodLabel("quarter", "2026-07-01")).toBe("Q3 2026");
    expect(periodLabel("year", "2026-01-01")).toBe("2026");
    expect(snapPeriodEnd("month", "2026-02-01")).toBe("2026-02-28");
    expect(snapPeriodEnd("quarter", "2026-07-01")).toBe("2026-09-30");
    expect(snapPeriodEnd("year", "2026-01-01")).toBe("2026-12-31");
  });

  it("reads the period formats people type", () => {
    expect(parsePeriod("2026-09-15")).toEqual({ type: "month", start: "2026-09-01" });
    expect(parsePeriod("2026-09")).toEqual({ type: "month", start: "2026-09-01" });
    expect(parsePeriod("9/2026")).toEqual({ type: "month", start: "2026-09-01" });
    expect(parsePeriod("Sep 2026")).toEqual({ type: "month", start: "2026-09-01" });
    expect(parsePeriod("September 2026")).toEqual({ type: "month", start: "2026-09-01" });
    expect(parsePeriod("Q3 2026")).toEqual({ type: "quarter", start: "2026-07-01" });
    expect(parsePeriod("2026-Q4")).toEqual({ type: "quarter", start: "2026-10-01" });
    expect(parsePeriod("2026")).toEqual({ type: "year", start: "2026-01-01" });
    expect(parsePeriod("2026-08-15", "quarter")).toEqual({ type: "quarter", start: "2026-07-01" });
    expect(parsePeriod("soon")).toBeNull();
  });

  it("maps a spreadsheet export with loose headers and reports bad lines", () => {
    const result = parseSnapshotsCsv(
      "Period,Revenue,Cost of Goods Sold,Operating Expenses,Net Profit,Cash on hand\n" +
        "Jul 2026,\"$412,000\",\"$268,000\",\"$96,000\",,\"$155,000\"\n" +
        "Aug 2026,455000,290000,98000,60000,171000\n" +
        "Aug 2026,460000,290000,98000,,171000\n" +
        "nonsense,1,2,3,,\n" +
        "Sep 2026,,1,2,,\n",
    );
    expect(result.errors).toEqual([
      'Line 5: could not read the period "nonsense".',
      "Line 6: revenue is missing or not a number.",
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ period_type: "month", period_start: "2026-07-01", period_end: "2026-07-31", revenue: 412000, cogs: 268000, opex: 96000, net_profit: null, cash_on_hand: 155000 });
    // The later duplicate wins.
    expect(result.rows[1].revenue).toBe(460000);
  });

  it("flags an empty file", () => {
    expect(parseSnapshotsCsv("").errors[0]).toMatch(/No rows/);
  });
});
