// Pins the connector registry and the one rule that turns a company's connection row, modules and
// Rococo's keys into what a catalog card shows, so no page re-derives a card's state.
import { describe, expect, it } from "vitest";
import { PROVIDER_KEYS } from "../../supabase/functions/_shared/providers.ts";
import type { CompanyConnection } from "../types/database.ts";
import {
  CARD_STATE_ORDER, CONNECTORS, CONNECTOR_GROUPS, cardView, summaryCounts,
  type CardInputs, type Connector,
} from "./connectors.ts";

function byKey(key: string): Connector {
  const c = CONNECTORS.find((x) => x.key === key);
  if (!c) throw new Error(`no connector ${key}`);
  return c;
}

function rowOf(provider: CompanyConnection["provider"], status: CompanyConnection["status"]): CompanyConnection {
  return {
    id: "c1", company_id: "co1", provider, status, external_account_id: null, external_account_name: null,
    scopes: null, connected_by: null, connected_at: null, last_synced_at: null, last_error: null,
    settings: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

const sheets = byKey("google_sheets");
const qbo = byKey("quickbooks");
const monday = byKey("monday");
const on = () => true;
const off = () => false;
const inputs = (over: Partial<CardInputs>): CardInputs => ({ row: null, hasModule: on, keysIn: true, linkCount: 0, ...over });

describe("CONNECTORS", () => {
  it("has eleven connectors with unique keys in the four groups", () => {
    expect(CONNECTORS).toHaveLength(11);
    expect(new Set(CONNECTORS.map((c) => c.key)).size).toBe(11);
    expect(CONNECTOR_GROUPS.map((g) => g.key)).toEqual(["financials", "production", "marketing_sales", "productivity"]);
    for (const c of CONNECTORS) expect(CONNECTOR_GROUPS.map((g) => g.key)).toContain(c.group);
  });
  it("lists exactly the live providers PROVIDER_KEYS names", () => {
    expect(CONNECTORS.filter((c) => c.availability === "live").map((c) => c.provider).sort()).toEqual([...PROVIDER_KEYS].sort());
  });
  it("gives every live entry its secret names", () => {
    expect(qbo.secretNames).toEqual(["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"]);
    expect(sheets.secretNames).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(byKey("gohighlevel").secretNames).toEqual(["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"]);
  });
  it("has no em dashes in copy", () => {
    for (const c of CONNECTORS) expect([c.name, c.description, ...(c.feeds ?? [])].join(" ")).not.toContain("—");
  });
});

describe("cardView, live tool", () => {
  it("reads Connected when the row is connected, even with the module off and keys missing", () =>
    expect(cardView(sheets, { row: rowOf("google_sheets", "connected"), hasModule: off, keysIn: false, linkCount: 0 }))
      .toEqual({ state: "connected", action: "manage", blocked: null }));
  it("reads Needs attention with Reconnect when the row is in error and keys are in", () =>
    expect(cardView(qbo, inputs({ row: rowOf("quickbooks", "error") })))
      .toEqual({ state: "needs_attention", action: "reconnect", blocked: null }));
  it("reads Needs attention with no Reconnect and 'Rococo is setting this up.' when keys are missing", () =>
    expect(cardView(qbo, inputs({ row: rowOf("quickbooks", "error"), keysIn: false })))
      .toEqual({ state: "needs_attention", action: null, blocked: "Rococo is setting this up." }));
  it("reads Needs attention with 'Needs Data sources, which Rococo turns on.' when its module is off", () =>
    expect(cardView(sheets, inputs({ row: rowOf("google_sheets", "error"), hasModule: off })))
      .toEqual({ state: "needs_attention", action: null, blocked: "Needs Data sources, which Rococo turns on." }));
  it("reads Not connected with Connect when keys are in and there is no row or a not_connected row", () => {
    const want = { state: "not_connected", action: "connect", blocked: null };
    expect(cardView(qbo, inputs({}))).toEqual(want);
    expect(cardView(qbo, inputs({ row: rowOf("quickbooks", "not_connected") }))).toEqual(want);
  });
  it("reads Not available yet with no action when keys are missing", () =>
    expect(cardView(qbo, inputs({ keysIn: false })))
      .toEqual({ state: "not_available", action: null, blocked: "Rococo is setting this up." }));
  it("treats unknown key status (null) as keys in", () =>
    expect(cardView(qbo, inputs({ keysIn: null }))).toEqual({ state: "not_connected", action: "connect", blocked: null }));
  it("reads Not on for this company when its module is off and there is no live row", () =>
    expect(cardView(sheets, inputs({ hasModule: off })))
      .toEqual({ state: "not_on", action: null, blocked: "Needs Data sources, which Rococo turns on." }));
});

describe("cardView, links tool", () => {
  it("reads Linked with Manage links when the module is on and there is at least one link", () =>
    expect(cardView(monday, inputs({ linkCount: 2 }))).toEqual({ state: "linked", action: "manage_links", blocked: null }));
  it("reads Not set up with Add a board link when the module is on and there are no links", () =>
    expect(cardView(monday, inputs({}))).toEqual({ state: "not_set_up", action: "add_link", blocked: null }));
  it("reads Not on for this company when external_links is off", () =>
    expect(cardView(monday, inputs({ hasModule: off, linkCount: 3 })))
      .toEqual({ state: "not_on", action: null, blocked: "Needs External links, which Rococo turns on." }));
});

describe("cardView, coming", () => {
  it("reads Coming next for JobTread and Coming soon for Asana, both with Ask", () => {
    expect(cardView(byKey("jobtread"), inputs({}))).toEqual({ state: "coming_next", action: "ask", blocked: null });
    expect(cardView(byKey("asana"), inputs({}))).toEqual({ state: "coming_soon", action: "ask", blocked: null });
  });
});

describe("summaryCounts and order", () => {
  it("counts connected and linked as connected, needs attention, and not connected as available", () => {
    const v = (state: Parameters<typeof summaryCounts>[0][number]["state"]) => ({ state, action: null, blocked: null });
    expect(summaryCounts([v("connected"), v("linked"), v("needs_attention"), v("not_connected"), v("not_connected"), v("coming_soon")]))
      .toEqual({ connected: 2, attention: 1, available: 2 });
  });
  it("orders states as the spec does", () => {
    expect(CARD_STATE_ORDER.needs_attention).toBe(0);
    expect(CARD_STATE_ORDER.coming_soon).toBe(8);
  });
});
