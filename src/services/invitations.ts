// Data layer for invitations. An invitation is a row: creating it is what lets the address past
// the signup gate. Its email now goes out through the notify Edge Function (emailInvitation), which
// holds the Resend key; the browser never sends mail and never holds that key. The sign-in link
// (inviteLink) stays as a fallback the admin can copy and pass on when an email does not go. When
// the person signs in, handle_new_user claims the unclaimed roster profile at that address (an
// invitation's profile_id only ranks which invitation is settled, never picks the row), stamps
// accepted_at, and withdraws other companies' pending invitations for the address.
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";
import { appOrigin } from "../lib/appUrl.ts";
import { invokeFunction } from "./invoke.ts";
import type { Invitation, Role } from "../types/database.ts";

const COLUMNS = "id, company_id, email, role, title, profile_id, invited_by, created_at, accepted_at";

export async function listInvitations(companyId: string): Promise<Invitation[]> {
  const { data, error } = await db()
    .from("invitations")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Invitation[]) ?? [];
}

// One invitation per address per company (0001). A spent one, accepted when the person signed in
// before, is history once they are back on the roster unclaimed (removed and added again, say), so
// it is cleared and the new invitation takes its place. One still waiting is the invitation to
// use: its link is already on the People page.
const INVITATION_WAITING_MESSAGE = "There is already an invitation waiting for that address. Copy its link from the People page.";

export async function createInvitation(input: {
  company_id: string;
  email: string;
  role: Role;
  title?: string | null;
  profile_id?: string | null;
}): Promise<Invitation> {
  const row = { ...input, email: input.email.trim().toLowerCase(), title: input.title?.trim() || null };
  const insert = () => db().from("invitations").insert(row).select(COLUMNS).single();
  const first = await insert();
  if (!first.error) return first.data as Invitation;
  if (first.error.code !== "23505") throw first.error;
  const { data: existing, error: lookupError } = await db()
    .from("invitations")
    .select(COLUMNS)
    .eq("company_id", row.company_id)
    .eq("email", row.email)
    .maybeSingle();
  if (lookupError) throw lookupError;
  const spent = existing as Invitation | null;
  if (!spent) throw first.error;
  if (!spent.accepted_at) throw new Error(INVITATION_WAITING_MESSAGE);
  const { data: cleared, error: clearError } = await db()
    .from("invitations")
    .delete()
    .eq("id", spent.id)
    .not("accepted_at", "is", null)
    .select("id");
  if (clearError) throw clearError;
  requireRows(cleared);
  const second = await insert();
  if (second.error) throw second.error;
  return second.data as Invitation;
}

export async function deleteInvitation(id: string): Promise<void> {
  const { data, error } = await db().from("invitations").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}

// Asks the notify function to email the invitation. It decides who may have it sent and refuses an
// invitation already accepted, answering { sent: false, reason }; anything that stops the send
// throws with the function's own line. Pressing it again resends: there is no claim to spend.
export async function emailInvitation(invitationId: string): Promise<{ sent: boolean; reason?: string }> {
  return invokeFunction<{ sent: boolean; reason?: string }>("notify", { invitation_id: invitationId });
}

// The login screen reads ?email= and pre-fills the field, so this link is all a new
// person needs. It always carries the production domain (appOrigin), whatever host the
// admin copied it from.
export function inviteLink(email: string, origin = appOrigin()): string {
  return `${origin}/?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}
