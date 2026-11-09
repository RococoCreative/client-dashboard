// A small RFC 4180 CSV parser for the financial snapshot upload: quoted fields, escaped
// quotes, CRLF or LF line endings, and a header row mapped to objects. No dependency
// because the input is a spreadsheet export a few dozen rows long.
import { normalizeHeader } from "../../supabase/functions/_shared/sync/parse.ts";
export { normalizeHeader };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
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
    if (char === '"') {
      inQuotes = true;
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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline produces one empty row; drop fully empty rows anywhere.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((key, index) => {
      if (key) record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
}
