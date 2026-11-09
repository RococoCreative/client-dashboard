// A small RFC 4180 CSV parser for the financial snapshot upload: quoted fields, escaped
// quotes, CRLF or LF line endings, and a header row mapped to objects. No dependency
// because the input is a spreadsheet export a few dozen rows long.

// A file the parser will not guess at. Thrown rather than read leniently, because a lenient
// read here writes the wrong figures over real periods with nothing said.
export class CsvError extends Error {
  // The line of the text the problem starts on, counting from 1.
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = "CsvError";
    this.line = line;
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Physical lines, so a quote that never closes can be named by the line it opened on.
  let line = 1;
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
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvError("A quote opens here and never closes.", quoteLine);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline produces one empty row; drop fully empty rows anywhere.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
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
}

export function readCsv(text: string): CsvTable {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], records: [] };
  const columns = rows[0].map((header) => ({ header: header.trim(), key: normalizeHeader(header) }));
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    const seen = new Set<string>();
    columns.forEach(({ key }, index) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { columns, records };
}

export function csvToObjects(text: string): Record<string, string>[] {
  return readCsv(text).records;
}

// The separator a header line uses when it is not a comma: Excel in many locales saves its
// "CSV" with semicolons, and cells copied out of a spreadsheet arrive separated by tabs. Read
// as commas, either one is a single column and every line reports an empty period.
export function otherDelimiter(text: string): ";" | "\t" | null {
  const header = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).find((l) => l.trim() !== "") ?? "";
  if (header.includes(",")) return null;
  const tabs = header.split("\t").length - 1;
  const semicolons = header.split(";").length - 1;
  if (tabs === 0 && semicolons === 0) return null;
  return tabs >= semicolons ? "\t" : ";";
}
