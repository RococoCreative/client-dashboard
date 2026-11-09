// Read-only: the database writes audit events by trigger, and only Rococo admins can read them (0025).
import type { AuditEvent } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, table_name, row_id, action, changed, actor_user_id, actor_profile_id, actor_kind, created_at";

// companyId: a company's id narrows to that company, null to events with no company, and
// leaving it out reads every company. before pages back from the oldest event already shown.
export interface AuditFilter { companyId?: string | null; limit?: number; before?: string }

export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]> {
  let query = db().from("audit_events").select(COLUMNS);
  if (typeof filter?.companyId === "string") query = query.eq("company_id", filter.companyId);
  else if (filter?.companyId === null) query = query.is("company_id", null);
  if (filter?.before) query = query.lt("created_at", filter.before);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(filter?.limit ?? 100);
  if (error) throw error;
  return (data as AuditEvent[]) ?? [];
}
