// Sign-in data layer. Two anonymous lookups power the login screen (which company does
// this email belong to, and which companies exist), then the magic link itself. Account
// creation is allowed (shouldCreateUser: true) because the server-side signup gate in
// supabase/migrations/0002_signup_gate.sql decides who may actually get in.
import { db } from "./supabase.ts";
import type { PublicCompany } from "../types/database.ts";

export async function lookupCompanyForEmail(email: string): Promise<PublicCompany | null> {
  const { data, error } = await db().rpc("lookup_company_for_email", { p_email: email });
  if (error) throw error;
  const rows = (data ?? []) as PublicCompany[];
  return rows[0] ?? null;
}

export async function listPublicCompanies(): Promise<PublicCompany[]> {
  const { data, error } = await db().rpc("list_companies_public");
  if (error) throw error;
  return (data ?? []) as PublicCompany[];
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await db().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}
