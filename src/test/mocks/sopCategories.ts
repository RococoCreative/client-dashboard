// In-memory stand-in for services/sopCategories.ts, same exports, seeded with each sample
// company's categories. Names are unique per company in any case, as the database's index holds.
import type { SopCategory } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";

const categories: SopCategory[] = fromAll((b) => b.sopCategories).map((x) => ({ ...x }));
let counter = 0;

function assertUnique(companyId: string, name: string, exceptId?: string): void {
  const key = name.trim().toLowerCase();
  if (categories.some((c) => c.company_id === companyId && c.id !== exceptId && c.name.toLowerCase() === key)) {
    throw new Error('duplicate key value violates unique constraint "sop_categories_company_name_key"');
  }
}

export async function listSopCategories(companyId: string): Promise<SopCategory[]> {
  return categories
    .filter((c) => c.company_id === companyId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((c) => ({ ...c }));
}
export async function createSopCategory(companyId: string, name: string, sortOrder = 0): Promise<SopCategory> {
  if (!name.trim()) throw new Error("A category needs a name.");
  assertUnique(companyId, name);
  const created: SopCategory = { id: `sop-category-new-${++counter}`, company_id: companyId, name: name.trim(), sort_order: sortOrder, retired_at: null, created_at: new Date().toISOString() };
  categories.push(created);
  return { ...created };
}
export async function updateSopCategory(id: string, patch: Partial<Pick<SopCategory, "name" | "sort_order" | "retired_at">>): Promise<SopCategory> {
  const found = categories.find((c) => c.id === id);
  if (!found) throw new Error(NOT_CHANGED_MESSAGE);
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("A category needs a name.");
    assertUnique(found.company_id, patch.name, id);
  }
  Object.assign(found, patch, patch.name !== undefined ? { name: patch.name.trim() } : {});
  return { ...found };
}
export async function deleteSopCategory(id: string): Promise<void> {
  const index = categories.findIndex((c) => c.id === id);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  categories.splice(index, 1);
}
