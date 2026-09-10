// Data layer for profiles. getMyProfile is what the app shell loads right after sign-in
// (it decides the role, the company, and therefore the theme and the nav). The list and
// update calls serve the People page and the Rococo section; RLS plus the
// guard_profile_fields trigger decide what each caller may actually change.
import { db } from "./supabase.ts";
import type { Profile } from "../types/database.ts";

const COLUMNS =
  "id, email, full_name, title, company_id, role, is_rococo_admin, is_active, hire_date, phone, department, reports_to, created_at, updated_at";

export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await db().auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await db().from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function updateMyProfile(patch: { full_name?: string | null; title?: string | null; phone?: string | null }): Promise<Profile> {
  const { data: userData, error: userError } = await db().auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in.");
  const { data, error } = await db().from("profiles").update(patch).eq("id", userId).select(COLUMNS).single();
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
