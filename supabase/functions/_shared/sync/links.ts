// Links from a synced record back to where it came from, so anyone who doubts a figure can open
// the source and change it there. Shared by the app and the connections Edge Function.

const SHEET_ID = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const GID = /gid=(\d+)/;

export function parseSpreadsheetUrl(url: string): { spreadsheetId: string; gid: number | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== "docs.google.com") return null;
  const id = SHEET_ID.exec(parsed.pathname);
  if (!id) return null;
  const gid = GID.exec(parsed.hash) ?? GID.exec(parsed.search);
  return { spreadsheetId: id[1], gid: gid ? Number(gid[1]) : null };
}

export function sheetsUrl(spreadsheetId: string, gid: number | null, row?: number | null): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (gid !== null) {
    url += `#gid=${gid}`;
    if (row !== undefined && row !== null) url += `&range=A${row}`;
  }
  return url;
}

export function recordLink(ref: Record<string, unknown>): { href: string; label: string; note: string | null } | null {
  if (typeof ref.spreadsheet_id === "string" && typeof ref.sheet_gid === "number") {
    const row = typeof ref.row === "number" ? ref.row : null;
    return { href: sheetsUrl(ref.spreadsheet_id, ref.sheet_gid, row), label: "Open in Google Sheets", note: null };
  }
  return null;
}
