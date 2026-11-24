// The database's Rococo admin rule (private.is_rococo_admin, 0051) for the edge functions, so the
// connections and notify functions honour a profile's Rococo flag only when the database would: the
// profile is active and flagged, its address is also the signed-in account's address, confirmed,
// and that address is on the list. The account half is pure; the list is read by the caller's
// lookup, under the caller's own row level security, which lets a row through only when the
// database's own check passes. Kept free of any client so both halves are tested here.

export interface RococoProfile {
  is_active: unknown;
  is_rococo_admin: unknown;
  email: unknown;
}

export interface SignedInAccount {
  email: string | null;
  emailConfirmed: boolean;
}

export function rococoAccountMatches(profile: RococoProfile, account: SignedInAccount): boolean {
  if (profile.is_active !== true || profile.is_rococo_admin !== true || account.emailConfirmed !== true) return false;
  if (typeof profile.email !== "string" || !profile.email || !account.email) return false;
  return profile.email.toLowerCase() === account.email.toLowerCase();
}

// Says whether the address is on the Rococo list. Given the address lowercased.
export type RococoListLookup = (email: string) => Promise<boolean>;

// The whole rule. The list is asked only once the account half holds, and a lookup that fails reads
// as no, so any doubt keeps the flag from counting.
export async function isRococoAdmin(profile: RococoProfile, account: SignedInAccount, onList: RococoListLookup): Promise<boolean> {
  if (!rococoAccountMatches(profile, account)) return false;
  try {
    return (await onList((profile.email as string).toLowerCase())) === true;
  } catch {
    return false;
  }
}
