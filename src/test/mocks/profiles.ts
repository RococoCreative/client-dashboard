// In-memory stand-in for services/profiles.ts, same exports, so page tests and `npm run demo`
// run against the seeded roster and never touch the network.
//
// A person's GSR rhythm (gsr_cadence) is refused as the database refuses it (guard_profile_fields
// and the policy "Leaders set the GSR rhythm of the people they lead", 0047), acting as personaIn
// in fixtures.ts, as mocks/gsrOnDemand.ts does. Every other field is taken as given.
//
// Deleting a person who has signed in (deletePerson, 0049) is refused as the delete policy and
// guard_profile_delete refuse it, with the same words, and then cascades: every mock that keeps
// rows of a person registers with onPersonDeleted and drops or blanks them, as the foreign keys do.
import type { Profile, Role } from "../../types/database.ts";
import { ROLE_RANK, isCompanyAdminRole, ledBy } from "../../lib/people.ts";
import { ALL_PROFILES, personaFromLocation, personaIn } from "../fixtures.ts";
import type { ProfilePatch as RealProfilePatch } from "../../services/profiles.ts";
import { gsrModeOf } from "./companies.ts";

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
  forgetPerson(id);
}

export const PERSON_NOT_DELETED = "That person was not deleted. They may be gone already, or they are not yours to delete.";

// The mocks holding a person's rows, each dropping or blanking them as the foreign keys do.
const forgetters: Array<(profileId: string) => void> = [];

export function onPersonDeleted(forget: (profileId: string) => void): void {
  forgetters.push(forget);
}

function forgetPerson(profileId: string): void {
  for (const forget of forgetters) forget(profileId);
  for (const p of profiles) if (p.reports_to === profileId) p.reports_to = null;
}

// The delete policy (an admin of the company over the people they manage, or Rococo) and then the
// guard, in the order 0049 checks them. Only a person in the company named is reached, as the
// service filters by it.
export async function deletePerson(companyId: string, profileId: string): Promise<void> {
  const index = profiles.findIndex((p) => p.id === profileId && p.company_id === companyId);
  if (index === -1) throw new Error(PERSON_NOT_DELETED);
  const target = profiles[index];
  const me = personaIn(companyId);
  const manages =
    me.is_rococo_admin ||
    (isCompanyAdminRole(me.role) && me.company_id === companyId && ledBy(me, peopleOf(companyId)).some((p) => p.id === target.id));
  if (!manages) throw new Error(PERSON_NOT_DELETED);
  if (target.user_id === null) {
    if (!me.is_rococo_admin && ROLE_RANK[target.role] > ROLE_RANK[me.role]) throw new Error("You cannot remove someone ranked above you.");
  } else {
    if (target.id === me.id) throw new Error("You cannot delete yourself.");
    if (target.is_rococo_admin && !me.is_rococo_admin) throw new Error("A Rococo admin is removed by Rococo.");
    if (!me.is_rococo_admin && ROLE_RANK[target.role] > ROLE_RANK[me.role]) throw new Error("You cannot delete someone ranked above you.");
    const otherOwner = profiles.some((p) => p.company_id === companyId && p.id !== target.id && p.role === "owner" && p.is_active);
    if (target.role === "owner" && target.is_active && !otherOwner) throw new Error("This is the company's only owner. Make someone else an owner first.");
  }
  profiles.splice(index, 1);
  forgetPerson(profileId);
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

// Test helper, not a service function: the database writes a profile's Rococo flag only from the
// Rococo admin list's sync (0051), so a test that needs a flagged person sets it here.
export function setMockRococoFlag(id: string, value: boolean): void {
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("Profile not found.");
  profiles[index] = { ...profiles[index], is_rococo_admin: value };
}

// The Rococo admin list's sync, for mocks/rococoAdmins.ts: the profile at an added address is
// flagged and turned on, at a removed one cleared and turned off (0051). No profile, no change.
export function syncMockRococoAccess(email: string, on: boolean): void {
  const index = profiles.findIndex((p) => p.email.toLowerCase() === email);
  if (index === -1) return;
  profiles[index] = { ...profiles[index], is_rococo_admin: on, is_active: on };
}

// What the client says when no policy lets the update reach the row: .single() finds nothing.
const NO_ROW = "JSON object requested, multiple (or no) rows returned";

// A change of rhythm, as 0047 holds it: Rococo and an admin of the company set anyone's; someone who
// leads the person sets it in a company on demand and changes nothing else; the person themself is
// refused by the guard, and anyone else reaches no row.
function guardRhythm(target: Profile, patch: ProfilePatch): void {
  if (patch.gsr_cadence === undefined || patch.gsr_cadence === target.gsr_cadence || !target.company_id) return;
  const me = personaIn(target.company_id);
  if (me.is_rococo_admin) return;
  if (me.company_id !== target.company_id) throw new Error(NO_ROW);
  if (isCompanyAdminRole(me.role)) return;
  const leads = me.id !== target.id && ledBy(me, peopleOf(target.company_id)).some((p) => p.id === target.id);
  if (leads && gsrModeOf(target.company_id) === "on_demand") {
    const others = (Object.keys(patch) as Array<keyof ProfilePatch>).filter((key) => key !== "gsr_cadence" && patch[key] !== target[key]);
    if (others.length > 0) throw new Error("A manager can change only the GSR rhythm of the people they lead.");
    return;
  }
  if (me.id === target.id) throw new Error("Only admins can change employment details.");
  throw new Error(NO_ROW);
}

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("Profile not found.");
  guardRhythm(profiles[index], patch);
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
