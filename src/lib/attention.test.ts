// Pins the Attention card's rules: one line for everyone not signed in yet, one per open cycle
// whose period has ended, one per live campaign with no budget, one per connection in error, the
// danger items first, and nothing invented beyond those four signals.
import { describe, expect, it } from "vitest";
import type { CompanyConnection, MarketingCampaign, Profile, ReviewCycle } from "../types/database.ts";
import { attentionItems, type AttentionInput } from "./attention.ts";

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
});
