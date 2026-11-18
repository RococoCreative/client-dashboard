// A company's divisions (0035): the parts it splits into for reporting, such as a North and a
// South. Members read them and a full-scope admin writes them, by RLS (0038). The divisions a person
// works in are set through profiles.updateProfile (division_ids); who sees which is the view access
// on the profile.
import type { CompanyDivision } from "../types/database.ts";
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";

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

// Refused while anyone still works in it (0038); an empty one is also taken out of everyone's view
// access by the database. A delete that removed nothing is a refusal too.
export async function deleteDivision(id: string): Promise<void> {
  const { data, error } = await db().from("company_divisions").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}
