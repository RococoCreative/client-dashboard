import type { Profile } from "../../types/database.ts";
import { ALL_PROFILES, personaFromLocation } from "../fixtures.ts";

const profiles: Profile[] = ALL_PROFILES.map((p) => ({ ...p }));

export async function getMyProfile(): Promise<Profile | null> {
  const { profile } = personaFromLocation();
  return profiles.find((p) => p.id === profile.id) ?? profile;
}

export async function updateMyProfile(patch: { full_name?: string | null; title?: string | null }): Promise<Profile> {
  const me = (await getMyProfile())!;
  return updateProfile(me.id, patch);
}

export async function listCompanyProfiles(companyId: string): Promise<Profile[]> {
  return profiles.filter((p) => p.company_id === companyId);
}

export async function listAllProfiles(): Promise<Profile[]> {
  return [...profiles];
}

export type ProfilePatch = Partial<Pick<Profile, "full_name" | "title" | "role" | "is_active" | "company_id" | "is_rococo_admin">>;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("Profile not found.");
  profiles[index] = { ...profiles[index], ...patch, updated_at: new Date().toISOString() };
  return profiles[index];
}
