// Proves the Google Sheets provider against a fake fetch and a fake token store: the sign-in URL
// and the account it names, how a tab and range become a Sheets range and a raw table, that a
// token near expiry is refreshed and saved before any Sheets call, that every Google refusal reads
// as a plain line with no token in it, and that nothing but GET ever reaches Sheets.
import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_SCOPES,
  createGoogleSheetsAdapter,
  describeSheet,
  emailFromIdToken,
  googleAuthorizeUrl,
  sheetRange,
  sheetTitleForGid,
  valuesToRawTable,
  type GoogleDeps,
} from "../../../supabase/functions/_shared/sync/googleSheets.ts";
import type { ProviderTokens, SheetsSourceConfig, SyncSourceSpec } from "../../../supabase/functions/_shared/sync/types.ts";

const now = () => new Date("2026-11-09T14:00:00Z");
const inMinutes = (minutes: number) => new Date(now().getTime() + minutes * 60000).toISOString();

type Call =
  | { kind: "fetch"; url: string; method: string; headers: Record<string, string>; body: string | null }
  | { kind: "save"; connectionId: string; tokens: ProviderTokens };

const META = {
  properties: { title: "Sample reporting workbook" },
  sheets: [
    { properties: { sheetId: 0, title: "Sample sales", index: 0 } },
    { properties: { sheetId: 42, title: "Sample finance", index: 1 } },
  ],
};
const VALUES = [["Job", "Amount"], ["Sample job 101", 250000], [], ["Sample job 102"]];
const valuesAnswer = (values: unknown[][]) => ({ status: 200, body: { valueRanges: [{ range: "x", values }] } });

