import type { Profile, Role } from "../../types/database.ts";
import { ALL_PROFILES, personaFromLocation } from "../fixtures.ts";

const profiles: Profile[] = ALL_PROFILES.map((p) => ({ ...p }));

// The company a person is placed with, read from this live store rather than the fixture
// snapshot, so the deliverables mock sees people added or moved during a demo session the way
// inherit_company_from_employee sees them in the database.
export function companyOf(profileId: string): string | null {
  return profiles.find((p) => p.id === profileId)?.company_id ?? null;
}

export async function getMyProfile(): Promise<Profile | null> {
  const { profile } = personaFromLocation();
  return profiles.find((p) => p.id === profile.id) ?? profile;
}

export async function createStaffProfile(input: {
  company_id: string;
  email: string;
  full_name?: string | null;
  title?: string | null;
  role?: Role;
}): Promise<Profile> {
  const created: Profile = {
    id: `staff-new-${profiles.length + 1}`,
    user_id: null,
    email: input.email.trim().toLowerCase(),
    full_name: input.full_name?.trim() || null,
    title: input.title?.trim() || null,
    company_id: input.company_id,
    role: input.role ?? "employee",
    is_rococo_admin: false,
    is_active: true,
    hire_date: null,
    phone: null,
    department: null,
    reports_to: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  profiles.push(created);
  return created;
}

export async function deleteStaffProfile(id: string): Promise<void> {
  const index = profiles.findIndex((p) => p.id === id);
  if (index !== -1) profiles.splice(index, 1);
}

export async function updateMyProfile(patch: { full_name?: string | null; title?: string | null; phone?: string | null }): Promise<Profile> {
  const me = (await getMyProfile())!;
  return updateProfile(me.id, patch);
}

export async function listCompanyProfiles(companyId: string): Promise<Profile[]> {
  return profiles.filter((p) => p.company_id === companyId);
}

export async function listAllProfiles(): Promise<Profile[]> {
  return [...profiles];
}

export type ProfilePatch = Partial<Pick<Profile, "full_name" | "title" | "role" | "is_active" | "company_id" | "is_rococo_admin" | "hire_date" | "phone" | "department" | "reports_to">>;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("Profile not found.");
  profiles[index] = { ...profiles[index], ...patch, updated_at: new Date().toISOString() };
  return profiles[index];
}
