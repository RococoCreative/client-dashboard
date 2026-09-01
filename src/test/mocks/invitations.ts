import type { Invitation, Role } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const invitations: Invitation[] = fromAll((b) => b.invitations).map((i) => ({ ...i }));

export async function listInvitations(companyId: string): Promise<Invitation[]> {
  return invitations.filter((i) => i.company_id === companyId);
}

export async function createInvitation(input: { company_id: string; email: string; role: Role; title?: string | null }): Promise<Invitation> {
  const created: Invitation = {
    id: `invite-${invitations.length + 1}`,
    company_id: input.company_id,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    title: input.title?.trim() || null,
    invited_by: null,
    created_at: new Date().toISOString(),
    accepted_at: null,
  };
  invitations.unshift(created);
  return created;
}

export async function deleteInvitation(id: string): Promise<void> {
  const index = invitations.findIndex((i) => i.id === id);
  if (index !== -1) invitations.splice(index, 1);
}

export function inviteLink(email: string, origin = "http://localhost"): string {
  return `${origin}/?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}
