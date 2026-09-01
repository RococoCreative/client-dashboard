// Data layer for invitations. An invitation is a row, not an email: no server here holds
// the service-role key that Supabase's invite mailer needs, so the admin sends the person
// the sign-in link (inviteLink) and the signup gate lets that address through. When the
// person signs in, handle_new_user places them and stamps accepted_at.
import { db } from "./supabase.ts";
import type { Invitation, Role } from "../types/database.ts";

const COLUMNS = "id, company_id, email, role, title, invited_by, created_at, accepted_at";

export async function listInvitations(companyId: string): Promise<Invitation[]> {
  const { data, error } = await db()
    .from("invitations")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Invitation[]) ?? [];
}

export async function createInvitation(input: {
  company_id: string;
  email: string;
  role: Role;
  title?: string | null;
}): Promise<Invitation> {
  const { data, error } = await db()
    .from("invitations")
    .insert({ ...input, email: input.email.trim().toLowerCase(), title: input.title?.trim() || null })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as Invitation;
}

export async function deleteInvitation(id: string): Promise<void> {
  const { error } = await db().from("invitations").delete().eq("id", id);
  if (error) throw error;
}

// The login screen reads ?email= and pre-fills the field, so this link is all a new
// person needs.
export function inviteLink(email: string, origin = window.location.origin): string {
  return `${origin}/?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}
