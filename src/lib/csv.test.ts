// The CSV reader under the financial import: what it reads, and the files it refuses rather
// than guess at.
import { describe, expect, it } from "vitest";
import { CsvError, csvToObjects, lineCells, normalizeHeader, otherDelimiter, parseCsv, parseCsvRows, physicalLines, readCsv } from "./csv.ts";

function thrown(read: () => unknown): CsvError {
  try {
    read();
  } catch (err) {
    if (err instanceof CsvError) return err;
    throw err;
  }
  throw new Error("expected a CsvError");
}

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

  it("refuses a stray quote that a later quoted cell would otherwise close", () => {
    // Read leniently, Feb's note takes in Mar and the start of Apr, and both periods vanish.
    const paid = 'period,revenue,cogs,opex,notes\nFeb 2026,100,1,1,"draw pending\nMar 2026,210000,100000,50000,ok\nApr 2026,300,3,3,"Paid, on time"\n';
    expect(thrown(() => parseCsv(paid))).toMatchObject({ problem: "text_after_quote", line: 2, endLine: 4 });
    const fine = 'period,revenue,cogs,opex,notes\nFeb 2026,100,1,1,"draw pending\nMar 2026,2,2,2,a\nApr 2026,3,3,3,b\nMay 2026,4,4,4,c\nJun 2026,5,5,5,"fine"\n';
    expect(thrown(() => parseCsv(fine))).toMatchObject({ problem: "text_after_quote", line: 2, endLine: 6 });
    expect(thrown(() => parseCsv('a,"abc"def,b\n'))).toMatchObject({ problem: "text_after_quote", line: 1, endLine: 1 });
  });

  it("allows spaces between a closing quote and the comma or line end", () => {
    expect(parseCsv('"a" ,"b"\t\r\n"c",d')).toEqual([
      ["a ", "b\t"],
      ["c", "d"],
    ]);
  });

  it("names the line each row starts on, past blank lines and quoted line breaks", () => {
    const rows = parseCsvRows('period,notes\r\n\r\n2026-01,"two\r\nlines"\r\n2026-02,ok\n');
    expect(rows.map((r) => r.line)).toEqual([1, 3, 5]);
    expect(rows.map((r) => r.endLine)).toEqual([1, 4, 5]);
    expect(rows[1].cells).toEqual(["2026-01", "two\r\nlines"]);
    expect(parseCsvRows('a\r"b\nc"').map((r) => [r.line, r.endLine])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });
});

describe("physical lines", () => {
  it("numbers lines as the reader does", () => {
    expect(physicalLines('\uFEFFa\r\nb\rc\n"d')).toEqual(["a", "b", "c", '"d']);
  });

  it("splits one line as if it stood alone, reading a quote that does not close on it as a character", () => {
    expect(lineCells('"Smith, J",Feb 2026,"say ""hi""", "1,000"')).toEqual(["Smith, J", "Feb 2026", 'say "hi"', " 1,000"]);
    expect(lineCells('"draw pending,Feb 2026,100')).toEqual(['"draw pending', "Feb 2026", "100"]);
    expect(lineCells('pipe 6",Mar 2026,200')).toEqual(['pipe 6"', "Mar 2026", "200"]);
    expect(lineCells("")).toEqual([""]);
  });

  it("closes a quoted cell only where the reader would: before a comma or the line end, past spaces", () => {
    // A ditto mark opens nothing here. The quote that ends "Smith, J" later on is not its close,
    // because text follows that quote, so the line keeps all four of its cells.
    expect(lineCells('",Mar 2026,300,"Smith, J"')).toEqual(['"', "Mar 2026", "300", "Smith, J"]);
    expect(lineCells('"abc"def,x')).toEqual(['"abc"def', "x"]);
    expect(lineCells('"a" ,"b"\t')).toEqual(["a ", "b\t"]);
    expect(lineCells('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
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
    expect(table.header).toEqual({ line: 1, endLine: 1, cells: ["Period", "Revenue (Actual)", "Revenue (Budget)"] });
    expect(readCsv("\n\n").header).toBeNull();
  });

  it("refuses a line with more filled cells than the header has columns, and names its line", () => {
    // An unquoted 1,000 pushes every figure after it one column along.
    const err = thrown(() => readCsv('period,notes\n2026-01,"a\nb"\n2026-02,1,000\n'));
    expect(err).toMatchObject({ problem: "extra_cells", line: 4 });
    // Empty cells past the header are only trailing commas.
    expect(readCsv("period,revenue\n2026-01,100,,\n").records).toEqual([{ period: "2026-01", revenue: "100" }]);
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
