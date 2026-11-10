// Everything the connections function needs to read a company's own Google Sheets, read-only: the
// consent URL and the account its id token names, a tab's range and rows as a raw table, a token
// kept fresh through the token store, and the adapter the runner reads through. fetch is injected,
// so all of it is unit-tested without the network; only spreadsheets.get and values:batchGet are
// ever called, and no token or response body ever reaches an error message.
import type { CellValue, ConnectionRef, ProviderAdapter, RawRow, RawTable, SheetsSourceConfig, TokenStore } from "./types.ts";

export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/spreadsheets.readonly";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const REFRESH_MARGIN_MS = 5 * 60000;
const SPREADSHEET_ID = /^[A-Za-z0-9_-]+$/;

const TAB_NOT_FOUND = "That tab was not found in the spreadsheet. It may have been deleted.";

// access_type=offline and prompt=consent make Google return a refresh token on every connect.
export function googleAuthorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: args.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

// The verified email in an id token received straight from Google's token endpoint over TLS, so
// its payload is read, not verified, as Google documents is safe for tokens received directly.
export function emailFromIdToken(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown; email_verified?: unknown };
    if (typeof payload.email !== "string" || !payload.email || payload.email_verified === false) return null;
    return payload.email;
  } catch {
    return null;
  }
}

// The tab is always chosen by gid, so any tab named inside a stored range is ignored.
export function sheetRange(title: string, range: string | null): string {
  const quoted = `'${title.replace(/'/g, "''")}'`;
  const trimmed = (range ?? "").trim();
  if (!trimmed) return quoted;
  const cells = trimmed.includes("!") ? trimmed.slice(trimmed.lastIndexOf("!") + 1) : trimmed;
  return `${quoted}!${cells}`;
}

// The sheet row number a range starts at: B5:H gives 5; no range, or columns only (A:F), gives 1.
function startRowOf(range: string | null): number {
  const trimmed = (range ?? "").trim();
  if (!trimmed) return 1;
  const cells = trimmed.includes("!") ? trimmed.slice(trimmed.lastIndexOf("!") + 1) : trimmed;
  const first = cells.split(":")[0];
  const digits = /^\$?[A-Za-z]*\$?(\d+)$/.exec(first);
  return digits ? Number(digits[1]) : 1;
}

// values are the sheet's rows from the range's first row down; Sheets omits trailing empty rows
// and cells, and a short row reads blank when it is mapped. header_row is the sheet's own row
// number, as the person sees it in Google Sheets.
export function valuesToRawTable(values: CellValue[][], config: SheetsSourceConfig, sheetTitle: string): RawTable {
  const startRow = startRowOf(config.range);
  const index = config.header_row - startRow;
  if (index < 0) throw new Error("The header row is above the range. Check the header row and range for this source.");
  if (index >= values.length) throw new Error(`The tab "${sheetTitle}" has no row ${config.header_row} to read headers from.`);
  const rows: RawRow[] = [];
  for (let i = index + 1; i < values.length; i++) {
    rows.push({ cells: values[i], ref: { spreadsheet_id: config.spreadsheet_id, sheet_gid: config.sheet_gid, row: startRow + i } });
  }
  return { headers: values[index], rows };
}

interface SheetTab { gid: number; title: string; index: number }

function tabsOf(meta: unknown): SheetTab[] | null {
  if (!meta || typeof meta !== "object") return null;
  const sheets = (meta as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return null;
  const tabs: SheetTab[] = [];
  sheets.forEach((sheet, position) => {
    const props = sheet && typeof sheet === "object" ? (sheet as { properties?: unknown }).properties : null;
    if (!props || typeof props !== "object") return;
    const { sheetId, title, index } = props as { sheetId?: unknown; title?: unknown; index?: unknown };
    if (typeof sheetId !== "number" || typeof title !== "string") return;
    tabs.push({ gid: sheetId, title, index: typeof index === "number" ? index : position });
  });
  return tabs;
}

export function sheetTitleForGid(meta: unknown, gid: number): string | null {
  return tabsOf(meta)?.find((tab) => tab.gid === gid)?.title ?? null;
}

export interface GoogleDeps { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; now: () => Date }
export interface SheetDescription { title: string; tabs: Array<{ gid: number; title: string }>; headers: string[] }

// A usable access token, refreshed and saved first when it is missing an expiry or within five
// minutes of it.
async function accessToken(deps: GoogleDeps, connectionId: string): Promise<string> {
  const old = await deps.tokens.load(connectionId);
  const now = deps.now().getTime();
  if (old.accessExpiresAt !== null && Date.parse(old.accessExpiresAt) - now > REFRESH_MARGIN_MS) return old.accessToken;
  if (!old.refreshToken) throw new Error("Google did not leave a way to stay signed in. Disconnect Google Sheets in Settings and connect it again.");
  const response = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: deps.clientId, client_secret: deps.clientSecret, refresh_token: old.refreshToken, grant_type: "refresh_token" }),
  });
  const expired = "Google sign-in has expired or was removed. Connect Google Sheets again in Settings.";
  if (!response.ok) throw new Error(expired);
  let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error(expired);
  }
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error(expired);
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  await deps.tokens.save(connectionId, {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : old.refreshToken,
    accessExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: old.refreshExpiresAt,
  });
  return body.access_token;
}

