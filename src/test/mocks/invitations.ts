// In-memory stand-in for services/invitations.ts, same exports, so page tests and `npm run demo`
// run against seeded invitation rows and never touch the network.
import type { Invitation, Role } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";

const invitations: Invitation[] = fromAll((b) => b.invitations).map((i) => ({ ...i }));
// Ids stay unique after a delete, which a count of the list would not.
let createdCount = invitations.length;

export async function listInvitations(companyId: string): Promise<Invitation[]> {
  return invitations.filter((i) => i.company_id === companyId);
}

// One invitation per address per company, as the database has it. A spent (accepted) one is
// cleared to make way, as the service does; one still waiting is refused with the service's words.
export async function createInvitation(input: { company_id: string; email: string; role: Role; title?: string | null; profile_id?: string | null }): Promise<Invitation> {
  const email = input.email.trim().toLowerCase();
  const existing = invitations.find((i) => i.company_id === input.company_id && i.email === email);
  if (existing && !existing.accepted_at) {
    throw new Error("There is already an invitation waiting for that address. Copy its link from the People page.");
  }
  if (existing) invitations.splice(invitations.indexOf(existing), 1);
  const created: Invitation = {
    id: `invite-${++createdCount}`,
    company_id: input.company_id,
    email,
    role: input.role,
    title: input.title?.trim() || null,
    profile_id: input.profile_id ?? null,
    invited_by: null,
    created_at: new Date().toISOString(),
    accepted_at: null,
  };
  invitations.unshift(created);
  return created;
}

export async function deleteInvitation(id: string): Promise<void> {
  const index = invitations.findIndex((i) => i.id === id);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  invitations.splice(index, 1);
}

export function inviteLink(email: string, origin = "http://localhost"): string {
  return `${origin}/?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}
