// Sign-offs on SOPs (0053). A person signs off a published SOP for themselves; the database
// stamps the version, their name and the time, and closes their open tasks on that SOP. The
// person reads their own, admins read everyone's. Nobody changes or removes one.
import { db } from "./supabase.ts";
import type { SopSignoff } from "../types/database.ts";

const COLUMNS = "id, company_id, sop_id, profile_id, version, signer_name, signed_at";

// Everything this person has signed off in the company, newest first.
export async function listMySopSignoffs(companyId: string, profileId: string): Promise<SopSignoff[]> {
  const { data, error } = await db()
    .from("sop_signoffs")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .eq("profile_id", profileId)
    .order("signed_at", { ascending: false });
  if (error) throw error;
  return (data as SopSignoff[]) ?? [];
}

// Every sign-off on one SOP that the reader may see, newest first.
export async function listSopSignoffs(sopId: string): Promise<SopSignoff[]> {
  const { data, error } = await db()
    .from("sop_signoffs")
    .select(COLUMNS)
    .eq("sop_id", sopId)
    .order("signed_at", { ascending: false });
  if (error) throw error;
  return (data as SopSignoff[]) ?? [];
}

export async function signOffSop(sopId: string, profileId: string): Promise<SopSignoff> {
  const { data, error } = await db()
    .from("sop_signoffs")
    .insert({ sop_id: sopId, profile_id: profileId })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as SopSignoff;
}
