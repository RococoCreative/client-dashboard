// In-memory stand-in for services/directory.ts, same exports. Built from the live profiles mock,
// so someone added or renamed during a test or a demo appears here the way the trigger keeps
// profile_directory in step. Company members only, and nothing beyond the directory's columns.
// Read through listAllProfiles, so a test that narrows listCompanyProfiles to stand in for RLS
// leaves the directory whole, as the database does.
import type { DirectoryEntry } from "../../types/database.ts";
import { listAllProfiles } from "./profiles.ts";

export async function listDirectory(companyId: string): Promise<DirectoryEntry[]> {
  const people = await listAllProfiles();
  return people
    .filter((p) => p.company_id === companyId && !p.is_rococo_admin)
    .map(({ id, company_id, full_name, title, is_active }) => ({ id, company_id: company_id ?? companyId, full_name, title, is_active }))
    .sort((a, b) => (a.full_name === null ? 1 : b.full_name === null ? -1 : a.full_name.localeCompare(b.full_name)));
}
