// In-memory stand-in for services/rococoAdmins.ts, same exports, for page tests and the demo. It
// keeps the Rococo admin list as 0051 does: addresses trimmed and lowercased, only Rococo's domain,
// no duplicates, the last entry kept, your own entry not removable, and the profile at an address
// turned on when it is added and off when it is removed. Each entry is joined to the live profiles
// store for its name. resetMockRococoAdmins is a test-only extra; src/test/setup.ts resets after
// every test.
import type { RococoAdmin, RococoAdminEntry } from "../../types/database.ts";
import { isRococoEmail, isValidEmail, normalizeEmail } from "../../lib/email.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { actingPerson } from "../actingPerson.ts";
import { listAllProfiles, syncMockRococoAccess } from "./profiles.ts";

const SEED: RococoAdmin[] = [
  { id: "rococo-admin-1", email: "austin@rocococreative.io", added_by: null, added_at: "2026-01-05T15:00:00.000Z" },
  { id: "rococo-admin-2", email: "sample.staff@rocococreative.io", added_by: "rococo-user-1", added_at: "2026-03-10T15:00:00.000Z" },
];

let admins: RococoAdmin[] = SEED.map((a) => ({ ...a }));
let nextId = 3;

export function resetMockRococoAdmins(): void {
  admins = SEED.map((a) => ({ ...a }));
  nextId = 3;
}

export async function listRococoAdmins(): Promise<RococoAdminEntry[]> {
  const people = await listAllProfiles();
  return [...admins]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((admin) => {
      const person = people.find((p) => normalizeEmail(p.email) === admin.email);
      return { ...admin, name: person?.full_name ?? null, profile_id: person?.id ?? null };
    });
}

export async function addRococoAdmin(email: string): Promise<RococoAdmin> {
  const address = normalizeEmail(email);
  if (!isValidEmail(address) || !isRococoEmail(address)) throw new Error("Use a rocococreative.io address.");
  if (admins.some((a) => a.email === address)) throw new Error("That already exists.");
  const added: RococoAdmin = {
    id: `rococo-admin-${nextId++}`,
    email: address,
    added_by: actingPerson()?.id ?? null,
    added_at: new Date().toISOString(),
  };
  admins.push(added);
  syncMockRococoAccess(address, true);
  return { ...added };
}

export async function removeRococoAdmin(id: string): Promise<void> {
  const entry = admins.find((a) => a.id === id);
  if (!entry) throw new Error(NOT_CHANGED_MESSAGE);
  if (admins.length === 1) throw new Error("The last Rococo admin cannot be removed.");
  const me = actingPerson();
  if (me && normalizeEmail(me.email) === entry.email) throw new Error("A Rococo admin's profile can only be changed by Rococo.");
  admins = admins.filter((a) => a.id !== id);
  syncMockRococoAccess(entry.email, false);
}
