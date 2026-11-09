// In-memory stand-in for services/audit.ts, same exports, for page tests and the demo. It applies
// the same company filter, cursor, newest-first order and limit as the real query.
import type { AuditEvent } from "../../types/database.ts";
import { AUDIT_EVENTS } from "../fixtures.ts";

const events: AuditEvent[] = AUDIT_EVENTS.map((e) => ({ ...e }));

export interface AuditFilter { companyId?: string | null; limit?: number; before?: string }

export async function listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]> {
  return events
    .filter((e) => {
      if (typeof filter?.companyId === "string" && e.company_id !== filter.companyId) return false;
      if (filter?.companyId === null && e.company_id !== null) return false;
      if (filter?.before && !(e.created_at < filter.before)) return false;
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, filter?.limit ?? 100);
}
