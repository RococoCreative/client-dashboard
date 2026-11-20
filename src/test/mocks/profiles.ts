// In-memory stand-in for services/profiles.ts, same exports, so page tests and `npm run demo`
// run against the seeded roster and never touch the network.
import type { Profile, Role } from "../../types/database.ts";
import { ALL_PROFILES, personaFromLocation } from "../fixtures.ts";
import type { ProfilePatch as RealProfilePatch } from "../../services/profiles.ts";

const profiles: Profile[] = ALL_PROFILES.map((p) => ({ ...p }));

// The company a person is placed with, read from this live store rather than the fixture
// snapshot, so the deliverables mock sees people added or moved during a demo session the way
// inherit_company_from_employee sees them in the database.
export function companyOf(profileId: string): string | null {
  return profiles.find((p) => p.id === profileId)?.company_id ?? null;
}

// A company's people, read live, for the mocks that walk who leads whom (mocks/gsrOnDemand.ts).
export function peopleOf(companyId: string): Profile[] {
  return profiles.filter((p) => p.company_id === companyId);
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
  division_ids?: string[];
  reports_to?: string | null;
}): Promise<Profile> {
  const divisionIds = [...(input.division_ids ?? [])];
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
    reports_to: input.reports_to ?? null,
    job_role_id: null,
    division_id: divisionIds.length === 1 ? divisionIds[0] : null,
    division_ids: divisionIds,
    can_view_divisions: false,
    view_all_divisions: false,
    view_division_ids: [],
    gsr_cadence: "monthly",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  profiles.push(created);
  return created;
}

// Same refusal as the service when nothing went: the person is gone already, or has signed in.
export async function deleteStaffProfile(id: string): Promise<void> {
  const index = profiles.findIndex((p) => p.id === id && p.user_id === null);
  if (index === -1) throw new Error("That person was not removed. They may have signed in, or they are not yours to remove.");
  profiles.splice(index, 1);
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

export type ProfilePatch = RealProfilePatch;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("Profile not found.");
  const next = { ...profiles[index], ...patch, updated_at: new Date().toISOString() };
  // division_id mirrors division_ids: the one division, or null for none or several (0038).
  if (patch.division_ids !== undefined) {
    next.division_ids = [...patch.division_ids];
    next.division_id = next.division_ids.length === 1 ? next.division_ids[0] : null;
  }
  if (patch.view_division_ids !== undefined) next.view_division_ids = [...patch.view_division_ids];
  // A move to another company leaves the divisions and every right to see them behind, as
  // guard_profile_division does (0035, 0038).
  if (patch.company_id !== undefined && patch.company_id !== profiles[index].company_id) {
    next.division_id = null;
    next.division_ids = [];
    next.can_view_divisions = false;
    next.view_all_divisions = false;
    next.view_division_ids = [];
  }
  profiles[index] = next;
  return profiles[index];
}
