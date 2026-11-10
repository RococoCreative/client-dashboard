// Pins how an audit event reads on the Activity page: the raw table name first, then what moved,
// with yes and no for flags, a list for arrays and "none" for an empty value.
import { describe, expect, it } from "vitest";
import type { AuditAction, AuditEvent } from "../types/database.ts";
import { AUDIT_TABLE_LABELS, describeAuditEvent } from "./audit.ts";

function event(table_name: string, action: AuditAction, changed: AuditEvent["changed"]): AuditEvent {
  return {
    id: "e-1",
    company_id: "co-1",
    table_name,
    row_id: "row-1",
    action,
    changed,
    actor_user_id: null,
    actor_profile_id: null,
    actor_kind: "system",
    created_at: "2026-09-01T12:00:00.000Z",
  };
}

const CASES: [string, AuditEvent, string][] = [
  ["one update", event("profiles", "update", { role: { old: "admin", new: "owner" } }), "profiles: role admin to owner"],
  [
    "two updates in key order",
    event("profiles", "update", { role: { old: "employee", new: "admin" }, is_active: { old: true, new: false } }),
    "profiles: role employee to admin; is_active yes to no",
  ],
  ["an array from empty", event("companies", "update", { modules: { old: [], new: ["switchboard", "wins"] } }), "companies: modules none to switchboard, wins"],
  [
    "an insert",
    event("invitations", "insert", { role: { old: null, new: "employee" }, email: { old: null, new: "new.hire@example.com" } }),
    "invitations: added (role employee, email new.hire@example.com)",
  ],
  [
    "a delete",
    event("company_domains", "delete", { domain: { old: "old.example", new: null }, company_id: { old: "co-1", new: null } }),
    "company_domains: removed (domain old.example, company_id co-1)",
  ],
  ["an insert with nothing set", event("job_roles", "insert", { dashboard_modules: { old: null, new: null } }), "job_roles: added"],
  ["an object as JSON", event("company_connections", "update", { settings: { old: null, new: { a: 1 } } }), 'company_connections: settings none to {"a":1}'],
  ["a number", event("gsr_pillars", "update", { weight: { old: 40, new: 50 } }), "gsr_pillars: weight 40 to 50"],
];

describe("describeAuditEvent", () => {
  it.each(CASES)("reads %s", (_name, input, expected) => {
    expect(describeAuditEvent(input)).toBe(expected);
  });

  it("never writes an em dash", () => {
    for (const [, input] of CASES) {
      expect(describeAuditEvent(input)).not.toContain("\u2014");
    }
  });
});

describe("AUDIT_TABLE_LABELS", () => {
  it("names every audited table", () => {
    expect(Object.keys(AUDIT_TABLE_LABELS)).toEqual([
      "companies",
      "profiles",
      "invitations",
      "company_domains",
      "company_connections",
      "gsr_pillars",
      "job_roles",
      "sync_sources",
      "external_links",
    ]);
    expect(AUDIT_TABLE_LABELS.company_domains).toBe("Sign-in domain");
  });
});
