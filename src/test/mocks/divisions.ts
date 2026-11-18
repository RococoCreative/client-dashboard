// The divisions service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/divisions.ts. A division someone still works in is refused, as the database refuses
// it (0038); deleting an empty one strips it from everyone's view access, through the profiles mock.
import type { CompanyDivision } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { listAllProfiles, updateProfile } from "./profiles.ts";

const divisions = fromAll((b) => b.divisions).map((x) => ({ ...x }));

let counter = 0;
const nextId = () => `division-new-${++counter}`;
const now = () => new Date().toISOString();

export async function listDivisions(companyId: string): Promise<CompanyDivision[]> {
  return divisions
    .filter((d) => d.company_id === companyId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((d) => ({ ...d }));
}

export async function createDivision(input: { company_id: string; name: string; sort_order?: number }): Promise<CompanyDivision> {
  const name = input.name.trim();
  if (!name) throw new Error('new row for relation "company_divisions" violates check constraint "company_divisions_name_check"');
  if (divisions.some((d) => d.company_id === input.company_id && d.name === name)) {
    throw new Error('duplicate key value violates unique constraint "company_divisions_name_key"');
  }
  const created: CompanyDivision = { id: nextId(), company_id: input.company_id, name, sort_order: input.sort_order ?? 0, created_at: now(), updated_at: now() };
  divisions.push(created);
  return { ...created };
}

export async function updateDivision(id: string, patch: Partial<Pick<CompanyDivision, "name" | "sort_order">>): Promise<CompanyDivision> {
  const division = divisions.find((d) => d.id === id);
  if (!division) throw new Error("That is not here any more, or it is not yours to open.");
  const name = patch.name === undefined ? division.name : patch.name.trim();
  if (divisions.some((d) => d.id !== id && d.company_id === division.company_id && d.name === name)) {
    throw new Error('duplicate key value violates unique constraint "company_divisions_name_key"');
  }
  Object.assign(division, patch, { name, updated_at: now() });
  return { ...division };
}

export async function deleteDivision(id: string): Promise<void> {
  const index = divisions.findIndex((d) => d.id === id);
  if (index === -1) throw new Error("That is not here any more, or it is not yours to change.");
  const everyone = await listAllProfiles();
  const members = everyone.filter((p) => p.division_ids.includes(id)).length;
  if (members > 0) {
    throw new Error(`Move the ${members === 1 ? "1 person" : `${members} people`} out of ${divisions[index].name} first.`);
  }
  divisions.splice(index, 1);
  for (const person of everyone.filter((p) => p.view_division_ids.includes(id))) {
    await updateProfile(person.id, { view_division_ids: person.view_division_ids.filter((d) => d !== id) });
  }
}
