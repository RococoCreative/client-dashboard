// The financial snapshot math and the CSV import: margins, periods, and every way a file is
// read, reported, or refused before anything is written over a real period.
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
      "Line 6: revenue is missing.",
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

describe("financial CSV import, strict", () => {
  it("reports a figure it cannot read instead of saving it as zero or blank", () => {
    const result = parseSnapshotsCsv(
      "period,revenue,cogs,opex,net_profit,cash_on_hand\n" +
        "2026-01,100000,6O000,2O000,,\n" +
        "2026-02,100000,n/a,TBD,,\n" +
        "2026-03,100000,,,,\n" +
        "2026-04,100000,50000,20000,1O000,\n" +
        "2026-05,100000,50000,20000,,lots\n",
    );
    expect(result.errors).toEqual([
      'Line 2: direct costs "6O000" is not a number.',
      'Line 2: overhead "2O000" is not a number.',
      'Line 3: direct costs "n/a" is not a number.',
      'Line 3: overhead "TBD" is not a number.',
      'Line 5: net profit "1O000" is not a number.',
      'Line 6: cash on hand "lots" is not a number.',
    ]);
    // A blank cost still reads as zero and a blank net or cash as not recorded.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ period_start: "2026-03-01", cogs: 0, opex: 0, net_profit: null, cash_on_hand: null });
  });

  it("names a missing revenue apart from an unreadable one", () => {
    const result = parseSnapshotsCsv("period,revenue,cogs\n2026-01,,1\n2026-02,€1000,1\n");
    expect(result.errors).toEqual(["Line 2: revenue is missing.", 'Line 3: revenue "€1000" is not a number.']);
    expect(result.rows).toEqual([]);
  });

  it("refuses a figure too large to save or with a third decimal place", () => {
    const result = parseSnapshotsCsv("period,revenue,cogs,opex\n2026-01,1000000000000,1,1\n2026-02,100,\"1.234,56\",1\n2026-03,100.50,1.10,0.333\n2026-04,999999999999.99,1,1\n");
    expect(result.errors).toEqual([
      'Line 2: revenue "1000000000000" is too large to save.',
      'Line 3: direct costs "1.234,56" has more than two decimal places.',
      'Line 4: overhead "0.333" has more than two decimal places.',
    ]);
    expect(result.rows.map((r) => r.revenue)).toEqual([999999999999.99]);
  });

  it("never rolls an impossible date into the next period", () => {
    for (const text of ["2026-04-31", "2026-02-29", "2026-13-01", "2026-00-10", "13/2026", "0/2026", "2026/13", "2026-00"]) {
      expect(parsePeriod(text)).toBeNull();
    }
    expect(parsePeriod("2028-02-29")).toEqual({ type: "month", start: "2028-02-01" });
    expect(parsePeriod("12/2026")).toEqual({ type: "month", start: "2026-12-01" });
    const result = parseSnapshotsCsv("period,revenue,cogs,opex\n2026-04-31,111,1,1\n2026-05-31,222,2,2\n");
    expect(result.errors).toEqual(['Line 2: could not read the period "2026-04-31".']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ period_start: "2026-05-01", revenue: 222 });
  });

  it("refuses a file where two columns read as the same figure", () => {
    const result = parseSnapshotsCsv("Period,Revenue (Actual),Revenue (Budget),COGS,COGS (%),Opex\nJan 2026,100000,250000,60000,60%,20000\n");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      'The columns "Revenue (Actual)" and "Revenue (Budget)" both read as revenue. Rename or remove one, then import again.',
      'The columns "COGS" and "COGS (%)" both read as direct costs. Rename or remove one, then import again.',
    ]);
    // Different header names for the same figure are two columns all the same: a budget beside
    // an actual is refused, never read as the revenue or used where the actual is blank.
    const synonyms = parseSnapshotsCsv(
      "Period,Income (Actual),Revenue (Budget),Cost of Sales (Actual),COGS (Budget),Opex\nJan 2026,100000,250000,60000,90000,20000\nFeb 2026,,250000,,90000,20000\n",
    );
    expect(synonyms.rows).toEqual([]);
    expect(synonyms.errors).toEqual([
      'The columns "Income (Actual)" and "Revenue (Budget)" both read as revenue. Rename or remove one, then import again.',
      'The columns "Cost of Sales (Actual)" and "COGS (Budget)" both read as direct costs. Rename or remove one, then import again.',
    ]);
    expect(parseSnapshotsCsv("Period,Sales (Actual),Revenue (Budget),Opex\nJan 2026,100000,250000,1\n").errors).toEqual([
      'The columns "Sales (Actual)" and "Revenue (Budget)" both read as revenue. Rename or remove one, then import again.',
    ]);
    expect(parseSnapshotsCsv("Month,Date,Revenue,Net,Net Income\nJan 2026,2026-01-31,1,1,1\n").errors).toEqual([
      'The columns "Month" and "Date" both read as the period. Rename or remove one, then import again.',
      'The columns "Net" and "Net Income" both read as net profit. Rename or remove one, then import again.',
    ]);
    // A repeated column the import does not read is no reason to refuse it.
    expect(parseSnapshotsCsv("period,revenue,memo (a),memo (b)\n2026-01,100,x,y\n").errors).toEqual([]);
  });

  it("refuses a file with a quote that never closes", () => {
    const result = parseSnapshotsCsv('period,revenue,notes\n2026-01,100,"draw pending\n2026-02,200,ok\n');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["Line 2: a quote opens here and never closes, so every line after it would be read as one cell. Close or remove it, then import again."]);
    // A stray quote that a later quoted cell, or a later inch mark, would otherwise close.
    const paid = parseSnapshotsCsv(
      'period,revenue,cogs,opex,notes\nFeb 2026,100,1,1,"draw pending\nMar 2026,210000,100000,50000,ok\nApr 2026,300,3,3,"Paid, on time"\n',
    );
    expect(paid).toEqual({
      rows: [],
      errors: [
        "Line 2: a quote opens here and does not close until partway through a cell on line 4, so every line between would be read as one cell. Close or remove it, then import again.",
      ],
    });
    const fine = parseSnapshotsCsv(
      'period,revenue,cogs,opex,notes\nJan 2026,1,1,1,a\nFeb 2026,100,1,1,"draw pending\nMar 2026,2,2,2,a\nApr 2026,3,3,3,b\nMay 2026,4,4,4,c\nJun 2026,5,5,5,"fine"\n',
    );
    expect(fine.rows).toEqual([]);
    expect(fine.errors).toEqual([
      "Line 3: a quote opens here and does not close until partway through a cell on line 7, so every line between would be read as one cell. Close or remove it, then import again.",
    ]);
    const inchMark = parseSnapshotsCsv('period,revenue,cogs,opex,notes\nFeb 2026,100,1,1,"draw pending\nMar 2026,210000,100000,50000,ok\nApr 2026,300,3,3,6"\nMay 2026,4,4,4,c\n');
    expect(inchMark.rows).toEqual([]);
    expect(inchMark.errors).toEqual([
      'Line 2: a quoted cell here runs on over several lines and takes in the period "Mar 2026" as text, so that period would be lost. A quote is probably out of place. Close or remove it, then import again.',
    ]);
    // The columns come in any order, so the lines a quote ran together are read as written: a
    // notes column before the period, after it, or between the figures loses a period all the same.
    const swallowed = (period: string) =>
      `Line 2: a quoted cell here runs on over several lines and takes in the period "${period}" as text, so that period would be lost. A quote is probably out of place. Close or remove it, then import again.`;
    for (const text of [
      'notes,period,revenue,cogs,opex\n"draw pending,Feb 2026,100,1,1\npipe 6",Mar 2026,200,2,2\nok,Apr 2026,300,3,3\n',
      'revenue,cogs,opex,notes,period\n100,1,1,"draw pending,Feb 2026\n200,2,2,pipe 6",Mar 2026\n300,3,3,ok,Apr 2026\n',
      'revenue,notes,cogs,period\n100,"draw,1,Feb 2026\n200,6",2,Mar 2026\n',
    ]) {
      expect(parseSnapshotsCsv(text)).toEqual({ rows: [], errors: [swallowed("Feb 2026")] });
    }
    // A quoted comma earlier on the line, a line short of its trailing cells, and a stray quote in
    // the header row, which would turn the line under it into part of a column name.
    expect(parseSnapshotsCsv('notes,period,revenue,memo\n"Smith, J",Feb 2026,100,"x\nok,Mar 2026,200,y"\n')).toEqual({ rows: [], errors: [swallowed("Mar 2026")] });
    expect(parseSnapshotsCsv('period,revenue,cogs,opex,cash,notes\nFeb 2026,100,1,1,5,"draw\nMar 2026,200,2,2,6"\n')).toEqual({ rows: [], errors: [swallowed("Mar 2026")] });
    expect(parseSnapshotsCsv('period,revenue,"notes\n2026-01,100,x"\n2026-02,200,y\n')).toEqual({
      rows: [],
      errors: [swallowed("2026-01").replace("Line 2", "Line 1")],
    });
    // A note that only mentions a month is a note, in any column, and so is a header over two lines.
    const dated = parseSnapshotsCsv('period,revenue,notes\n2026-01,100,"Paid.\nMar 2026, on time"\n2026-02,200,"Invoiced\nApr 2026"\n');
    expect(dated.errors).toEqual([]);
    expect(dated.rows.map((r) => r.notes)).toEqual(["Paid.\nMar 2026, on time", "Invoiced\nApr 2026"]);
    const notesFirst = parseSnapshotsCsv('notes,period,revenue\n"Draw pending.\nPaid in full",2026-01,100\nok,2026-02,200\n');
    expect(notesFirst.errors).toEqual([]);
    expect(notesFirst.rows.map((r) => r.revenue)).toEqual([100, 200]);
    expect(parseSnapshotsCsv('period,"Revenue\n(Actual)"\n2026-01,100\n')).toMatchObject({ errors: [], rows: [{ revenue: 100 }] });
    expect(parseSnapshotsCsv('period,revenue,notes\n2026-01,100,"Paid" in full\n').errors).toEqual([
      'Line 2: a quoted cell has more text after its closing quote. Remove the stray quote, or double a quote meant to be inside the cell (""), then import again.',
    ]);
    // A stray comma in an unquoted figure pushes the rest of the line along a column.
    expect(parseSnapshotsCsv("period,revenue,cogs,opex\n2026-01,1,000,500,200\n").errors).toEqual([
      "Line 2: this line has more cells than the header row has columns, so some of it would be left out. Check it for a stray comma or quote, then import again.",
    ]);
    // A note that really does run over two lines still imports, and later lines keep their numbers.
    const twoLines = parseSnapshotsCsv('period,revenue,notes\n2026-01,100,"Draw pending.\nPaid in full, on time"\n2026-02,x,ok\n');
    expect(twoLines.rows.map((r) => r.notes)).toEqual(["Draw pending.\nPaid in full, on time"]);
    expect(twoLines.errors).toEqual(['Line 4: revenue "x" is not a number.']);
    // A quote inside a note is just a character.
    const inch = parseSnapshotsCsv('period,revenue,notes\n2026-01,100,6" pipe\n2026-02,200,ok\n');
    expect(inch.errors).toEqual([]);
    expect(inch.rows.map((r) => r.notes)).toEqual(['6" pipe', "ok"]);
  });

  it("reads the period type people write and refuses one it cannot, or one the period contradicts", () => {
    const result = parseSnapshotsCsv(
      "period_type,period,revenue\n" +
        "Qtr,2026-07,1\n" +
        "Y,2025-09,2\n" +
        "annual,Dec 2024,3\n" +
        "mo,2026-03,4\n" +
        "Weekly,2026-04,5\n" +
        "month,Q3 2026,6\n" +
        "month,2023,7\n" +
        "year,Q1 2022,8\n",
    );
    expect(result.rows.map((r) => `${r.period_type}:${r.period_start}`)).toEqual(["year:2024-01-01", "year:2025-01-01", "month:2026-03-01", "quarter:2026-07-01"]);
    expect(result.errors).toEqual([
      'Line 6: the period type "Weekly" is not month, quarter or year.',
      'Line 7: "Q3 2026" is a quarter, but the period type says month.',
      'Line 8: "2023" is a year, but the period type says month.',
      'Line 9: "Q1 2022" is a quarter, but the period type says year.',
    ]);
  });

  it("says plainly when a file has only its header row", () => {
    expect(parseSnapshotsCsv("period,revenue,cogs,opex\n").errors).toEqual(["The file has a header row but no periods under it."]);
  });

  it("says when a file is separated by semicolons or tabs rather than reporting every period as unreadable", () => {
    expect(parseSnapshotsCsv("period;revenue;cogs;opex\n2026-01;1000;500;200\n")).toEqual({
      rows: [],
      errors: ["This file is separated by semicolons, not commas. Save it as CSV (comma delimited) and import it again."],
    });
    expect(parseSnapshotsCsv("period\trevenue\tcogs\topex\n2026-01\t1000\t500\t200\n")).toEqual({
      rows: [],
      errors: ["These rows are separated by tabs, which is how a spreadsheet copies cells. Save the sheet as CSV (comma delimited) and import that file."],
    });
  });
});
