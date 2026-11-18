// The company directory (profile_directory, 0038): every member's name, title and whether they are
// active, readable by everyone in the company. Screens that name someone who is not the subject of
// the page (who assigned a task, who owns a milestone) read names here, because profiles is
// narrowed by RLS to the people the viewer may see. Pickers for assigning work stay on profiles.
import type { DirectoryEntry } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, full_name, title, is_active";

export async function listDirectory(companyId: string): Promise<DirectoryEntry[]> {
  const { data, error } = await db()
    .from("profile_directory")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("full_name", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data as DirectoryEntry[]) ?? [];
}
