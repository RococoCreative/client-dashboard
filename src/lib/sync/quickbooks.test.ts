// Proves the QuickBooks Online reader against a fake fetch and a fake token store: a field path
// reads one leaf and nothing else, every entity is cut down to the field map before it leaves the
// adapter, the client can only GET a query, a rotated refresh token is saved before any data call,
// every refusal reads as a plain line with no token in it, and paging stops at a hard ceiling.
import { describe, expect, it, vi } from "vitest";
import {
  QBO_MAX_PAGES,
  QBO_PAGE_SIZE,
  createQboClient,
  createQuickBooksAdapter,
  getPath,
  projectEntities,
  type QuickBooksDeps,
} from "../../../supabase/functions/_shared/sync/quickbooks.ts";
import { mapRows } from "../../../supabase/functions/_shared/sync/parse.ts";
import { runSync, type SyncStore } from "../../../supabase/functions/_shared/sync/runner.ts";
import type { FieldMapEntry, ParsedRow, ProviderTokens, SyncSourceSpec } from "../../../supabase/functions/_shared/sync/types.ts";

const now = () => new Date("2026-11-09T14:00:00Z");
const inMinutes = (minutes: number) => new Date(now().getTime() + minutes * 60000).toISOString();
const connection = { id: "sample-conn", external_account_id: "sample-realm" };

const entry = (header: string, key: string, type: FieldMapEntry["type"], required = false): FieldMapEntry => ({
  header,
  key,
  label: header,
  type,
  unit: type === "currency" ? "USD" : null,
  required,
});
const FM: FieldMapEntry[] = [
  entry("DocNumber", "doc_number", "text", true),
  entry("CustomerRef.name", "customer", "text"),
  entry("TxnDate", "txn_date", "date"),
  entry("DueDate", "due_date", "date"),
  entry("TotalAmt", "total", "currency"),
  entry("Balance", "balance", "currency"),
];

const INVOICE = { Id: "101", DocNumber: "1001", CustomerRef: { value: "5", name: "Sample customer" }, TxnDate: "2026-08-14", TotalAmt: 1250.5, Balance: 0, PrivateNote: "Sample note" };
const INVOICES: Record<string, unknown>[] = [
  INVOICE,
  { Id: 102, DocNumber: "1002", CustomerRef: { value: "6", name: "Sample customer two" }, TxnDate: "2026-08-20", DueDate: "2026-09-19", TotalAmt: 400, Balance: 400 },
];

const many = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => ({ Id: String(from + i), DocNumber: String(10000 + from + i), TotalAmt: 1, Balance: 0 }));
const page = (entity: string, rows: unknown[]) => ({ status: 200, body: { QueryResponse: { [entity]: rows, startPosition: 1, maxResults: rows.length } } });

type Call =
  | { kind: "fetch"; url: string; method: string; headers: Record<string, string>; body: string | null }
  | { kind: "save"; connectionId: string; tokens: ProviderTokens };
type FetchCall = Extract<Call, { kind: "fetch" }>;

function fakeFetch(log: Call[], answers: Array<{ status: number; body: unknown }>) {
  const queue = [...answers];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
}

