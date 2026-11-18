// How an audit event reads to a person. Pure, so the Activity screens and their tests share one
// wording. describeAuditEvent is Rococo's own reading: the raw table name first, then each watched
// column that moved, with flags as yes and no, lists joined, and an empty value as "none".
// describeAuditEventPlain is what a company reads on its own Activity tab: plain names for tables
// and columns, the person a row is about by name, and ids turned into names from what the tab
// already loaded, or "someone" or "none", never a raw id.
import {
  CONNECTION_PROVIDER_LABELS,
  DASHBOARD_MODULE_LABELS,
  LINK_AUDIENCE_LABELS,
  LINK_PROVIDER_LABELS,
  ROLE_LABELS,
  SCORING_TYPE_LABELS,
  TARGET_MODULE_LABELS,
  type AuditEvent,
} from "../types/database.ts";
import { CAPABILITY_LABELS } from "./capabilities.ts";
import { LINK_GROUP_LABELS } from "./links.ts";
import { MODULE_LABELS } from "./modules.ts";

// Every audited table, the later ones included (sync_sources and external_links are attached by
// their own migrations), so this file stays the one place a table gets its plain name.
export const AUDIT_TABLE_LABELS: Record<string, string> = {
  companies: "Company",
  profiles: "Person",
  invitations: "Invitation",
  company_domains: "Sign-in domain",
  company_connections: "Connection",
  gsr_pillars: "Pillar",
  job_roles: "Job role",
  sync_sources: "Data source",
  external_links: "External link",
  company_capabilities: "Permission",
};

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (value === true) return "yes";
  if (value === false) return "no";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((item) => fmt(item)).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// The values an insert set or a delete removed, skipping the ones that were empty.
