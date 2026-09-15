// Data layer for profiles. A profile is a person on a company's roster, which is not the same
// thing as an account: an admin can set someone up in full and invite them later, so user_id is
// null until they first sign in. getMyProfile is what the app shell loads right after sign-in
// (it decides the role, the company, and therefore the theme and the nav), and it looks the
// person up by their account. The list and update calls serve the People page and the Rococo
// section; RLS plus the guard_profile_fields trigger decide what each caller may actually
// change, and only handle_new_user ever sets user_id.
import { db } from "./supabase.ts";
import type { Profile, Role } from "../types/database.ts";

const COLUMNS =
  "id, user_id, email, full_name, title, company_id, role, is_rococo_admin, is_active, hire_date, phone, department, reports_to, created_at, updated_at";

export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await db().auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await db().from("profiles").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function updateMyProfile(patch: { full_name?: string | null; title?: string | null; phone?: string | null }): Promise<Profile> {
  const { data: userData, error: userError } = await db().auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in.");
  const { data, error } = await db().from("profiles").update(patch).eq("user_id", userId).select(COLUMNS).single();
  if (error) throw error;
  return data as Profile;
}

export async function listCompanyProfiles(companyId: string): Promise<Profile[]> {
  const { data, error } = await db()
    .from("profiles")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });
  if (error) throw error;
  return (data as Profile[]) ?? [];
}

// Rococo admins only (RLS returns just the caller's company for anyone else).
export async function listAllProfiles(): Promise<Profile[]> {
  const { data, error } = await db()
    .from("profiles")
    .select(COLUMNS)
    .order("company_id", { ascending: true, nullsFirst: true })
    .order("email", { ascending: true });
  if (error) throw error;
  return (data as Profile[]) ?? [];
}

export type ProfilePatch = Partial<
  Pick<Profile, "full_name" | "title" | "role" | "is_active" | "company_id" | "is_rococo_admin" | "hire_date" | "phone" | "department" | "reports_to">
>;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const { data, error } = await db().from("profiles").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as Profile;
}


// Put someone on the roster before they have an account. They can be filled in completely
// (title, department, hire date, who they report to, compensation, KPIs) and invited whenever
// the company is ready. RLS pins the company and forbids setting user_id here.
export async function createStaffProfile(input: {
  company_id: string;
  email: string;
  full_name?: string | null;
  title?: string | null;
  role?: Role;
}): Promise<Profile> {
  const { data, error } = await db()
    .from("profiles")
    .insert({
      company_id: input.company_id,
      email: input.email.trim().toLowerCase(),
      full_name: input.full_name?.trim() || null,
      title: input.title?.trim() || null,
      role: input.role ?? "employee",
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as Profile;
}

// Only for someone who never signed in; RLS refuses the rest. Anyone with an account is
// deactivated instead, which keeps their reviews and goals intact.
export async function deleteStaffProfile(id: string): Promise<void> {
  const { error } = await db().from("profiles").delete().eq("id", id);
  if (error) throw error;
}