function harness(tokens: ProviderTokens, answers: Array<{ status: number; body: unknown }>, options: { saveThrows?: boolean } = {}) {
  const log: Call[] = [];
  const fetch = fakeFetch(log, answers);
  const deps: QuickBooksDeps = {
    clientId: "sample-client",
    clientSecret: "sample-secret",
    tokens: {
      load: async () => ({ ...tokens }),
      save: async (connectionId, saved) => {
        log.push({ kind: "save", connectionId, tokens: saved });
        if (options.saveThrows) throw new Error("Sample save failure");
      },
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    environment: "sandbox",
    now,
  };
  const fetches = () => log.filter((c): c is FetchCall => c.kind === "fetch");
  const saves = () => log.filter((c): c is Extract<Call, { kind: "save" }> => c.kind === "save");
  return { deps, log, fetch, fetches, saves };
}

const fresh: ProviderTokens = { accessToken: "sample-access", refreshToken: "sample-refresh", accessExpiresAt: inMinutes(60), refreshExpiresAt: inMinutes(60 * 24 * 90) };
const expiring: ProviderTokens = { ...fresh, accessExpiresAt: inMinutes(2) };
const REFRESHED = { access_token: "sample-access-2", refresh_token: "sample-refresh-2", expires_in: 3600, x_refresh_token_expires_in: 8726400 };

function source(config: unknown = { entity: "Invoice" }): SyncSourceSpec {
  return {
    id: "sample-source",
    company_id: "sample-company",
    connection_id: "sample-conn",
    provider: "quickbooks",
    config: config as SyncSourceSpec["config"],
    field_map: FM,
    record_key: ["doc_number"],
    enabled: true,
    sync_weekday: null,
    sync_time: null,
    sync_timezone: null,
    current_run_id: null,
    last_attempt_at: null,
    last_success_at: null,
  };
}

const queryOf = (call: FetchCall) => new URL(call.url).searchParams.get("query");

// The three scenarios the read-only check walks: a fresh read, a refresh first, and a Payment read.
async function freshRead() {
  const h = harness(fresh, [page("Invoice", many(QBO_PAGE_SIZE)), page("Invoice", many(3, 1001))]);
  const table = await createQuickBooksAdapter(h.deps).read(source(), connection);
  return { ...h, table };
}
async function refreshedRead() {
  const h = harness(expiring, [{ status: 200, body: REFRESHED }, page("Invoice", INVOICES)]);
  const table = await createQuickBooksAdapter(h.deps).read(source(), connection);
  return { ...h, table };
}
async function paymentRead() {
  const h = harness(fresh, [page("Payment", [{ Id: "7", TotalAmt: 50 }])]);
  const table = await createQuickBooksAdapter(h.deps).read(source({ entity: "Payment" }), connection);
  return { ...h, table };
}

describe("getPath", () => {
  it("reads one leaf by a dotted path, and nothing that is not a leaf", () => {
    expect(getPath(INVOICE, "CustomerRef.name")).toBe("Sample customer");
    expect(getPath(INVOICE, "TotalAmt")).toBe(1250.5);
    expect(getPath(INVOICE, "Balance")).toBe(0);
    expect(getPath({ Line: [{ Amount: 5 }] }, "Line.0.Amount")).toBe(5);
    expect(getPath({ Paid: true }, "Paid")).toBe(true);
    expect(getPath(INVOICE, "DueDate")).toBeNull();
    expect(getPath(INVOICE, "CustomerRef")).toBeNull();
    expect(getPath({ Line: [{ Amount: 5 }] }, "Line")).toBeNull();
    expect(getPath(null, "Id")).toBeNull();
    expect(getPath({ Id: "1" }, "")).toBeNull();
  });
});

describe("projectEntities", () => {
  it("keeps only the field map's columns, with a ref back to the entity", () => {
    const table = projectEntities(INVOICES, FM, "sample-realm", "Invoice", true);
    expect(table.headers).toEqual(["DocNumber", "CustomerRef.name", "TxnDate", "DueDate", "TotalAmt", "Balance"]);
    expect(table.rows[0].cells).toEqual(["1001", "Sample customer", "2026-08-14", null, 1250.5, 0]);
    for (const row of table.rows) expect(row.cells).toHaveLength(6);
    expect(table.rows[0].ref).toEqual({ entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true });
    expect(table.rows[1].ref).toEqual({ entity: "Invoice", Id: "102", realmId: "sample-realm", sandbox: true });
    expect(JSON.stringify(table)).not.toContain("Sample note");
  });

  it("parses through the shared column map with blanks left blank", () => {
    const result = mapRows(projectEntities(INVOICES, FM, "sample-realm", "Invoice", true), FM, ["doc_number"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.rows[0].data;
    expect(Object.keys(first).sort()).toEqual(["balance", "customer", "doc_number", "due_date", "total", "txn_date"]);
    expect(first.balance).toBe(0);
    expect(first.due_date).toBeNull();
    expect(first.txn_date).toBe("2026-08-14");
  });
});

describe("createQboClient", () => {
  const SQL = "select * from Invoice orderby Id";
  function client(answers: Array<{ status: number; body: unknown }>, environment: "sandbox" | "production" = "sandbox") {
    const log: Call[] = [];
    const fetch = fakeFetch(log, answers);
    const qbo = createQboClient({ environment, realmId: "sample-realm", accessToken: "sample-access", fetch: fetch as unknown as typeof globalThis.fetch });
    return { qbo, log: log as FetchCall[] };
  }

  it("has one method, a GET query", async () => {
    const { qbo, log } = client([page("Invoice", INVOICES)]);
    expect(Object.keys(qbo)).toEqual(["query"]);
    expect(await qbo.query(SQL, 1, 1000)).toEqual(INVOICES);
    expect(log).toHaveLength(1);
    const url = new URL(log[0].url);
    expect(log[0].method).toBe("GET");
    expect(url.origin).toBe("https://sandbox-quickbooks.api.intuit.com");
    expect(url.pathname).toBe("/v3/company/sample-realm/query");
    expect(url.searchParams.get("query")).toBe("select * from Invoice orderby Id startposition 1 maxresults 1000");
    expect(url.searchParams.get("minorversion")).toBe("75");
    expect(log[0].headers.authorization).toBe("Bearer sample-access");
    expect(log[0].headers.accept).toBe("application/json");
  });

  it("reads an empty answer as no rows and uses the production host in production", async () => {
    const { qbo } = client([{ status: 200, body: { QueryResponse: {} } }]);
    expect(await qbo.query(SQL, 1, 1000)).toEqual([]);
    const prod = client([page("Invoice", [])], "production");
    await prod.qbo.query(SQL, 1, 10);
    expect(new URL(prod.log[0].url).origin).toBe("https://quickbooks.api.intuit.com");
  });

  it("refuses a page out of range without calling QuickBooks", async () => {
    const { qbo, log } = client([]);
    await expect(qbo.query(SQL, 0, 10)).rejects.toThrow("The QuickBooks page is out of range.");
    await expect(qbo.query(SQL, 1, 1001)).rejects.toThrow("The QuickBooks page is out of range.");
    await expect(qbo.query(SQL, 1.5, 10)).rejects.toThrow("The QuickBooks page is out of range.");
    await expect(qbo.query(SQL, 1, 0)).rejects.toThrow("The QuickBooks page is out of range.");
    expect(log).toHaveLength(0);
  });

  it("turns each QuickBooks refusal into a plain line with no token in it", async () => {
    const cases: Array<[{ status: number; body: unknown }, string]> = [
      [{ status: 200, body: { Fault: { Error: [] } } }, "QuickBooks could not run the query."],
      [{ status: 401, body: { fault: "sample-access" } }, "QuickBooks refused the sign-in. Connect QuickBooks again in Settings."],
      [{ status: 403, body: {} }, "QuickBooks refused access to these records."],
      [{ status: 429, body: {} }, "QuickBooks asked us to slow down. Try again in a few minutes."],
      [{ status: 500, body: {} }, "QuickBooks did not answer. Try again later."],
    ];
    for (const [answer, message] of cases) {
      const { qbo } = client([answer]);
      const err = await qbo.query(SQL, 1, 1000).catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(message);
      expect((err as Error).message).not.toContain("sample-access");
    }
  });

  it("reads a body that is not JSON, or has no QueryResponse, as no answer rather than no rows", async () => {
    const fetch = vi.fn(async () => new Response("not json", { status: 200 }));
    const qbo = createQboClient({ environment: "sandbox", realmId: "sample-realm", accessToken: "sample-access", fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(qbo.query(SQL, 1, 1000)).rejects.toThrow("QuickBooks did not answer. Try again later.");
    const { qbo: bare } = client([{ status: 200, body: { time: "2026-11-09T14:00:00Z" } }]);
    await expect(bare.query(SQL, 1, 1000)).rejects.toThrow("QuickBooks did not answer. Try again later.");
  });
});

describe("createQuickBooksAdapter", () => {
  it("reads with a fresh token, page by page to the end, refreshing nothing", async () => {
    const { fetches, saves, table } = await freshRead();
    expect(fetches().map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(queryOf(fetches()[0])).toMatch(/startposition 1 maxresults 1000$/);
    expect(queryOf(fetches()[1])).toMatch(/startposition 1001 maxresults 1000$/);
    expect(saves()).toHaveLength(0);
    expect(table.rows).toHaveLength(1003);
  });

  it("refreshes a token about to expire and saves the new one before reading", async () => {
    const { fetches, log, table } = await refreshedRead();
    const [refresh, read] = fetches();
    expect(refresh.method).toBe("POST");
    expect(refresh.url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(refresh.headers.authorization).toBe(`Basic ${btoa("sample-client:sample-secret")}`);
    expect(refresh.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(refresh.body ?? "");
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("sample-refresh");
    expect(log.map((c) => (c.kind === "save" ? "save" : c.method))).toEqual(["POST", "save", "GET"]);
    const save = log.find((c) => c.kind === "save");
    expect(save).toEqual({
      kind: "save",
      connectionId: "sample-conn",
      tokens: {
        accessToken: "sample-access-2",
        refreshToken: "sample-refresh-2",
        accessExpiresAt: "2026-11-09T15:00:00.000Z",
        refreshExpiresAt: new Date(now().getTime() + 8726400 * 1000).toISOString(),
      },
    });
    expect(read.headers.authorization).toBe("Bearer sample-access-2");
    expect(table.rows).toHaveLength(2);
  });

  it("keeps the old refresh token and its expiry when QuickBooks sends none", async () => {
    const h = harness({ ...expiring, accessExpiresAt: null }, [{ status: 200, body: { access_token: "sample-access-2", expires_in: 3600 } }, page("Invoice", [])]);
    await createQuickBooksAdapter(h.deps).read(source(), connection);
    expect(h.saves()[0].tokens).toEqual({ accessToken: "sample-access-2", refreshToken: "sample-refresh", accessExpiresAt: "2026-11-09T15:00:00.000Z", refreshExpiresAt: fresh.refreshExpiresAt });
  });

  it("reads nothing when the new sign-in cannot be saved", async () => {
    const h = harness(expiring, [{ status: 200, body: REFRESHED }, page("Invoice", INVOICES)], { saveThrows: true });
    await expect(createQuickBooksAdapter(h.deps).read(source(), connection)).rejects.toThrow(
      "The new QuickBooks sign-in could not be saved. Connect QuickBooks again in Settings.",
    );
    expect(h.fetches().filter((c) => c.method === "GET")).toHaveLength(0);
  });

  it("saves nothing and reads nothing when QuickBooks refuses the refresh", async () => {
    const h = harness(expiring, [{ status: 400, body: { error: "invalid_grant" } }]);
    await expect(createQuickBooksAdapter(h.deps).read(source(), connection)).rejects.toThrow("QuickBooks sign-in has expired. Connect QuickBooks again in Settings.");
    expect(h.saves()).toHaveLength(0);
    expect(h.fetches().filter((c) => c.method === "GET")).toHaveLength(0);
  });

  it("asks to reconnect without calling anything when the sign-in cannot be renewed", async () => {
    for (const tokens of [
      { ...expiring, refreshToken: null },
      { ...expiring, refreshExpiresAt: inMinutes(-1) },
    ]) {
      const h = harness(tokens, []);
      await expect(createQuickBooksAdapter(h.deps).read(source(), connection)).rejects.toThrow("QuickBooks sign-in has expired. Connect QuickBooks again in Settings.");
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.saves()).toHaveLength(0);
    }
  });

  it("asks to reconnect when the connection names no company", async () => {
    const h = harness(fresh, []);
    await expect(createQuickBooksAdapter(h.deps).read(source(), { id: "sample-conn", external_account_id: null })).rejects.toThrow(
      "QuickBooks did not say which company is connected. Connect QuickBooks again in Settings.",
    );
    await expect(createQuickBooksAdapter(h.deps).read(source(), { id: "sample-conn", external_account_id: "  " })).rejects.toThrow(
      "QuickBooks did not say which company is connected. Connect QuickBooks again in Settings.",
    );
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("reads payments, and refuses a source that is not a QuickBooks entity", async () => {
    const { fetches, table } = await paymentRead();
    expect(queryOf(fetches()[0])).toBe("select * from Payment orderby Id startposition 1 maxresults 1000");
    expect(table.rows[0].ref).toEqual({ entity: "Payment", Id: "7", realmId: "sample-realm", sandbox: true });

    const h = harness(fresh, []);
    const adapter = createQuickBooksAdapter(h.deps);
    await expect(adapter.read(source({ spreadsheet_id: "sample-sheet", sheet_gid: 0, range: null, header_row: 1 }), connection)).rejects.toThrow(
      "This source is not set up for QuickBooks.",
    );
    await expect(adapter.read(source({ entity: "Bill" }), connection)).rejects.toThrow("This source is not set up for QuickBooks.");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("stops at the most one sync reads", async () => {
    const h = harness(fresh, Array.from({ length: QBO_MAX_PAGES }, () => page("Invoice", many(QBO_PAGE_SIZE))));
    await expect(createQuickBooksAdapter(h.deps).read(source(), connection)).rejects.toThrow("QuickBooks returned more records than one sync reads (50,000).");
    expect(h.fetches()).toHaveLength(QBO_MAX_PAGES);
  });

  it("only ever reads from QuickBooks", async () => {
    const calls = [...(await freshRead()).fetches(), ...(await refreshedRead()).fetches(), ...(await paymentRead()).fetches()];
    for (const call of calls.filter((c) => new URL(c.url).host.endsWith("api.intuit.com"))) {
      expect(call.method).toBe("GET");
      expect(new URL(call.url).pathname).toContain("/query");
    }
    expect(calls.filter((c) => c.method !== "GET").map((c) => new URL(c.url).host)).toEqual(["oauth.platform.intuit.com"]);
  });
});

describe("QuickBooks through the shared runner", () => {
  it("stores only the field map's values, each linked back to its invoice", async () => {
    const inserted: ParsedRow[] = [];
    let runs = 0;
    const store: SyncStore = {
      abandonStaleRuns: async () => 0,
      startRun: async () => ({ runId: `sample-run-${++runs}` }),
      insertRecords: async (_runId, _source, rows) => {
        inserted.push(...rows);
      },
      markSource: async () => {},
      finishRun: async () => {},
      pruneRecords: async () => {},
    };
    const h = harness(fresh, [page("Invoice", INVOICES)]);
    const outcome = await runSync({
      source: { ...source(), id: "sample-invoices" },
      connection,
      trigger: "manual",
      requestedBy: null,
      store,
      adapters: { quickbooks: createQuickBooksAdapter(h.deps) },
      now,
    });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.rowsApplied).toBe(INVOICES.length);
    expect(inserted.map((row) => row.source_ref)).toEqual([
      { entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true },
      { entity: "Invoice", Id: "102", realmId: "sample-realm", sandbox: true },
    ]);
    const keys = FM.map((f) => f.key).sort();
    for (const row of inserted) expect(Object.keys(row.data).sort()).toEqual(keys);
  });
});
