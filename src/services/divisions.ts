// A company's divisions (0035): the parts it splits into for reporting, such as a North and a
// South. Members read them and admins write them, by RLS. A person's division is set through
// profiles.updateProfile (division_id); who sees the split is can_view_divisions on the profile.
import type { CompanyDivision } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, name, sort_order, created_at, updated_at";

export async function listDivisions(companyId: string): Promise<CompanyDivision[]> {
  const { data, error } = await db().from("company_divisions").select(COLUMNS).eq("company_id", companyId).order("sort_order").order("name");
  if (error) throw error;
  return (data as CompanyDivision[]) ?? [];
}

export async function createDivision(input: { company_id: string; name: string; sort_order?: number }): Promise<CompanyDivision> {
  const { data, error } = await db()
    .from("company_divisions")
    .insert({ ...input, name: input.name.trim() })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as CompanyDivision;
}

export async function updateDivision(id: string, patch: Partial<Pick<CompanyDivision, "name" | "sort_order">>): Promise<CompanyDivision> {
  const clean = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() };
  const { data, error } = await db().from("company_divisions").update(clean).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as CompanyDivision;
}

// The people in it are left with no division (the foreign key clears it).
export async function deleteDivision(id: string): Promise<void> {
  const { error } = await db().from("company_divisions").delete().eq("id", id);
  if (error) throw error;
}