function harness(tokens: ProviderTokens, answers: Array<{ status: number; body: unknown }>) {
  const log: Call[] = [];
  const queue = [...answers];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    log.push({
      kind: "fetch",
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body === undefined || init.body === null ? null : String(init.body),
    });
    const next = queue.shift();
    if (!next) throw new Error("no answer queued");
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  const deps: GoogleDeps = {
    clientId: "sample-client",
    clientSecret: "sample-secret",
    tokens: {
      load: async () => ({ ...tokens }),
      save: async (connectionId, saved) => {
        log.push({ kind: "save", connectionId, tokens: saved });
      },
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    now,
  };
  const fetches = () => log.filter((c): c is Extract<Call, { kind: "fetch" }> => c.kind === "fetch");
  const saves = () => log.filter((c): c is Extract<Call, { kind: "save" }> => c.kind === "save");
  return { deps, log, fetches, saves };
}

const fresh: ProviderTokens = { accessToken: "sample-access", refreshToken: "sample-refresh", accessExpiresAt: inMinutes(60), refreshExpiresAt: null };
const sheetsConfig: SheetsSourceConfig = { spreadsheet_id: "sample-sheet", sheet_gid: 42, range: null, header_row: 1 };
const connection = { id: "connection-1", external_account_id: "sample-reports@example.com" };

function source(config: unknown = sheetsConfig): SyncSourceSpec {
  return {
    id: "source-1",
    company_id: "company-1",
    connection_id: "connection-1",
    provider: "google_sheets",
    config: config as SyncSourceSpec["config"],
    field_map: [],
    record_key: [],
    enabled: true,
    sync_weekday: null,
    sync_time: null,
    sync_timezone: null,
    current_run_id: null,
    last_attempt_at: null,
    last_success_at: null,
  };
}

const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("Google sign-in", () => {
  it("asks for read-only spreadsheets and the account's email", () => {
    expect(GOOGLE_SCOPES).toBe("openid email https://www.googleapis.com/auth/spreadsheets.readonly");
  });

  it("builds the consent URL with offline access", () => {
    const url = new URL(googleAuthorizeUrl({ clientId: "sample-client", redirectUri: "https://example.supabase.co/functions/v1/connections/callback", state: "sample-state" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      client_id: "sample-client",
      redirect_uri: "https://example.supabase.co/functions/v1/connections/callback",
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: "sample-state",
    });
  });

  it("reads a verified email from the id token", () => {
    expect(emailFromIdToken(`header.${b64url({ email: "sample-reports@example.com", email_verified: true })}.sig`)).toBe("sample-reports@example.com");
    expect(emailFromIdToken(`header.${b64url({ email: "sample-reports@example.com", email_verified: false })}.sig`)).toBeNull();
    expect(emailFromIdToken(`header.${b64url({ sub: "1" })}.sig`)).toBeNull();
    expect(emailFromIdToken("not-a-token")).toBeNull();
    expect(emailFromIdToken("a.%%%.c")).toBeNull();
  });
});

describe("sheetRange", () => {
  it("quotes the tab and keeps only the range's cells", () => {
    expect(sheetRange("Sample sales", null)).toBe("'Sample sales'");
    expect(sheetRange("Sam's tab", null)).toBe("'Sam''s tab'");
    expect(sheetRange("Sample sales", "A1:F")).toBe("'Sample sales'!A1:F");
    expect(sheetRange("Sample sales", "Other!B2:C")).toBe("'Sample sales'!B2:C");
    expect(sheetRange("Sample sales", "  ")).toBe("'Sample sales'");
  });
});

describe("valuesToRawTable", () => {
  it("takes headers from the header row and numbers each row as the sheet does", () => {
    const table = valuesToRawTable(VALUES, sheetsConfig, "Sample sales");
    expect(table.headers).toEqual(["Job", "Amount"]);
    expect(table.rows).toEqual([
      { cells: ["Sample job 101", 250000], ref: { spreadsheet_id: "sample-sheet", sheet_gid: 42, row: 2 } },
      { cells: [], ref: { spreadsheet_id: "sample-sheet", sheet_gid: 42, row: 3 } },
      { cells: ["Sample job 102"], ref: { spreadsheet_id: "sample-sheet", sheet_gid: 42, row: 4 } },
    ]);
  });

  it("reads a header row below a title row", () => {
    const table = valuesToRawTable([["Sample title"], ["Job", "Amount"], ["Sample job 101", 1]], { ...sheetsConfig, header_row: 2 }, "Sample sales");
    expect(table.headers).toEqual(["Job", "Amount"]);
    expect(table.rows[0].ref.row).toBe(3);
  });

  it("counts rows from the start of the range", () => {
    const table = valuesToRawTable([["Job", "Amount"], ["Sample job 101", 1]], { ...sheetsConfig, range: "B5:D", header_row: 5 }, "Sample sales");
    expect(table.headers).toEqual(["Job", "Amount"]);
    expect(table.rows[0].ref.row).toBe(6);
  });

  it("refuses a header row above the range or past the end of the tab", () => {
    expect(() => valuesToRawTable(VALUES, { ...sheetsConfig, range: "A5:D", header_row: 3 }, "Sample sales")).toThrow(
      "The header row is above the range. Check the header row and range for this source.",
    );
    expect(() => valuesToRawTable([], sheetsConfig, "Sample sales")).toThrow('The tab "Sample sales" has no row 1 to read headers from.');
  });
});

describe("sheetTitleForGid", () => {
  it("finds a tab by its gid and reads any other shape as none", () => {
    expect(sheetTitleForGid(META, 42)).toBe("Sample finance");
    expect(sheetTitleForGid(META, 7)).toBeNull();
    expect(sheetTitleForGid(null, 42)).toBeNull();
    expect(sheetTitleForGid({ sheets: "x" }, 42)).toBeNull();
  });
});

describe("Google Sheets adapter", () => {
  it("reads metadata then values with a fresh token, saving nothing", async () => {
    const h = harness(fresh, [{ status: 200, body: META }, valuesAnswer(VALUES)]);
    const table = await createGoogleSheetsAdapter(h.deps).read(source(), connection);
    const calls = h.fetches();
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(calls[0].url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/sample-sheet?fields=")).toBe(true);
    expect(calls[1].url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/sample-sheet/values:batchGet?")).toBe(true);
    const params = new URL(calls[1].url).searchParams;
    expect(params.get("ranges")).toBe("'Sample finance'");
    expect(params.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
    expect(params.get("dateTimeRenderOption")).toBe("SERIAL_NUMBER");
    for (const call of calls) expect(call.headers.authorization).toBe("Bearer sample-access");
    expect(h.saves()).toHaveLength(0);
    expect(table.rows.map((r) => r.ref)).toEqual([2, 3, 4].map((row) => ({ spreadsheet_id: "sample-sheet", sheet_gid: 42, row })));
  });

  it("refreshes a token about to expire and saves it before reading", async () => {
    const h = harness({ ...fresh, accessExpiresAt: inMinutes(2) }, [
      { status: 200, body: { access_token: "sample-access-2", expires_in: 3600 } },
      { status: 200, body: META },
      valuesAnswer(VALUES),
    ]);
    await createGoogleSheetsAdapter(h.deps).read(source(), connection);
    const [refresh, ...sheets] = h.fetches();
    expect(refresh.method).toBe("POST");
    expect(refresh.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(refresh.body ?? "");
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("sample-refresh");
    expect(form.get("client_id")).toBe("sample-client");
    expect(h.saves()).toEqual([
      { kind: "save", connectionId: "connection-1", tokens: { accessToken: "sample-access-2", refreshToken: "sample-refresh", accessExpiresAt: "2026-11-09T15:00:00.000Z", refreshExpiresAt: null } },
    ]);
    const saveAt = h.log.findIndex((c) => c.kind === "save");
    const firstSheets = h.log.findIndex((c) => c.kind === "fetch" && c.url.includes("sheets.googleapis.com"));
    expect(saveAt).toBeLessThan(firstSheets);
    for (const call of sheets) expect(call.headers.authorization).toBe("Bearer sample-access-2");
  });

  it("refreshes first when the token has no expiry on file", async () => {
    const h = harness({ ...fresh, accessExpiresAt: null }, [
      { status: 200, body: { access_token: "sample-access-2", expires_in: 3600 } },
      { status: 200, body: META },
      valuesAnswer(VALUES),
    ]);
    await createGoogleSheetsAdapter(h.deps).read(source(), connection);
    expect(h.fetches()[0].url).toBe("https://oauth2.googleapis.com/token");
  });

  it("asks to reconnect when there is no refresh token", async () => {
    const h = harness({ ...fresh, accessExpiresAt: inMinutes(-5), refreshToken: null }, []);
    await expect(createGoogleSheetsAdapter(h.deps).read(source(), connection)).rejects.toThrow(
      "Google did not leave a way to stay signed in. Disconnect Google Sheets in Settings and connect it again.",
    );
    expect(h.fetches()).toHaveLength(0);
  });

  it("saves nothing when Google refuses the refresh", async () => {
    const h = harness({ ...fresh, accessExpiresAt: inMinutes(-5) }, [{ status: 400, body: { error: "invalid_grant" } }]);
    await expect(createGoogleSheetsAdapter(h.deps).read(source(), connection)).rejects.toThrow(
      "Google sign-in has expired or was removed. Connect Google Sheets again in Settings.",
    );
    expect(h.saves()).toHaveLength(0);
  });

  it("says when the tab is gone", async () => {
    const h = harness(fresh, [{ status: 200, body: META }]);
    await expect(createGoogleSheetsAdapter(h.deps).read(source({ ...sheetsConfig, sheet_gid: 7 }), connection)).rejects.toThrow(
      "That tab was not found in the spreadsheet. It may have been deleted.",
    );
  });

  it("turns each Google refusal into a plain line with no token in it", async () => {
    const cases: Array<[number, string]> = [
      [403, "Google refused access to that spreadsheet. Check that the connected Google account can open it."],
      [404, "That spreadsheet was not found. Check the link."],
      [429, "Google asked us to slow down. Try again in a few minutes."],
      [500, "Google Sheets did not answer. Try again later."],
    ];
    for (const [status, message] of cases) {
      const h = harness(fresh, [{ status, body: { error: { message: "sample-access sample-refresh" } } }]);
      const error = await createGoogleSheetsAdapter(h.deps).read(source(), connection).catch((err: Error) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(message);
      expect((error as Error).message).not.toContain("sample-access");
      expect((error as Error).message).not.toContain("sample-refresh");
    }
  });

  it("refuses a source that is not a Google Sheets tab, or a bad spreadsheet id", async () => {
    const h = harness(fresh, []);
    const adapter = createGoogleSheetsAdapter(h.deps);
    await expect(adapter.read(source({ entity: "Invoice" }), connection)).rejects.toThrow("This source is not set up for Google Sheets.");
    await expect(adapter.read(source({ ...sheetsConfig, spreadsheet_id: "bad/id" }), connection)).rejects.toThrow(
      "That spreadsheet id is not valid. Paste the Google Sheets link again.",
    );
    expect(h.fetches()).toHaveLength(0);
  });

  it("only ever reads from Sheets", async () => {
    const a = harness(fresh, [{ status: 200, body: META }, valuesAnswer(VALUES)]);
    await createGoogleSheetsAdapter(a.deps).read(source(), connection);
    const b = harness({ ...fresh, accessExpiresAt: inMinutes(2) }, [
      { status: 200, body: { access_token: "sample-access-2", expires_in: 3600 } },
      { status: 200, body: META },
      valuesAnswer(VALUES),
    ]);
    await createGoogleSheetsAdapter(b.deps).read(source(), connection);
    const calls = [...a.fetches(), ...b.fetches()];
    for (const call of calls.filter((c) => c.url.includes("sheets.googleapis.com"))) expect(call.method).toBe("GET");
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token"]);
  });
});

describe("describeSheet", () => {
  it("lists the tabs and reads the chosen tab's first row as headers", async () => {
    const h = harness(fresh, [{ status: 200, body: META }, valuesAnswer([[" Job ", "Contract amount", 2026, "", null]])]);
    expect(await describeSheet(h.deps, connection, "sample-sheet", 42)).toEqual({
      title: "Sample reporting workbook",
      tabs: [
        { gid: 0, title: "Sample sales" },
        { gid: 42, title: "Sample finance" },
      ],
      headers: ["Job", "Contract amount", "2026"],
    });
    expect(new URL(h.fetches()[1].url).searchParams.get("ranges")).toBe("'Sample finance'!1:1");
  });

  it("reads the first tab when the link names none", async () => {
    const h = harness(fresh, [{ status: 200, body: META }, valuesAnswer([["Job"]])]);
    await describeSheet(h.deps, connection, "sample-sheet", null);
    expect(new URL(h.fetches()[1].url).searchParams.get("ranges")).toBe("'Sample sales'!1:1");
  });
});
