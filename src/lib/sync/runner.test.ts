// Proves the sync runner against a fake store and adapter: the order it writes in, that a failure
// never moves the source off its last good data, that a held lock touches nothing, and that the
// row counts reach the run.
import { describe, expect, it } from "vitest";
import { runSync, type SyncStore } from "../../../supabase/functions/_shared/sync/runner.ts";
import type { AdapterRegistry, ParsedRow, RawTable, SyncSourceSpec } from "../../../supabase/functions/_shared/sync/types.ts";
import type { SyncSource } from "../../types/database.ts";

const now = () => new Date("2026-11-09T14:00:00Z");

// tsc -b proves a database row can be handed to the runner as it is.
function asSpec(s: SyncSource): SyncSourceSpec {
  return s;
}

function makeSource(patch: Partial<SyncSource> = {}): SyncSourceSpec {
  return asSpec({
    id: "source-1",
    company_id: "company-1",
    connection_id: "connection-1",
    provider: "google_sheets",
    name: "Sample sales tab",
    target_module: "sales_reporting",
    config: { spreadsheet_id: "sample-sheet", sheet_gid: 0, range: null, header_row: 1 },
    field_map: [
      { header: "Job", key: "job", label: "Job", type: "text", unit: null, required: true },
      { header: "Contract amount", key: "amount", label: "Contract amount", type: "currency", unit: "USD", required: true },
    ],
    record_key: ["job"],
    sync_weekday: 1,
    sync_time: "07:00:00",
    sync_timezone: "America/Chicago",
    stale_after_hours: 24,
    enabled: true,
    current_run_id: "run-prev",
    last_attempt_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    sync_requested_at: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...patch,
  });
}

const connection = { id: "connection-1", external_account_id: null };

const GOOD: RawTable = {
  headers: ["Job", "Contract amount"],
  rows: [
    { cells: ["Sample job 101", 1000], ref: { row: 2 } },
    { cells: ["Sample job 102", 2000], ref: { row: 3 } },
  ],
};

interface Call {
  name: keyof SyncStore;
  args: unknown[];
}

