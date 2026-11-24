// The Rococo admin list (0051): the addresses that open every company. Only Rococo admins read, add
// or remove entries, by RLS. The database stamps who added an entry and when, lowercases the
// address, keeps the last entry, and syncs the profile at that address: added turns it on as a
// Rococo admin, removed turns it off.
import type { RococoAdmin, RococoAdminEntry } from "../types/database.ts";
import { db } from "./supabase.ts";
import { isRococoEmail, isValidEmail, normalizeEmail } from "../lib/email.ts";
import { requireRows } from "../lib/errors.ts";

const COLUMNS = "id, email, added_by, added_at";

const NOT_ROCOCO_MESSAGE = "Use a rocococreative.io address.";

// The list by address, each entry with the person at that address when there is one. A listed
// address nobody has been set up with yet reads with no name and no profile.
export async function listRococoAdmins(): Promise<RococoAdminEntry[]> {
  const { data, error } = await db().from("rococo_admins").select(COLUMNS).order("email");
  if (error) throw error;
  const admins = (data as RococoAdmin[]) ?? [];
  if (admins.length === 0) return [];
  const { data: people, error: peopleError } = await db()
    .from("profiles")
    .select("id, email, full_name")
    .in("email", admins.map((a) => a.email));
  if (peopleError) throw peopleError;
  const byEmail = new Map(
    ((people as Array<{ id: string; email: string; full_name: string | null }>) ?? []).map((p) => [normalizeEmail(p.email), p]),
  );
  return admins.map((admin) => {
    const person = byEmail.get(admin.email);
    return { ...admin, name: person?.full_name ?? null, profile_id: person?.id ?? null };
  });
}

// The address is trimmed and lowercased, and anything off Rococo's domain is refused before the
// database is asked. The database holds the same rule.
export async function addRococoAdmin(email: string): Promise<RococoAdmin> {
  const address = normalizeEmail(email);
  if (!isValidEmail(address) || !isRococoEmail(address)) throw new Error(NOT_ROCOCO_MESSAGE);
  const { data, error } = await db().from("rococo_admins").insert({ email: address }).select(COLUMNS).single();
  if (error) throw error;
  return data as RococoAdmin;
}

// Asks for the id back, so a removal RLS filtered out reads as a refusal. The database refuses
// removing the last entry, and removing your own.
export async function removeRococoAdmin(id: string): Promise<void> {
  const { data, error } = await db().from("rococo_admins").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}
