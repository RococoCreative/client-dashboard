// In-memory stand-in for services/audit.ts, same exports, for page tests and the demo. It applies
// the same company filter, (created_at, id) cursor, newest-first order and limit as the real query.
import type { AuditEvent } from "../../types/database.ts";
import { AUDIT_EVENTS } from "../fixtures.ts";

const events: AuditEvent[] = AUDIT_EVENTS.map((e) => ({ ...e }));

export interface AuditCursor { created_at: string; id: string }
export interface AuditFilter { companyId?: string | null; limit?: number; before?: AuditCursor }

// The real query's order, created_at desc then id desc: negative when a comes before b.
function newerFirst(a: AuditCursor, b: AuditCursor): number {
  return b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]> {
  return events
    .filter((e) => {
      if (typeof filter?.companyId === "string" && e.company_id !== filter.companyId) return false;
      if (filter?.companyId === null && e.company_id !== null) return false;
      if (filter?.before && !(newerFirst(filter.before, e) < 0)) return false;
      return true;
    })
    .sort(newerFirst)
    .slice(0, filter?.limit ?? 100);
}
