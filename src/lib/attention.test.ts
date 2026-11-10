// Pins the Attention card's rules: one line for everyone not signed in yet, one per open cycle
// whose period has ended, one per live campaign with no budget, one per connection in error, one
// per enabled data source whose sync failed or went stale, the danger items first, and nothing
// invented beyond those signals.
import { describe, expect, it } from "vitest";
import type { CompanyConnection, MarketingCampaign, Profile, ReviewCycle, SyncSource } from "../types/database.ts";
import { attentionItems, type AttentionInput } from "./attention.ts";
import { formatDateTime } from "./format.ts";

const STAMP = "2026-01-01T00:00:00Z";
let seq = 0;

function person(overrides: Partial<Profile> = {}): Profile {
  seq += 1;
  return {
    id: `person-${seq}`,
    user_id: `user-${seq}`,
    email: `person${seq}@example.test`,
    full_name: `Person ${seq}`,
    title: null,
    company_id: "co",
    role: "employee",
    is_rococo_admin: false,
    is_active: true,
    hire_date: null,
    phone: null,
    department: null,
    reports_to: null,
    job_role_id: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function cycle(overrides: Partial<ReviewCycle> = {}): ReviewCycle {
  seq += 1;
  return {
    id: `cycle-${seq}`,
    company_id: "co",
    name: `Cycle ${seq}`,
    cadence: "monthly",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    theme: null,
    theme_description: null,
    status: "open",
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function campaign(overrides: Partial<MarketingCampaign> = {}): MarketingCampaign {
  seq += 1;
  return {
    id: `campaign-${seq}`,
    company_id: "co",
    name: `Campaign ${seq}`,
    channel: null,
    status: "active",
    start_date: null,
    end_date: null,
    budget: 1000,
    actual_spend: null,
    goal: null,
    key_metric_label: null,
    key_metric_value: null,
    results: null,
    notes: null,
    sort_order: seq,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function connection(overrides: Partial<CompanyConnection> = {}): CompanyConnection {
  seq += 1;
  return {
    id: `connection-${seq}`,
    company_id: "co",
    provider: "gohighlevel",
    status: "connected",
    external_account_id: null,
    external_account_name: null,
    scopes: null,
    connected_by: null,
    connected_at: null,
    last_synced_at: null,
    last_error: null,
    settings: {},
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function source(overrides: Partial<SyncSource> = {}): SyncSource {
  seq += 1;
  return {
    id: `source-${seq}`,
    company_id: "co",
    connection_id: "sheets",
    provider: "google_sheets",
    name: `Source ${seq}`,
    target_module: "sales_reporting",
    config: { spreadsheet_id: "sheet", sheet_gid: 0, range: null, header_row: 1 },
    field_map: [],
    record_key: [],
    sync_weekday: null,
    sync_time: null,
    sync_timezone: null,
    stale_after_hours: null,
    enabled: true,
    current_run_id: null,
    last_attempt_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    sync_requested_at: null,
    created_by: null,
    updated_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return { people: [], cycles: [], campaigns: [], connections: [], today: "2026-09-15", ...overrides };
}

describe("attentionItems", () => {
  it("gives nothing when nothing is wrong", () => {
    expect(
      attentionItems(
        input({
          people: [person()],
          cycles: [cycle()],
          campaigns: [campaign()],
          connections: [connection()],
        }),
      ),
    ).toEqual([]);
  });

  it("counts active people without an account in one item", () => {
    const two = attentionItems(input({ people: [person({ user_id: null }), person({ user_id: null }), person({ user_id: null, is_active: false }), person()] }));
    expect(two).toEqual([
      { kind: "not_signed_in", title: "People not signed in", detail: "2 people have not signed in yet.", to: "/people", severity: "warning" },
    ]);
    const one = attentionItems(input({ people: [person({ user_id: null }), person()] }));
    expect(one.map((i) => i.detail)).toEqual(["1 person has not signed in yet."]);
  });

  it("flags an open cycle whose period ended before today", () => {
    const monthly = cycle({ name: "August GSR", cadence: "monthly", period_end: "2026-09-14" });
    const quarterly = cycle({ name: "Q2 2026", cadence: "quarterly", period_end: "2026-06-30" });
    const items = attentionItems(
      input({
        cycles: [
          monthly,
          cycle({ period_end: "2026-09-15" }),
          cycle({ status: "closed", period_end: "2026-08-31" }),
          quarterly,
        ],
      }),
    );
    expect(items).toEqual([
      {
        kind: "cycle_overdue",
        title: "August GSR is still open",
        detail: "Its period ended Sep 14, 2026. Close it when the reviews are done.",
        to: `/gsr/cycles/${monthly.id}`,
        severity: "warning",
      },
      {
        kind: "cycle_overdue",
        title: "Q2 2026 is still open",
        detail: "Its period ended Jun 30, 2026. Close it when the reviews are done.",
        to: `/reviews/cycles/${quarterly.id}`,
        severity: "warning",
      },
    ]);
  });

  it("flags active and paused campaigns with no budget", () => {
    const items = attentionItems(
      input({
        campaigns: [
          campaign({ name: "Spring mailer", status: "active", budget: null }),
          campaign({ name: "Radio spots", status: "paused", budget: null }),
          campaign({ status: "planned", budget: null }),
          campaign({ status: "active", budget: 0 }),
        ],
      }),
    );
    expect(items).toEqual([
      { kind: "campaign_no_budget", title: "Spring mailer has no budget", detail: "Set a budget so spend can be read against it.", to: "/marketing", severity: "warning" },
      { kind: "campaign_no_budget", title: "Radio spots has no budget", detail: "Set a budget so spend can be read against it.", to: "/marketing", severity: "warning" },
    ]);
  });

  it("flags a connection in error with its own message or the fallback line", () => {
    const items = attentionItems(
      input({
        connections: [
          connection({ provider: "gohighlevel", status: "error", last_error: "Token expired" }),
          connection({ provider: "quickbooks", status: "error" }),
          connection({ status: "connected" }),
        ],
      }),
    );
    expect(items).toEqual([
      { kind: "connection_error", title: "GoHighLevel needs reconnecting", detail: "Token expired", to: "/settings", severity: "danger" },
      {
        kind: "connection_error",
        title: "QuickBooks Online needs reconnecting",
        detail: "The connection reported an error. Reconnect it in Settings.",
        to: "/settings",
        severity: "danger",
      },
    ]);
  });

  it("puts danger first, then people, cycles and campaigns", () => {
    const items = attentionItems(
      input({
        people: [person({ user_id: null })],
        cycles: [cycle({ period_end: "2026-09-01" })],
        campaigns: [campaign({ budget: null })],
        connections: [connection({ status: "error" })],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["connection_error", "not_signed_in", "cycle_overdue", "campaign_no_budget"]);
  });

  it("never uses an em dash", () => {
    const items = attentionItems(
      input({
        people: [person({ user_id: null }), person({ user_id: null })],
        cycles: [cycle({ period_end: "2026-09-01" })],
        campaigns: [campaign({ budget: null })],
        connections: [connection({ status: "error" }), connection({ status: "error", last_error: "Token expired" })],
      }),
    );
    expect(items.length).toBe(5);
    for (const item of items) {
      expect(item.title).not.toContain("\u2014");
      expect(item.detail).not.toContain("\u2014");
    }
  });

  describe("data sources", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
    const sheets = connection({ id: "sheets", provider: "google_sheets", status: "connected" });

    it("flags a failed enabled source with its own error", () => {
      const failed = source({ name: "Sales tab", last_status: "failed", last_success_at: hoursAgo(2), last_error: "The column \"Gross profit\" is missing." });
      expect(attentionItems(input({ connections: [sheets], sources: [failed], now }))).toEqual([
        { kind: "sync_failed", title: "Sales tab: sync failed", detail: "The column \"Gross profit\" is missing.", to: "/settings", severity: "danger" },
      ]);
      const silent = source({ name: "Other tab", last_status: "failed" });
      expect(attentionItems(input({ connections: [sheets], sources: [silent], now })).map((i) => i.detail)).toEqual(["The last attempt did not finish."]);
    });

    it("flags a sync that was cut off mid-run, rather than leaving it Syncing", () => {
      const lastAttempt = new Date(now.getTime() - 2 * 3600000).toISOString();
      const cut = source({ name: "Cut tab", last_status: "running", last_attempt_at: lastAttempt, last_success_at: hoursAgo(170), last_error: "An older problem." });
      expect(attentionItems(input({ connections: [sheets], sources: [cut], now }))).toEqual([
        { kind: "sync_failed", title: "Cut tab: sync failed", detail: "The last sync did not finish.", to: "/settings", severity: "danger" },
      ]);
      const running = source({ name: "Live tab", last_status: "running", last_attempt_at: new Date(now.getTime() - 60000).toISOString() });
      expect(attentionItems(input({ connections: [sheets], sources: [running], now }))).toEqual([]);
    });

    it("flags a stale enabled source with its last success time", () => {
      const lastSuccess = hoursAgo(30);
      const stale = source({ name: "Stale tab", last_status: "succeeded", last_success_at: lastSuccess, stale_after_hours: 24 });
      expect(attentionItems(input({ connections: [sheets], sources: [stale], now }))).toEqual([
        { kind: "sync_stale", title: "Stale tab: stale data", detail: `Last synced ${formatDateTime(lastSuccess)}.`, to: "/settings", severity: "warning" },
      ]);
    });

    it("says nothing about a disabled source", () => {
      const off = source({ enabled: false, last_status: "failed", last_error: "Broken" });
      expect(attentionItems(input({ connections: [sheets], sources: [off], now }))).toEqual([]);
    });

    it("puts a failed source before warnings", () => {
      const stale = source({ name: "Stale tab", last_status: "succeeded", last_success_at: hoursAgo(30), stale_after_hours: 24 });
      const failed = source({ name: "Failed tab", last_status: "failed" });
      const items = attentionItems(input({ people: [person({ user_id: null })], connections: [sheets], sources: [stale, failed], now }));
      expect(items.map((i) => i.kind)).toEqual(["sync_failed", "not_signed_in", "sync_stale"]);
    });

    it("changes nothing without sources", () => {
      const base = { people: [person({ user_id: null })], connections: [connection({ status: "error" })] };
      expect(attentionItems(input({ ...base, sources: [] }))).toEqual(attentionItems(input(base)));
      expect(attentionItems(input(base)).map((i) => i.kind)).toEqual(["connection_error", "not_signed_in"]);
    });
  });
});
