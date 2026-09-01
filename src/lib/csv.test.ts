import { describe, expect, it } from "vitest";
import { csvToObjects, normalizeHeader, parseCsv, parseMoney } from "./csv.ts";

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
});

describe("csvToObjects", () => {
  it("maps headers loosely", () => {
    expect(normalizeHeader("Net Profit ($)")).toBe("net_profit");
    expect(normalizeHeader("  Period Start ")).toBe("period_start");
    const records = csvToObjects("Period Start,Revenue,Net Profit ($)\n2026-01-01,\"$1,000\",200");
    expect(records).toEqual([{ period_start: "2026-01-01", revenue: "$1,000", net_profit: "200" }]);
  });
});

describe("parseMoney", () => {
  it("reads accounting formats", () => {
    expect(parseMoney("$1,240,000.50")).toBe(1240000.5);
    expect(parseMoney("(500)")).toBe(-500);
    expect(parseMoney("-$20")).toBe(-20);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});
