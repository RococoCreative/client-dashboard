// Pins how an audit event reads: on Rococo's Activity page the raw table name first, then what
// moved, with yes and no for flags, a list for arrays and "none" for an empty value; on a
// company's own Activity tab, plain words with names in place of ids.
import { describe, expect, it } from "vitest";
import type { AuditAction, AuditEvent } from "../types/database.ts";
import { AUDIT_TABLE_LABELS, auditNames, describeAuditEvent, describeAuditEventPlain } from "./audit.ts";

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
      "company_capabilities",
      "milestone_templates",
      "connector_requests",
    ]);
    expect(AUDIT_TABLE_LABELS.company_domains).toBe("Sign-in domain");
    expect(AUDIT_TABLE_LABELS.milestone_templates).toBe("Standard milestone");
    expect(AUDIT_TABLE_LABELS.connector_requests).toBe("Tool request");
  });
});

describe("describeAuditEventPlain", () => {
  const JANE = "3f2a6c1e-8b4d-4e1a-9c2f-1a2b3c4d5e6f";
  const SAM = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  const GONE = "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4";
  const names = auditNames({
    people: [
      { id: JANE, full_name: "Jane Rivera", email: "jane@example.com" },
      { id: SAM, full_name: "Sam Ortiz", email: "sam@example.com" },
    ],
    jobRoles: [{ id: "jr-1", name: "Estimator" }],
    divisions: [{ id: "div-1", name: "North" }],
    companies: [{ id: "co-1", name: "Example Co" }],
    capabilityRows: [{ id: "cap-row-1", capability: "sync_run" }],
    events: [event("invitations", "insert", { role: { old: null, new: "employee" }, email: { old: null, new: "Sam@example.com" } })],
  });
  function on(table: string, action: AuditAction, changed: AuditEvent["changed"], row_id: string): AuditEvent {
    return { ...event(table, action, changed), row_id };
  }

  const PLAIN: [string, AuditEvent, string][] = [
    [
      "a role change, naming the person and the manager",
      on("profiles", "update", { role: { old: "owner", new: "admin" }, reports_to: { old: SAM, new: null } }, JANE),
      "Jane Rivera: role changed from Owner to Admin; reports to changed from Sam Ortiz to none",
    ],
    [
      "ids nobody can name",
      on("profiles", "update", { reports_to: { old: null, new: GONE }, job_role_id: { old: "jr-1", new: GONE } }, GONE),
      "Someone: reports to changed from none to someone; job role changed from Estimator to a job role no longer listed",
    ],
    [
      "divisions and flags",
      on("profiles", "update", { division_ids: { old: [], new: ["div-1"] }, view_all_divisions: { old: false, new: true } }, JANE),
      "Jane Rivera: divisions changed from none to North; sees every division changed from no to yes",
    ],
    [
      "an invitation for someone on the roster",
      on("invitations", "insert", { role: { old: null, new: "employee" }, email: { old: null, new: "Sam@example.com" } }, "row-1"),
      "Invitation for Sam Ortiz added (role Employee)",
    ],
    [
      "an invitation edit, named from the event that added it",
      on("invitations", "update", { role: { old: "employee", new: "manager" } }, "row-1"),
      "Invitation for Sam Ortiz: role changed from Employee to Manager",
    ],
    [
      "a new permission",
      on("company_capabilities", "insert", { capability: { old: null, new: "pay" }, min_role: { old: null, new: "owner" } }, "cap-row-2"),
      "Permission for Pay added (lowest role Owner)",
    ],
    [
      "a permission edit, named from its row",
      on("company_capabilities", "update", { min_role: { old: "owner", new: "rococo" } }, "cap-row-1"),
      "Permission for Sync now: lowest role changed from Owner to Rococo only",
    ],
    [
      "company modules",
      on("companies", "update", { modules: { old: [], new: ["switchboard", "wins"] } }, "co-1"),
      "Company: modules changed from none to Switchboard, Wins",
    ],
    [
      "a setting that is not shown",
      on("sync_sources", "update", { name: { old: "Sales", new: "Sales sheet" }, config: { old: { tab: "A" }, new: { tab: "B" } } }, "src-9"),
      "Data source: name changed from Sales to Sales sheet; settings changed",
    ],
    [
      "a data source's sync days and business days switch",
      on("sync_sources", "update", { sync_weekdays: { old: [1], new: [1, 2, 3, 4, 5] }, stale_business_days: { old: false, new: true } }, "src-1"),
      "Data source: sync days changed from Monday to Monday, Tuesday, Wednesday, Thursday, Friday; counts business days only changed from no to yes",
    ],
    [
      "a tool request, naming the tool",
      on("connector_requests", "insert", { connector_key: { old: null, new: "google_calendar" } }, "req-1"),
      "Tool request added (tool Google Calendar)",
    ],
    [
      "a withdrawn tool request",
      on("connector_requests", "delete", { connector_key: { old: "jobtread", new: null } }, "req-1"),
      "Tool request removed (tool JobTread)",
    ],
    [
      "a tool request whose key shares a name with an Object property, as the bare key",
      on("connector_requests", "insert", { connector_key: { old: null, new: "constructor" } }, "req-2"),
      "Tool request added (tool constructor)",
    ],
  ];

  it.each(PLAIN)("reads %s", (_name, input, expected) => {
    expect(describeAuditEventPlain(input, names)).toBe(expected);
  });

  it("never shows a raw id, a raw column name or an em dash", () => {
    for (const [, input] of PLAIN) {
      const text = describeAuditEventPlain(input, names);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(text).not.toContain("\u2014");
    }
  });
});
