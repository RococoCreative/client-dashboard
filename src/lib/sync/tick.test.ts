// Proves what the hourly tick starts and sweeps: only due sources on connected connections in a
// company that carries the data sources module, and a sweep of cut-off runs on every connection
// the tick reads, whether or not anything on it is due.
import { describe, expect, it } from "vitest";
import { STALE_RUN_MINUTES } from "../../../supabase/functions/_shared/sync/runner.ts";
import { SYNC_MODULE, carriesSyncModule, planTick, sweepStaleRuns } from "../../../supabase/functions/_shared/sync/tick.ts";
import type { SyncSourceSpec } from "../../../supabase/functions/_shared/sync/types.ts";
import { MODULE_KEYS } from "../modules.ts";

// Monday 9 November 2026, 14:00 UTC is 08:00 in Chicago, past a Monday 07:00 slot.
const now = new Date("2026-11-09T14:00:00Z");

function spec(patch: Partial<SyncSourceSpec> = {}): SyncSourceSpec {
  return {
    id: "source-1",
    company_id: "company-on",
    connection_id: "conn-1",
    provider: "google_sheets",
    config: { spreadsheet_id: "sample-sheet", sheet_gid: 0, range: null, header_row: 1 },
    field_map: [],
    record_key: [],
    enabled: true,
    sync_weekday: 1,
    sync_time: "07:00:00",
    sync_timezone: "America/Chicago",
    current_run_id: null,
    last_attempt_at: null,
    last_success_at: null,
    ...patch,
  };
}

const connections = new Map([
  ["conn-1", { id: "conn-1", status: "connected" }],
  ["conn-2", { id: "conn-2", status: "connected" }],
  ["conn-off", { id: "conn-off", status: "connected" }],
  ["conn-broken", { id: "conn-broken", status: "error" }],
]);
const modules = new Map<string, readonly string[]>([
  ["company-on", ["switchboard", "data_sources"]],
  ["company-off", ["switchboard"]],
  ["company-none", []],
]);

describe("carriesSyncModule", () => {
  it("is true only when the company's modules include data sources", () => {
    expect(carriesSyncModule(["data_sources"])).toBe(true);
    expect(carriesSyncModule(["wins", "data_sources"])).toBe(true);
    expect(carriesSyncModule(["wins"])).toBe(false);
    expect(carriesSyncModule([])).toBe(false);
    expect(carriesSyncModule(null)).toBe(false);
    expect(carriesSyncModule(undefined)).toBe(false);
  });

  it("names a module key the app knows", () => {
    expect((MODULE_KEYS as readonly string[]).includes(SYNC_MODULE)).toBe(true);
  });
});

describe("planTick", () => {
  it("starts due sources on connected connections, grouped by connection", () => {
    const a = spec({ id: "a" });
    const b = spec({ id: "b", connection_id: "conn-2" });
    const c = spec({ id: "c" });
    const plan = planTick({ sources: [a, b, c], connections, modules, now });
    expect(plan.due.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect([...plan.byConnection.entries()].map(([id, list]) => [id, list.map((s) => s.id)])).toEqual([
      ["conn-1", ["a", "c"]],
      ["conn-2", ["b"]],
    ]);
  });

  it("skips a source whose company does not carry the data sources module", () => {
    const on = spec({ id: "on" });
    const off = spec({ id: "off", company_id: "company-off", connection_id: "conn-off" });
    const none = spec({ id: "none", company_id: "company-none", connection_id: "conn-off" });
    const unknown = spec({ id: "unknown", company_id: "company-missing", connection_id: "conn-off" });
    expect(planTick({ sources: [on, off, none, unknown], connections, modules, now }).due.map((s) => s.id)).toEqual(["on"]);
  });

  it("skips a source that is not due or whose connection is not connected", () => {
    const tried = spec({ id: "tried", last_attempt_at: "2026-11-09T13:30:00Z" });
    const broken = spec({ id: "broken", connection_id: "conn-broken" });
    const orphan = spec({ id: "orphan", connection_id: "conn-gone" });
    expect(planTick({ sources: [tried, broken, orphan], connections, modules, now }).due).toEqual([]);
  });

  it("judges each source on its own, so one that cannot be read never stops the others", () => {
    const skipped: string[] = [];
    const bad = Object.defineProperty(spec({ id: "bad" }), "sync_timezone", {
      get() {
        throw new Error("Unreadable zone");
      },
    });
    const good = spec({ id: "good" });
    const plan = planTick({ sources: [bad, good], connections, modules, now, onSkip: (id) => skipped.push(id) });
    expect(plan.due.map((s) => s.id)).toEqual(["good"]);
    expect(skipped).toEqual(["bad"]);
  });

  it("sweeps every connection it read, whether or not anything on it is due", () => {
    const plan = planTick({ sources: [spec({ id: "tried", last_attempt_at: "2026-11-09T13:30:00Z" })], connections, modules, now });
    expect(plan.due).toEqual([]);
    expect(plan.sweep).toEqual(["conn-1", "conn-2", "conn-off", "conn-broken"]);
  });
});

describe("sweepStaleRuns", () => {
  it("abandons runs older than the stale window on each connection", async () => {
    const calls: Array<[string, string]> = [];
    const store = {
      async abandonStaleRuns(connectionId: string, olderThan: Date) {
        calls.push([connectionId, olderThan.toISOString()]);
        return connectionId === "conn-1" ? 2 : 0;
      },
    };
    expect(await sweepStaleRuns(store, ["conn-1", "conn-2"], now)).toBe(2);
    const cutoff = new Date(now.getTime() - STALE_RUN_MINUTES * 60000).toISOString();
    expect(calls).toEqual([
      ["conn-1", cutoff],
      ["conn-2", cutoff],
    ]);
  });

  it("carries on past a connection whose sweep fails", async () => {
    const seen: string[] = [];
    const failed: string[] = [];
    const store = {
      async abandonStaleRuns(connectionId: string) {
        seen.push(connectionId);
        if (connectionId === "conn-1") throw new Error("Stale runs could not be cleared.");
        return 1;
      },
    };
    expect(await sweepStaleRuns(store, ["conn-1", "conn-2"], now, (id) => failed.push(id))).toBe(1);
    expect(seen).toEqual(["conn-1", "conn-2"]);
    expect(failed).toEqual(["conn-1"]);
  });
});
