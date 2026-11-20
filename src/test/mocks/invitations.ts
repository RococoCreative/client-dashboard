// In-memory stand-in for services/invitations.ts, same exports, so page tests and `npm run demo`
// run against seeded invitation rows and never touch the network. The invitation email is
// recorded, not sent: emailInvitation answers { sent: true } unless a test tells it to fail or to
// answer with a reason (setMockInvitationEmail), and every call lands in invitationEmailCalls. Like
// the notify function it refuses an accepted invitation, and a second email to one invitation
// within 10 minutes, stamping last_emailed_at only when an email goes.
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
    last_emailed_at: null,
  };
  invitations.unshift(created);
  return created;
}

export async function deleteInvitation(id: string): Promise<void> {
  const index = invitations.findIndex((i) => i.id === id);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  invitations.splice(index, 1);
}

// What the next emailInvitation calls answer: sent, refused with a reason, or a thrown error.
type EmailOutcome = { kind: "sent" } | { kind: "reason"; reason: string } | { kind: "fail"; message: string };
let emailOutcome: EmailOutcome = { kind: "sent" };
export const invitationEmailCalls: string[] = [];

export function setMockInvitationEmail(outcome: EmailOutcome): void {
  emailOutcome = outcome;
}

// Also forgets every send time, so the 10 minute pause never carries from one test to the next.
export function resetMockInvitationEmail(): void {
  emailOutcome = { kind: "sent" };
  invitationEmailCalls.length = 0;
  for (const invitation of invitations) invitation.last_emailed_at = null;
}

const RESEND_PAUSE_MS = 10 * 60 * 1000;

export async function emailInvitation(invitationId: string): Promise<{ sent: boolean; reason?: string }> {
  invitationEmailCalls.push(invitationId);
  const invitation = invitations.find((i) => i.id === invitationId);
  if (!invitation) throw new Error("That invitation was not found.");
  if (invitation.accepted_at) return { sent: false, reason: "They have already signed in." };
  if (invitation.last_emailed_at && Date.now() - new Date(invitation.last_emailed_at).getTime() < RESEND_PAUSE_MS) {
    return { sent: false, reason: "An invitation email went to them in the last 10 minutes. Try again later." };
  }
  if (emailOutcome.kind === "fail") throw new Error(emailOutcome.message);
  if (emailOutcome.kind === "reason") return { sent: false, reason: emailOutcome.reason };
  invitation.last_emailed_at = new Date().toISOString();
  return { sent: true };
}

export function inviteLink(email: string, origin = "http://localhost"): string {
  return `${origin}/?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}
