// A small RFC 4180 CSV parser for the financial snapshot upload: quoted fields, escaped
// quotes, CRLF or LF line endings, and a header row mapped to objects. No dependency
// because the input is a spreadsheet export a few dozen rows long.

// A file the parser will not guess at. Thrown rather than read leniently, because a lenient
// read here writes the wrong figures over real periods with nothing said.
export type CsvProblem =
  // A quote opens a cell and nothing ever closes it.
  | "unclosed_quote"
  // A quote closes partway through a cell, so it was not the quote that closes the cell it
  // opened: a stray quote earlier on, usually, that has taken in every line since.
  | "text_after_quote"
  // A line with more filled cells than the header row has columns.
  | "extra_cells";

export class CsvError extends Error {
  readonly problem: CsvProblem;
  // The line of the text the problem starts on, counting from 1.
  readonly line: number;
  // The line it shows itself on, which is later than `line` when a quoted run spans lines.
  readonly endLine: number;

  constructor(message: string, problem: CsvProblem, line: number, endLine = line) {
    super(message);
    this.name = "CsvError";
    this.problem = problem;
    this.line = line;
    this.endLine = endLine;
  }
}

// One parsed line of cells and the physical lines it starts and ends on, counting from 1. A
// quoted cell can hold line breaks, so the two drift apart and a message has to name the
// physical line.
export interface CsvRow {
  line: number;
  endLine: number;
  cells: string[];
}

export function parseCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\r" || (char === "\n" && source[i - 1] !== "\r")) line += 1;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          // A closing quote ends its cell, so only spaces may sit between it and the next comma
          // or line end. Anything else means it closed a different quote than the one that
          // opened this cell, and reading on would put every line between into one cell.
          let next = i + 1;
          while (source[next] === " " || source[next] === "\t") next += 1;
          const after = source[next];
          if (after !== undefined && after !== "," && after !== "\n" && after !== "\r") {
            throw new CsvError("A quoted cell has text after its closing quote.", "text_after_quote", quoteLine, line);
          }
        }
      } else {
        field += char;
      }
      continue;
    }
    // A quote opens a quoted cell only at the start of one. Inside an unquoted cell it is just
    // a character (6" pipe), not the start of a quoted run that swallows the lines after it.
    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      quoteLine = line;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push({ line: rowLine, endLine: line - 1, cells: row });
      row = [];
      field = "";
      rowLine = line;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvError("A quote opens here and never closes.", "unclosed_quote", quoteLine);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push({ line: rowLine, endLine: line, cells: row });
  }
  // A trailing newline produces one empty row; drop fully empty rows anywhere.
  return rows.filter((r) => r.cells.some((cell) => cell.trim() !== ""));
}

export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells);
}

// The text's physical lines, numbered as parseCsvRows numbers them: line n is index n - 1.
export function physicalLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
}

// One physical line split into cells as if it stood alone, which is what it said before a quote
// out of place ran it together with the lines around it. A quoted cell that closes on the line
// reads as one cell, commas and all; a quote that does not close on the line is a character.
export function lineCells(line: string): string[] {
  const cells: string[] = [];
  let field = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const close = char === '"' && field.trim() === "" ? closingQuote(line, i + 1) : -1;
    if (close !== -1) {
      field += line.slice(i + 1, close).replace(/""/g, '"');
      i = close;
    } else if (char === ",") {
      cells.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  cells.push(field);
  return cells;
}

// Where the quoted cell that opens just before `from` closes on this line, or -1. The rule is the
// reader's own: the first quote that is not doubled closes the cell only when nothing but spaces
// or tabs sits between it and the next comma or the line end. A quote with text after it is no
// close, so the opening quote reads as a character, the same line parseCsvRows would refuse.
function closingQuote(line: string, from: number): number {
  for (let i = from; i < line.length; i += 1) {
    if (line[i] !== '"') continue;
    if (line[i + 1] === '"') {
      i += 1;
      continue;
    }
    let next = i + 1;
    while (line[next] === " " || line[next] === "\t") next += 1;
    return next >= line.length || line[next] === "," ? i : -1;
  }
  return -1;
}

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

export interface CsvTable {
  // Every column: its header as written and the key it reads as. Two headers can read as the
  // same key ("Revenue (Actual)" and "Revenue (Budget)"), and the caller decides whether that
  // matters for the keys it reads.
  columns: Array<{ header: string; key: string }>;
  // One record per line under the header. Where two columns share a key the first one's value
  // stands, never a later one written over it.
  records: Record<string, string>[];
  // The header row as read, or null when the file has no rows at all.
  header: CsvRow | null;
  // The lines under the header as read, in the same order as `records`.
  rows: CsvRow[];
}

// Throws a CsvError for a file it cannot read as written: a quote out of place, or a line with
// more filled cells than the header row has columns, whose extra cells would otherwise be
// dropped with nothing said (a stray comma in 1,000, or a quote that closed partway through).
export function readCsv(text: string): CsvTable {
  const parsed = parseCsvRows(text);
  if (parsed.length === 0) return { columns: [], records: [], header: null, rows: [] };
  const columns = parsed[0].cells.map((header) => ({ header: header.trim(), key: normalizeHeader(header) }));
  const rows = parsed.slice(1);
  const overfull = rows.find((r) => r.cells.slice(columns.length).some((cell) => cell.trim() !== ""));
  if (overfull) throw new CsvError("A line has more cells than the header row has columns.", "extra_cells", overfull.line);
  const records = rows.map(({ cells }) => {
    const record: Record<string, string> = {};
    const seen = new Set<string>();
    columns.forEach(({ key }, index) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { columns, records, header: parsed[0], rows };
}

export function csvToObjects(text: string): Record<string, string>[] {
  return readCsv(text).records;
}

// The separator a header line uses when it is not a comma: Excel in many locales saves its
// "CSV" with semicolons, and cells copied out of a spreadsheet arrive separated by tabs. Read
// as commas, either one is a single column and every line reports an empty period.
export function otherDelimiter(text: string): ";" | "\t" | null {
  const header = physicalLines(text).find((l) => l.trim() !== "") ?? "";
  if (header.includes(",")) return null;
  const tabs = header.split("\t").length - 1;
  const semicolons = header.split(";").length - 1;
  if (tabs === 0 && semicolons === 0) return null;
  return tabs >= semicolons ? "\t" : ";";
}
