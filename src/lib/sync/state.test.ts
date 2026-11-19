// Proves the six honest states a data source shows, in precedence order.
import { describe, expect, it } from "vitest";
import { STALE_RUN_MINUTES } from "../../../supabase/functions/_shared/sync/runner.ts";
import { SYNC_STATE_LABELS, ageHours, businessHoursBetween, failureDetail, runCutOff, syncState } from "./state.ts";
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

// Weekdays-only staleness. America/New_York is UTC-5 in November (EST) and UTC-4 in March
// through October (EDT); each instant below is written in UTC from its New York wall time.
describe("businessHoursBetween", () => {
  const NY = "America/New_York";
  const at = (iso: string) => new Date(iso);

  it("counts no hours across a whole weekend", () => {
    // Fri 17:00 EST -> Mon 07:00 EST: 7 hours of Friday and 7 of Monday.
    expect(businessHoursBetween(at("2026-11-06T22:00:00Z"), at("2026-11-09T12:00:00Z"), NY)).toBe(14);
  });

  it("counts every hour between two weekday instants", () => {
    expect(businessHoursBetween(at("2026-11-10T14:00:00Z"), at("2026-11-11T14:00:00Z"), NY)).toBe(24);
  });

  it("counts nothing when both ends are inside one weekend", () => {
    // Sat 10:00 EST -> Sun 20:00 EST.
    expect(businessHoursBetween(at("2026-11-07T15:00:00Z"), at("2026-11-09T01:00:00Z"), NY)).toBe(0);
    expect(businessHoursBetween(at("2026-11-07T15:00:00Z"), at("2026-11-07T18:00:00Z"), NY)).toBe(0);
  });

  it("counts nothing for an empty or reversed span", () => {
    expect(businessHoursBetween(at("2026-11-10T14:00:00Z"), at("2026-11-10T14:00:00Z"), NY)).toBe(0);
    expect(businessHoursBetween(at("2026-11-11T14:00:00Z"), at("2026-11-10T14:00:00Z"), NY)).toBe(0);
  });

  it("judges the weekend in the zone given, not UTC", () => {
    // Sun 23:00 EST (Mon 04:00 UTC) -> Mon 02:00 EST (Mon 07:00 UTC): 2 weekday hours in New York,
    // where UTC would call all 3 weekday.
    expect(businessHoursBetween(at("2026-11-09T04:00:00Z"), at("2026-11-09T07:00:00Z"), NY)).toBe(2);
    expect(businessHoursBetween(at("2026-11-09T04:00:00Z"), at("2026-11-09T07:00:00Z"), "UTC")).toBe(3);
  });

  it("counts the real hours across the spring transition (the 23 hour Sunday is a weekend anyway)", () => {
    // Fri 2026-03-06 20:00 EST -> Mon 2026-03-09 04:00 EDT: 4 hours of Friday and 4 of Monday.
    expect(businessHoursBetween(at("2026-03-07T01:00:00Z"), at("2026-03-09T08:00:00Z"), NY)).toBe(8);
    // Mon midnight is 04:00Z after the change; a fixed -5 offset would put it an hour off.
    expect(businessHoursBetween(at("2026-03-07T12:00:00Z"), at("2026-03-09T16:00:00Z"), NY)).toBe(12);
  });

  it("counts the real hours across the fall transition (the 25 hour Sunday is a weekend anyway)", () => {
    // Fri 2026-10-30 20:00 EDT -> Mon 2026-11-02 04:00 EST: 4 hours of Friday and 4 of Monday.
    expect(businessHoursBetween(at("2026-10-31T00:00:00Z"), at("2026-11-02T09:00:00Z"), NY)).toBe(8);
    // Mon midnight is 05:00Z after the change.
    expect(businessHoursBetween(at("2026-10-31T12:00:00Z"), at("2026-11-02T17:00:00Z"), NY)).toBe(12);
  });
});

describe("syncState with weekdays only", () => {
  type Row = Pick<SyncSource, "last_status" | "last_attempt_at" | "last_success_at" | "stale_after_hours" | "stale_business_days" | "sync_timezone">;
  const row = (patch: Partial<Row> = {}): Row => ({
    last_status: "succeeded",
    last_attempt_at: null,
    last_success_at: "2026-11-06T22:00:00Z", // Fri 17:00 EST
    stale_after_hours: 48,
    stale_business_days: true,
    sync_timezone: "America/New_York",
    ...patch,
  });
  const monday7am = new Date("2026-11-09T12:00:00Z");

  it("is not stale on Monday 07:00 after a Friday 17:00 sync with 48 hours and weekdays only", () => {
    expect(syncState(row(), connected, monday7am, "America/Chicago")).toBe("synced");
  });

  it("is stale in the same case with weekdays only off", () => {
    expect(syncState(row({ stale_business_days: false }), connected, monday7am, "America/New_York")).toBe("stale");
  });

  it("is stale on Wednesday 18:00 after a Friday 17:00 sync with weekdays only", () => {
    // 7 + 24 + 24 + 18 = 73 > 48.
    expect(syncState(row(), connected, new Date("2026-11-11T23:00:00Z"), "America/New_York")).toBe("stale");
  });

  it("judges the weekend in the source's zone, not UTC", () => {
    // Synced Sunday 23:00 New York (Monday 04:00 UTC), checked Wednesday 03:00 New York (08:00 UTC).
    // Weekday hours in New York: 24 + 24 + 3 = 51 (Sunday's last hour is a weekend hour). Read in
    // UTC the span is Monday 04:00 to Wednesday 08:00, 52 weekday hours. A limit of 51 separates them.
    const sunday = row({ last_success_at: "2026-11-09T04:00:00Z", stale_after_hours: 51 });
    const wednesday3am = new Date("2026-11-11T08:00:00Z");
    expect(syncState(sunday, connected, wednesday3am, "UTC")).toBe("synced");
    expect(syncState({ ...sunday, sync_timezone: "UTC" }, connected, wednesday3am, "America/New_York")).toBe("stale");
  });

  it("falls back to the company's zone when the source has no schedule", () => {
    const unscheduled = row({ sync_timezone: null, last_success_at: "2026-11-09T04:00:00Z", stale_after_hours: 51 });
    const wednesday3am = new Date("2026-11-11T08:00:00Z");
    expect(syncState(unscheduled, connected, wednesday3am, "America/New_York")).toBe("synced");
    expect(syncState(unscheduled, connected, wednesday3am, "UTC")).toBe("stale");
  });

  it("falls back to elapsed hours for a zone it cannot read", () => {
    expect(syncState(row({ sync_timezone: "UTC+5" }), connected, monday7am, "America/New_York")).toBe("stale");
  });

  it("leaves a source with the flag off exactly as before", () => {
    expect(syncState(row({ stale_business_days: false, last_success_at: hoursAgo(47) }), connected, now, "America/New_York")).toBe("synced");
    expect(syncState(row({ stale_business_days: false, last_success_at: hoursAgo(49) }), connected, now, "America/New_York")).toBe("stale");
  });
});
