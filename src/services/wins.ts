// Wins the company records by hand. Members read them and admins write them, by RLS (0027);
// nothing is deleted, only archived. The database forces every browser write to manual, so this
// service never sends source_type or source_ref.
import type { Win } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, title, description, won_on, project_id, source_type, source_ref, archived_at, created_by, updated_by, created_at, updated_at";

// Newest first: by the date won, then by when it was entered.
export async function listWins(companyId: string, opts?: { includeArchived?: boolean; limit?: number }): Promise<Win[]> {
  let query = db().from("wins").select(COLUMNS).eq("company_id", companyId);
  if (!opts?.includeArchived) query = query.is("archived_at", null);
  query = query.order("won_on", { ascending: false }).order("created_at", { ascending: false });
  if (opts?.limit !== undefined) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data as Win[]) ?? [];
}

export async function createWin(input: { company_id: string; title: string; won_on: string; description?: string | null; project_id?: string | null }): Promise<Win> {
  const { data, error } = await db().from("wins").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as Win;
}

export type WinPatch = Partial<Pick<Win, "title" | "description" | "won_on" | "project_id">>;
export async function updateWin(id: string, patch: WinPatch): Promise<Win> {
  const { data, error } = await db().from("wins").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as Win;
}

export async function archiveWin(id: string): Promise<Win> {
  const { data, error } = await db().from("wins").update({ archived_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as Win;
}