function listed(event: AuditEvent, side: "old" | "new"): string {
  const parts = Object.entries(event.changed)
    .filter(([, change]) => change[side] !== null && change[side] !== undefined)
    .map(([key, change]) => `${key} ${fmt(change[side])}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function describeAuditEvent(event: AuditEvent): string {
  const lead = `${event.table_name}: `;
  if (event.action === "insert") return `${lead}added${listed(event, "new")}`;
  if (event.action === "delete") return `${lead}removed${listed(event, "old")}`;
  const moves = Object.entries(event.changed).map(([key, change]) => `${key} ${fmt(change.old)} to ${fmt(change.new)}`);
  return `${lead}${moves.join("; ")}`;
}

// ---------------------------------------------------------------------------------------------
// The company tab's reading
// ---------------------------------------------------------------------------------------------

// Names the tab can put to ids, each keyed by id. Built once per list by auditNames().
export interface AuditNames {
  people: Map<string, string>;
  peopleByEmail: Map<string, string>;
  jobRoles: Map<string, string>;
  divisions: Map<string, string>;
  companies: Map<string, string>;
  // An override row's capability key, by row id. An edit only records the level that moved, so
  // the key comes from the override rows themselves, or from the event that added the row.
  capabilityRows: Map<string, string>;
  // An invitation's address, by row id, from the events that carry it.
  invitationEmails: Map<string, string>;
}

export function auditNames(input: {
  people?: { id: string; full_name: string | null; email: string }[];
  jobRoles?: { id: string; name: string }[];
  divisions?: { id: string; name: string }[];
  companies?: { id: string; name: string }[];
  capabilityRows?: { id: string; capability: string }[];
  events?: AuditEvent[];
}): AuditNames {
  const names: AuditNames = {
    people: new Map(),
    peopleByEmail: new Map(),
    jobRoles: new Map((input.jobRoles ?? []).map((j) => [j.id, j.name])),
    divisions: new Map((input.divisions ?? []).map((d) => [d.id, d.name])),
    companies: new Map((input.companies ?? []).map((c) => [c.id, c.name])),
    capabilityRows: new Map((input.capabilityRows ?? []).map((r) => [r.id, r.capability])),
    invitationEmails: new Map(),
  };
  for (const p of input.people ?? []) {
    const name = p.full_name?.trim() || p.email;
    names.people.set(p.id, name);
    names.peopleByEmail.set(p.email.toLowerCase(), name);
  }
  for (const e of input.events ?? []) {
    if (e.table_name === "company_capabilities" && !names.capabilityRows.has(e.row_id)) {
      const key = carried(e, "capability");
      if (key) names.capabilityRows.set(e.row_id, key);
    }
    if (e.table_name === "invitations" && !names.invitationEmails.has(e.row_id)) {
      const email = carried(e, "email");
      if (email) names.invitationEmails.set(e.row_id, email);
    }
  }
  return names;
}

// How a watched value reads. "detail" values (settings blobs, outside account ids) are not shown,
// only that they changed.
type Kind =
  | "text"
  | "flag"
  | "role"
  | "level"
  | "capability"
  | "person"
  | "jobRole"
  | "divisions"
  | "company"
  | "detail"
  | { labels: Record<string, string> };

interface Column {
  label: string;
  kind: Kind;
}

const COLUMNS: Record<string, Record<string, Column>> = {
  companies: {
    modules: { label: "modules", kind: { labels: MODULE_LABELS } },
    slug: { label: "short name", kind: "text" },
    theme_key: { label: "theme", kind: "text" },
    name: { label: "name", kind: "text" },
    time_zone: { label: "time zone", kind: "text" },
  },
  profiles: {
    role: { label: "role", kind: "role" },
    is_active: { label: "active", kind: "flag" },
    is_rococo_admin: { label: "Rococo staff", kind: "flag" },
    company_id: { label: "company", kind: "company" },
    reports_to: { label: "reports to", kind: "person" },
    job_role_id: { label: "job role", kind: "jobRole" },
    can_view_divisions: { label: "sees the division split", kind: "flag" },
    division_ids: { label: "divisions", kind: "divisions" },
    view_all_divisions: { label: "sees every division", kind: "flag" },
    view_division_ids: { label: "divisions they see", kind: "divisions" },
  },
  invitations: {
    role: { label: "role", kind: "role" },
    email: { label: "address", kind: "text" },
  },
  company_domains: {
    domain: { label: "domain", kind: "text" },
    company_id: { label: "company", kind: "company" },
  },
  company_connections: {
    status: { label: "status", kind: { labels: { not_connected: "Not connected", connected: "Connected", error: "Needs attention" } } },
    provider: { label: "system", kind: { labels: CONNECTION_PROVIDER_LABELS } },
    external_account_id: { label: "account", kind: "detail" },
  },
  gsr_pillars: {
    weight: { label: "weight", kind: "text" },
    scoring_type: { label: "scoring", kind: { labels: SCORING_TYPE_LABELS } },
    required_goals: { label: "goals required", kind: "text" },
  },
  job_roles: {
    dashboard_modules: { label: "dashboard sections", kind: { labels: DASHBOARD_MODULE_LABELS } },
  },
  sync_sources: {
    provider: { label: "system", kind: { labels: CONNECTION_PROVIDER_LABELS } },
    connection_id: { label: "connection", kind: "detail" },
    name: { label: "name", kind: "text" },
    target_module: { label: "feeds", kind: { labels: TARGET_MODULE_LABELS } },
    config: { label: "settings", kind: "detail" },
    field_map: { label: "field matching", kind: "detail" },
    record_key: { label: "record key", kind: "detail" },
    sync_weekday: { label: "sync day", kind: { labels: { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" } } },
    sync_time: { label: "sync time", kind: "text" },
    sync_timezone: { label: "time zone", kind: "text" },
    stale_after_hours: { label: "hours before it reads as stale", kind: "text" },
    enabled: { label: "on", kind: "flag" },
  },
  external_links: {
    nav_group: { label: "menu section", kind: { labels: LINK_GROUP_LABELS } },
    label: { label: "label", kind: "text" },
    url: { label: "address", kind: "text" },
    provider: { label: "system", kind: { labels: LINK_PROVIDER_LABELS } },
    embed_url: { label: "embed address", kind: "text" },
    embed_is_public: { label: "public embed", kind: "flag" },
    audience: { label: "who sees it", kind: { labels: LINK_AUDIENCE_LABELS } },
  },
  company_capabilities: {
    capability: { label: "permission", kind: "capability" },
    min_role: { label: "lowest role", kind: "level" },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A column no table lists here yet reads with its key's words, never its underscores.
function columnFor(table: string, key: string): Column {
  return COLUMNS[table]?.[key] ?? { label: key.replace(/_/g, " "), kind: "text" };
}

function tableLabel(table: string): string {
  return AUDIT_TABLE_LABELS[table] ?? table.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function plainValue(value: unknown, kind: Kind, names: AuditNames): string {
  if (value === null || value === undefined || value === "") return "none";
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (kind === "divisions") return value.map((id) => names.divisions.get(String(id)) ?? "a division no longer listed").join(", ");
    return value.map((item) => plainValue(item, kind, names)).join(", ");
  }
  if (value === true) return "yes";
  if (value === false) return "no";
  const text = String(value);
  if (typeof kind === "object") return kind.labels[text] ?? text;
  switch (kind) {
    case "role":
      return ROLE_LABELS[text as keyof typeof ROLE_LABELS] ?? text;
    case "level":
      return text === "rococo" ? "Rococo only" : (ROLE_LABELS[text as keyof typeof ROLE_LABELS] ?? text);
    case "capability":
      return CAPABILITY_LABELS[text as keyof typeof CAPABILITY_LABELS] ?? text.replace(/_/g, " ");
    case "person":
      return names.people.get(text) ?? "someone";
    case "jobRole":
      return names.jobRoles.get(text) ?? "a job role no longer listed";
    case "divisions":
      return names.divisions.get(text) ?? "a division no longer listed";
    case "company":
      return names.companies.get(text) ?? "another company";
    case "detail":
      return "set";
    default:
      if (typeof value === "object") return "set";
      return UUID.test(text) ? "one no longer listed" : text;
  }
}

// What the row is about, named: the person, the invitation's person or address, the permission.
// Columns that only name the subject are left out of the details after it.
function carried(event: AuditEvent, key: string): string | undefined {
  const change = event.changed[key];
  const value = change ? (change.new ?? change.old) : undefined;
  return typeof value === "string" ? value : undefined;
}

function subject(event: AuditEvent, names: AuditNames): { lead: string; skip: string[] } {
  if (event.table_name === "profiles") {
    return { lead: names.people.get(event.row_id) ?? "Someone", skip: [] };
  }
  if (event.table_name === "invitations") {
    const email = carried(event, "email") ?? names.invitationEmails.get(event.row_id);
    const who = email ? (names.peopleByEmail.get(email.toLowerCase()) ?? email) : undefined;
    return { lead: who ? `Invitation for ${who}` : "Invitation", skip: who ? ["email"] : [] };
  }
  if (event.table_name === "company_capabilities") {
    const key = carried(event, "capability") ?? names.capabilityRows.get(event.row_id);
    const name = key ? plainValue(key, "capability", names) : undefined;
    return { lead: name ? `Permission for ${name}` : "Permission", skip: name ? ["capability"] : [] };
  }
  return { lead: tableLabel(event.table_name), skip: [] };
}

export function describeAuditEventPlain(event: AuditEvent, names: AuditNames): string {
  const { lead, skip } = subject(event, names);
  const entries = Object.entries(event.changed).filter(([key]) => !skip.includes(key));
  if (event.action === "insert" || event.action === "delete") {
    const side = event.action === "insert" ? "new" : "old";
    const parts = entries
      .filter(([key, change]) => change[side] !== null && change[side] !== undefined && columnFor(event.table_name, key).kind !== "detail")
      .map(([key, change]) => {
        const column = columnFor(event.table_name, key);
        return `${column.label} ${plainValue(change[side], column.kind, names)}`;
      });
    const verb = event.action === "insert" ? "added" : "removed";
    return `${lead} ${verb}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
  }
  const moves = entries.map(([key, change]) => {
    const column = columnFor(event.table_name, key);
    if (column.kind === "detail") return `${column.label} changed`;
    return `${column.label} changed from ${plainValue(change.old, column.kind, names)} to ${plainValue(change.new, column.kind, names)}`;
  });
  return `${lead}: ${moves.join("; ")}`;
}
