// A company's own SOP categories (0053). Members read them; admins add, rename, reorder, retire
// and delete. Deleting one leaves its SOPs Uncategorized (the database clears the link).
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";
import type { SopCategory } from "../types/database.ts";

const COLUMNS = "id, company_id, name, sort_order, retired_at, created_at";

export async function listSopCategories(companyId: string): Promise<SopCategory[]> {
  const { data, error } = await db()
    .from("sop_categories")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data as SopCategory[]) ?? [];
}

export async function createSopCategory(companyId: string, name: string, sortOrder = 0): Promise<SopCategory> {
  const { data, error } = await db()
    .from("sop_categories")
    .insert({ company_id: companyId, name: name.trim(), sort_order: sortOrder })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as SopCategory;
}

export async function updateSopCategory(
  id: string,
  patch: Partial<Pick<SopCategory, "name" | "sort_order" | "retired_at">>,
): Promise<SopCategory> {
  const { data, error } = await db().from("sop_categories").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as SopCategory;
}

export async function deleteSopCategory(id: string): Promise<void> {
  const { data, error } = await db().from("sop_categories").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}
