// The account half of the database's Rococo admin rule (private.is_rococo_admin, 0051), so the
// connections function honours a profile's Rococo flag only when the database would: the profile is
// active and flagged, and its address is also the signed-in account's address, confirmed. The other
// half, that the address is on the list, is read under the caller's own row level security, which
// lets a row through only when the database's own check passes. Kept pure so it is tested here.

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
