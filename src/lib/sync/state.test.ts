// Proves the six honest states a data source shows, in precedence order.
import { describe, expect, it } from "vitest";
import { STALE_RUN_MINUTES } from "../../../supabase/functions/_shared/sync/runner.ts";
import { SYNC_STATE_LABELS, ageHours, failureDetail, runCutOff, syncState } from "./state.ts";
import type { SyncSource } from "../../types/database.ts";

const now = new Date("2026-11-09T14:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
type SourceState = Pick<SyncSource, "last_status" | "last_attempt_at" | "last_success_at" | "stale_after_hours" | "last_error">;
const source = (patch: Partial<SourceState> = {}): SourceState => ({
  last_status: null,
  last_attempt_at: null,
  last_error: null,
  last_success_at: null,
  stale_after_hours: null,
  ...patch,
});
const connected = { status: "connected" as const };

describe("syncState", () => {
  it("is not connected without a working connection, whatever happened before", () => {
    expect(syncState(source({ last_status: "failed" }), null, now)).toBe("not_connected");
    expect(syncState(source(), { status: "not_connected" }, now)).toBe("not_connected");
  });

  it("is syncing while a run is going", () => {
    expect(syncState(source({ last_status: "running" }), { status: "error" }, now)).toBe("syncing");
    expect(syncState(source({ last_status: "running", last_attempt_at: minutesAgo(5) }), connected, now)).toBe("syncing");
    expect(syncState(source({ last_status: "running", last_attempt_at: minutesAgo(STALE_RUN_MINUTES) }), connected, now)).toBe("syncing");
  });

  it("is failed when a run has been going longer than the stale window, so it never reads Syncing forever", () => {
    const cut = source({ last_status: "running", last_attempt_at: minutesAgo(STALE_RUN_MINUTES + 1), last_success_at: hoursAgo(30) });
    expect(syncState(cut, connected, now)).toBe("failed");
    expect(syncState(cut, { status: "error" }, now)).toBe("failed");
    expect(syncState(cut, null, now)).toBe("not_connected");
  });

  it("is failed after a failed or abandoned run, or when the connection needs attention", () => {
    expect(syncState(source({ last_status: "failed", last_success_at: hoursAgo(1) }), connected, now)).toBe("failed");
    expect(syncState(source({ last_status: "abandoned", last_success_at: hoursAgo(1) }), connected, now)).toBe("failed");
    expect(syncState(source({ last_status: "succeeded", last_success_at: hoursAgo(1) }), { status: "error" }, now)).toBe("failed");
    expect(syncState(source({ last_status: "failed" }), connected, now)).toBe("failed");
  });

  it("awaits its first sync until one succeeds", () => {
    expect(syncState(source(), connected, now)).toBe("awaiting_first_sync");
  });

  it("is stale only past its own threshold", () => {
    const ok = { last_status: "succeeded" as const, stale_after_hours: 24 };
    expect(syncState(source({ ...ok, last_success_at: hoursAgo(25) }), connected, now)).toBe("stale");
    expect(syncState(source({ ...ok, last_success_at: hoursAgo(23) }), connected, now)).toBe("synced");
    expect(syncState(source({ ...ok, last_success_at: hoursAgo(24) }), connected, now)).toBe("synced");
    expect(syncState(source({ ...ok, stale_after_hours: null, last_success_at: hoursAgo(1000) }), connected, now)).toBe("synced");
  });
});

describe("runCutOff", () => {
  it("is true only for a running sync that started before the stale window", () => {
    expect(runCutOff(source({ last_status: "running", last_attempt_at: minutesAgo(STALE_RUN_MINUTES + 1) }), now)).toBe(true);
    expect(runCutOff(source({ last_status: "running", last_attempt_at: minutesAgo(STALE_RUN_MINUTES) }), now)).toBe(false);
    expect(runCutOff(source({ last_status: "running", last_attempt_at: null }), now)).toBe(false);
    expect(runCutOff(source({ last_status: "failed", last_attempt_at: minutesAgo(600) }), now)).toBe(false);
  });
});

describe("failureDetail", () => {
  it("says a cut-off sync did not finish, whatever an older run left behind", () => {
    const cut = source({ last_status: "running", last_attempt_at: minutesAgo(60), last_error: "An older problem." });
    expect(failureDetail(cut, now)).toBe("The last sync did not finish.");
  });

  it("is the source's own error, then the connection's, then a plain line", () => {
    expect(failureDetail(source({ last_status: "failed", last_error: "Missing column." }), now, { last_error: "Token expired" })).toBe("Missing column.");
    expect(failureDetail(source({ last_status: "failed" }), now, { last_error: "Token expired" })).toBe("Token expired");
    expect(failureDetail(source({ last_status: "failed" }), now)).toBe("The last attempt did not finish.");
  });
});

describe("ageHours", () => {
  it("is the hours since the last success, or null", () => {
    expect(ageHours(null, now)).toBeNull();
    expect(ageHours(new Date(now.getTime() - 90 * 60000).toISOString(), now)).toBe(1.5);
  });
});

describe("SYNC_STATE_LABELS", () => {
  it("names every state plainly", () => {
    expect(SYNC_STATE_LABELS).toEqual({
      not_connected: "Not connected",
      awaiting_first_sync: "Awaiting first sync",
      syncing: "Syncing",
      failed: "Sync failed",
      stale: "Stale data",
      synced: "Synced",
    });
  });
});
