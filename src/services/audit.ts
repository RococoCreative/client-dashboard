// Read-only: the database writes audit events by trigger, and only Rococo admins can read them (0025).
import type { AuditEvent } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, table_name, row_id, action, changed, actor_user_id, actor_profile_id, actor_kind, created_at";

// companyId: a company's id narrows to that company, null to events with no company, and
// leaving it out reads every company. before pages back from the oldest event already shown: it
// carries that event's created_at and id, because a burst of changes can share one timestamp, and
// a cursor on the timestamp alone would skip the rest of a burst that straddles a page boundary.
export interface AuditCursor { created_at: string; id: string }
export interface AuditFilter { companyId?: string | null; limit?: number; before?: AuditCursor }

// PostgREST reads , . : ( ) as syntax inside an or() filter, so values go in double quotes.
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]> {
  let query = db().from("audit_events").select(COLUMNS);
  if (typeof filter?.companyId === "string") query = query.eq("company_id", filter.companyId);
  else if (filter?.companyId === null) query = query.is("company_id", null);
  if (filter?.before) {
    const at = quoted(filter.before.created_at);
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${quoted(filter.before.id)})`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filter?.limit ?? 100);
  if (error) throw error;
  return (data as AuditEvent[]) ?? [];
}
