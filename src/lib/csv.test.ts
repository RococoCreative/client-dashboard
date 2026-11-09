// The CSV reader under the financial import: what it reads, and the files it refuses rather
// than guess at.
import { describe, expect, it } from "vitest";
import { CsvError, csvToObjects, normalizeHeader, otherDelimiter, parseCsv, readCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n"1,000","say ""hi""",x\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1,000", 'say "hi"', "x"],
    ]);
  });

  it("drops blank lines and a BOM", () => {
    const rows = parseCsv("﻿period,revenue\n\n2026-01,100\n\n");
    expect(rows).toEqual([
      ["period", "revenue"],
      ["2026-01", "100"],
    ]);
  });

  it("refuses a quote that never closes, naming the line it opened on", () => {
    // Read leniently, the rest of the file would vanish into one notes cell.
    const text = 'period,revenue,notes\n2026-01,100,ok\n2026-02,200,"draw pending\n2026-03,300,x\n';
    expect(() => parseCsv(text)).toThrow(CsvError);
    try {
      parseCsv(text);
    } catch (err) {
      expect((err as CsvError).line).toBe(3);
    }
  });

  it("reads a quote inside an unquoted cell as part of the text", () => {
    expect(parseCsv('a,6" pipe,b\n1,2,3')).toEqual([
      ["a", '6" pipe', "b"],
      ["1", "2", "3"],
    ]);
  });

  it("still opens a quoted cell after a space", () => {
    expect(parseCsv('a, "1,000",b')).toEqual([["a", " 1,000", "b"]]);
  });
});

describe("csvToObjects", () => {
  it("maps headers loosely", () => {
    expect(normalizeHeader("Net Profit ($)")).toBe("net_profit");
    expect(normalizeHeader("  Period Start ")).toBe("period_start");
    const records = csvToObjects("Period Start,Revenue,Net Profit ($)\n2026-01-01,\"$1,000\",200");
    expect(records).toEqual([{ period_start: "2026-01-01", revenue: "$1,000", net_profit: "200" }]);
  });

  it("keeps the first of two columns that read as the same key and says which they were", () => {
    const table = readCsv("Period,Revenue (Actual),Revenue (Budget)\n2026-01,100,250");
    expect(table.records).toEqual([{ period: "2026-01", revenue: "100" }]);
    expect(table.columns.filter((c) => c.key === "revenue").map((c) => c.header)).toEqual(["Revenue (Actual)", "Revenue (Budget)"]);
  });

  it("does not trip over a header that names an object property", () => {
    expect(csvToObjects("constructor,toString\n1,2")).toEqual([{ constructor: "1", tostring: "2" }]);
  });
});

describe("otherDelimiter", () => {
  it("spots a header line separated by semicolons or tabs", () => {
    expect(otherDelimiter("period;revenue;cogs\n2026-01;1000;500")).toBe(";");
    expect(otherDelimiter("period\trevenue\tcogs\n2026-01\t1000\t500")).toBe("\t");
    expect(otherDelimiter("\n\nperiod,revenue\n2026-01,1;2")).toBeNull();
    expect(otherDelimiter("period")).toBeNull();
  });
});
