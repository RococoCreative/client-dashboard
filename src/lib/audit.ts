// How an audit event reads to a person. Pure, so the Activity page and its tests share one
// wording: the raw table name first (it is Rococo's own screen), then each watched column that
// moved, with flags as yes and no, lists joined, and an empty value as "none".
import type { AuditEvent } from "../types/database.ts";

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