function fakeStore(options: { locked?: boolean; insertThrows?: boolean; pruneThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const records: ParsedRow[] = [];
  let runs = 0;
  const store: SyncStore = {
    async abandonStaleRuns(...args) {
      calls.push({ name: "abandonStaleRuns", args });
      return 0;
    },
    async startRun(...args) {
      calls.push({ name: "startRun", args });
      if (options.locked) return { locked: true };
      runs += 1;
      return { runId: `run-${runs}` };
    },
    async insertRecords(...args) {
      calls.push({ name: "insertRecords", args });
      if (options.insertThrows) throw new Error("Sample insert failure");
      records.push(...args[2]);
    },
    async markSource(...args) {
      calls.push({ name: "markSource", args });
    },
    async finishRun(...args) {
      calls.push({ name: "finishRun", args });
    },
    async pruneRecords(...args) {
      calls.push({ name: "pruneRecords", args });
      if (options.pruneThrows) throw new Error("Sample prune failure");
    },
  };
  const called = (name: keyof SyncStore) => calls.filter((c) => c.name === name);
  return { store, calls, records, called };
}

function adapterFor(table: RawTable | Error): AdapterRegistry {
  return {
    google_sheets: {
      provider: "google_sheets",
      async read() {
        if (table instanceof Error) throw table;
        return table;
      },
    },
  };
}

describe("runSync", () => {
  it("reads, inserts, points the source at the new run and prunes, in that order", async () => {
    const fake = fakeStore();
    const outcome = await runSync({
      source: makeSource(), connection, trigger: "manual", requestedBy: "profile-1",
      store: fake.store, adapters: adapterFor(GOOD), now,
    });
    expect(fake.calls.map((c) => c.name)).toEqual(["abandonStaleRuns", "startRun", "insertRecords", "markSource", "finishRun", "pruneRecords"]);
    expect(fake.called("markSource")[0].args).toEqual([
      "source-1",
      { current_run_id: "run-1", last_success_at: "2026-11-09T14:00:00.000Z", last_status: "succeeded", last_error: null },
    ]);
    expect(fake.called("pruneRecords")[0].args).toEqual(["source-1", ["run-1", "run-prev"]]);
    expect(fake.called("startRun")[0].args[0]).toMatchObject({ trigger: "manual", requestedBy: "profile-1" });
    expect(outcome).toMatchObject({ status: "succeeded", runId: "run-1", rowsApplied: 2, errors: [], message: null });
    expect(fake.records.map((r) => r.key)).toEqual(['["Sample job 101"]', '["Sample job 102"]']);
  });

  it("keeps the last good data when the table does not validate", async () => {
    const fake = fakeStore();
    const outcome = await runSync({
      source: makeSource(), connection, trigger: "schedule", requestedBy: null,
      store: fake.store, adapters: adapterFor({ headers: ["Job"], rows: GOOD.rows }), now,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toBe('The column "Contract amount" is missing.');
    expect(fake.called("insertRecords")).toHaveLength(0);
    expect(fake.called("pruneRecords")).toHaveLength(0);
    const marks = fake.called("markSource");
    expect(marks).toHaveLength(1);
    expect(Object.keys(marks[0].args[1] as object).sort()).toEqual(["last_error", "last_status"]);
    expect(marks[0].args[1]).toEqual({ last_status: "failed", last_error: 'The column "Contract amount" is missing.' });
    const finish = fake.called("finishRun")[0].args;
    expect(finish[0]).toBe("run-1");
    expect(finish[1]).toMatchObject({ status: "failed", rowsApplied: 0, errorDetail: outcome.errors });
    expect(outcome.errors[0].code).toBe("missing_header");
  });

  it("touches nothing while another sync holds the connection", async () => {
    const fake = fakeStore({ locked: true });
    const outcome = await runSync({
      source: makeSource(), connection, trigger: "manual", requestedBy: null,
      store: fake.store, adapters: adapterFor(GOOD), now,
    });
    expect(outcome).toEqual({
      status: "locked", runId: null, rowsRead: 0, rowsApplied: 0, rowsBlank: 0, errors: [],
      message: "A sync is already running for this connection.",
    });
    expect(fake.calls.map((c) => c.name)).toEqual(["abandonStaleRuns", "startRun"]);
  });

  it("abandons runs older than fifteen minutes first", async () => {
    const fake = fakeStore();
    await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: adapterFor(GOOD), now });
    const [connectionId, olderThan] = fake.called("abandonStaleRuns")[0].args as [string, Date];
    expect(connectionId).toBe("connection-1");
    expect(olderThan.toISOString()).toBe("2026-11-09T13:45:00.000Z");
  });

  it("counts blank rows and carries the counts to the run", async () => {
    const fake = fakeStore();
    const table: RawTable = {
      headers: GOOD.headers,
      rows: [...GOOD.rows, { cells: ["", null], ref: { row: 4 } }],
    };
    const outcome = await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: adapterFor(table), now });
    expect(outcome).toMatchObject({ rowsRead: 3, rowsBlank: 1, rowsApplied: 2 });
    expect(fake.called("finishRun")[0].args[1]).toMatchObject({
      status: "succeeded", rowsRead: 3, rowsBlank: 1, rowsApplied: 2, errorDetail: null,
      finishedAt: now(),
    });
  });

  it("fails on a repeated record key and inserts nothing", async () => {
    const fake = fakeStore();
    const table: RawTable = {
      headers: GOOD.headers,
      rows: [GOOD.rows[0], { cells: ["Sample job 101", 3000], ref: { row: 3 } }],
    };
    const outcome = await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: adapterFor(table), now });
    expect(outcome.status).toBe("failed");
    expect(outcome.errors[0].code).toBe("duplicate_key");
    expect(fake.called("insertRecords")).toHaveLength(0);
  });

  it("fails when no adapter reads the provider", async () => {
    const fake = fakeStore();
    const outcome = await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: {}, now });
    expect(outcome).toMatchObject({ status: "failed", runId: "run-1", message: "Provider not supported yet" });
    expect(fake.called("finishRun")[0].args[1]).toMatchObject({ status: "failed", errorDetail: { message: "Provider not supported yet" } });
  });

  it("fails with the adapter's own message and leaves the pointer alone", async () => {
    const fake = fakeStore();
    const outcome = await runSync({
      source: makeSource(), connection, trigger: "manual", requestedBy: null,
      store: fake.store, adapters: adapterFor(new Error("Sample provider refused")), now,
    });
    expect(outcome).toMatchObject({ status: "failed", message: "Sample provider refused" });
    for (const call of fake.called("markSource")) {
      expect(call.args[1]).not.toHaveProperty("current_run_id");
      expect(call.args[1]).not.toHaveProperty("last_success_at");
    }
  });

  it("keeps only the new run on a first success", async () => {
    const fake = fakeStore();
    await runSync({
      source: makeSource({ current_run_id: null }), connection, trigger: "manual", requestedBy: null,
      store: fake.store, adapters: adapterFor(GOOD), now,
    });
    expect(fake.called("pruneRecords")[0].args).toEqual(["source-1", ["run-1"]]);
  });

  it("takes the failure path when the records cannot be written", async () => {
    const fake = fakeStore({ insertThrows: true });
    const outcome = await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: adapterFor(GOOD), now });
    expect(outcome).toMatchObject({ status: "failed", message: "Sample insert failure", rowsApplied: 0 });
    const marks = fake.called("markSource");
    expect(marks).toHaveLength(1);
    expect(marks[0].args[1]).toEqual({ last_status: "failed", last_error: "Sample insert failure" });
    expect(fake.called("finishRun")[0].args[1]).toMatchObject({ status: "failed", rowsApplied: 0 });
  });

  it("takes the failure path when the column map throws, so the run never stays running", async () => {
    const fake = fakeStore();
    // field_map is only checked to be an array in the database, so an entry can arrive without a header.
    const broken = [{ key: "job", label: "Job", type: "text", unit: null, required: true }] as unknown as SyncSourceSpec["field_map"];
    const outcome = await runSync({
      source: makeSource({ field_map: broken }), connection, trigger: "schedule", requestedBy: null,
      store: fake.store, adapters: adapterFor(GOOD), now,
    });
    expect(outcome).toMatchObject({ status: "failed", runId: "run-1", rowsRead: 2, rowsApplied: 0, errors: [] });
    expect(typeof outcome.message).toBe("string");
    expect(fake.calls.map((c) => c.name)).toEqual(["abandonStaleRuns", "startRun", "finishRun", "markSource"]);
    expect(fake.called("finishRun")[0].args).toEqual([
      "run-1",
      { status: "failed", rowsRead: 2, rowsApplied: 0, rowsBlank: 0, errorDetail: { message: outcome.message }, finishedAt: now() },
    ]);
    expect(fake.called("markSource")[0].args).toEqual(["source-1", { last_status: "failed", last_error: outcome.message }]);
  });

  it("still succeeds when pruning fails, leaving it for the next success", async () => {
    const fake = fakeStore({ pruneThrows: true });
    const outcome = await runSync({ source: makeSource(), connection, trigger: "manual", requestedBy: null, store: fake.store, adapters: adapterFor(GOOD), now });
    expect(outcome.status).toBe("succeeded");
  });
});