async function sheetsGet(deps: GoogleDeps, token: string, url: string): Promise<unknown> {
  const response = await deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (response.status === 401 || response.status === 403) throw new Error("Google refused access to that spreadsheet. Check that the connected Google account can open it.");
  if (response.status === 404) throw new Error("That spreadsheet was not found. Check the link.");
  if (response.status === 429) throw new Error("Google asked us to slow down. Try again in a few minutes.");
  const unavailable = "Google Sheets did not answer. Try again later.";
  if (!response.ok) throw new Error(unavailable);
  try {
    return await response.json();
  } catch {
    throw new Error(unavailable);
  }
}

function checkSpreadsheetId(spreadsheetId: string): void {
  if (!SPREADSHEET_ID.test(spreadsheetId)) throw new Error("That spreadsheet id is not valid. Paste the Google Sheets link again.");
}

function metadata(deps: GoogleDeps, token: string, spreadsheetId: string): Promise<unknown> {
  const fields = encodeURIComponent("properties.title,sheets.properties(sheetId,title,index)");
  return sheetsGet(deps, token, `${SHEETS_API}/${spreadsheetId}?fields=${fields}`);
}

// Unformatted values, so numbers stay numbers and dates stay serials for the parser.
async function values(deps: GoogleDeps, token: string, spreadsheetId: string, range: string): Promise<CellValue[][]> {
  const q = new URLSearchParams({ ranges: range, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" });
  const body = (await sheetsGet(deps, token, `${SHEETS_API}/${spreadsheetId}/values:batchGet?${q.toString()}`)) as { valueRanges?: Array<{ values?: CellValue[][] }> } | null;
  return body?.valueRanges?.[0]?.values ?? [];
}

function isSheetsConfig(config: unknown): config is SheetsSourceConfig {
  if (!config || typeof config !== "object") return false;
  const { spreadsheet_id, sheet_gid } = config as { spreadsheet_id?: unknown; sheet_gid?: unknown };
  return typeof spreadsheet_id === "string" && Number.isInteger(sheet_gid);
}

export async function describeSheet(deps: GoogleDeps, connection: ConnectionRef, spreadsheetId: string, gid: number | null): Promise<SheetDescription> {
  checkSpreadsheetId(spreadsheetId);
  const token = await accessToken(deps, connection.id);
  const meta = await metadata(deps, token, spreadsheetId);
  const tabs = [...(tabsOf(meta) ?? [])].sort((a, b) => a.index - b.index);
  const tab = gid === null ? tabs[0] : tabs.find((t) => t.gid === gid);
  if (!tab) throw new Error(TAB_NOT_FOUND);
  const rows = await values(deps, token, spreadsheetId, sheetRange(tab.title, "1:1"));
  const headers = (rows[0] ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()));
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
  const props = meta && typeof meta === "object" ? (meta as { properties?: { title?: unknown } }).properties : undefined;
  return {
    title: typeof props?.title === "string" ? props.title : "",
    tabs: tabs.map(({ gid: tabGid, title }) => ({ gid: tabGid, title })),
    headers,
  };
}

// The tab is found by its numeric gid on every run, so a renamed tab keeps working.
export function createGoogleSheetsAdapter(deps: GoogleDeps): ProviderAdapter {
  return {
    provider: "google_sheets",
    async read(source, connection) {
      const config = source.config;
      if (!isSheetsConfig(config)) throw new Error("This source is not set up for Google Sheets.");
      checkSpreadsheetId(config.spreadsheet_id);
      const token = await accessToken(deps, connection.id);
      const meta = await metadata(deps, token, config.spreadsheet_id);
      const title = sheetTitleForGid(meta, config.sheet_gid);
      if (title === null) throw new Error(TAB_NOT_FOUND);
      const rows = await values(deps, token, config.spreadsheet_id, sheetRange(title, config.range));
      return valuesToRawTable(rows, config, title);
    },
  };
}
