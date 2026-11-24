// A provider sign-in parked between the OAuth callback and the admin confirming it in the hub
// (connection_pending, 0052, read only by this function's service role). The callback mints a fresh
// random id for each one and never uses the state's nonce: the nonce sits readable in the state the
// starting admin holds, so keying on it would let that admin finish a connection whose link they
// forwarded to someone else. Only the browser that came back from the provider learns the id.
// Tokens and the account id are sealed under { pendingId }. Claiming a row deletes it as it reads
// it, so only one caller ever gets it. Expired rows are swept, and each swept grant is handed back
// to the provider, best effort. Every hand-back of a grant that never became a connection (swept,
// discarded, failed at finish or refused at the callback) goes through handBackPending, which keeps
// the grant when revoking it could cut off a live connection to the same outside account. Logs
// carry a short message and a code, never a value.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { blankToNull, pendingExpiry, shouldRevokePending } from "../_shared/connectFlow.ts";
import type { ProviderKey } from "../_shared/providers.ts";
import { decryptToken, loadTokenKeys, openTokens, sealTokens, tokenAad, type TokenKeys } from "../_shared/tokenCrypto.ts";
import { providerFor, revokeGrant, type Exchanged, type IssuedGrant, type ProviderDef } from "./oauth.ts";

export interface PendingRow {
  id: string;
  company_id: string;
  provider: ProviderKey;
  started_by: string;
  account_name: string | null;
  access_token: string;
  refresh_token: string | null;
  account_id: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  scopes: string | null;
  expires_at: string;
  created_at: string;
}

const PENDING_COLUMNS =
  "id, company_id, provider, started_by, account_name, access_token, refresh_token, account_id, access_expires_at, refresh_expires_at, scopes, expires_at, created_at";

// Parks an exchanged sign-in and answers its new id. Throws when it cannot be stored.
export async function parkPending(
  admin: SupabaseClient,
  input: { companyId: string; provider: ProviderKey; startedBy: string; exchanged: Exchanged },
  keys: TokenKeys,
  now: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const { exchanged } = input;
  const sealed = await sealTokens(
    { pendingId: id },
    { accessToken: exchanged.accessToken, refreshToken: blankToNull(exchanged.refreshToken), accountId: blankToNull(exchanged.externalAccountId) },
    keys,
  );
  const { error } = await admin.from("connection_pending").insert({
    id,
    company_id: input.companyId,
    provider: input.provider,
    started_by: input.startedBy,
    account_name: blankToNull(exchanged.externalAccountName),
    ...sealed,
    access_expires_at: exchanged.accessExpiresAt,
    refresh_expires_at: exchanged.refreshExpiresAt,
    scopes: exchanged.scopes,
    expires_at: pendingExpiry(now),
  });
  if (error) {
    console.error("pending park failed", error.code ?? "unknown");
    throw new Error("The sign-in could not be parked.");
  }
  return id;
}

export async function loadPending(admin: SupabaseClient, id: string): Promise<PendingRow | null> {
  const { data, error } = await admin.from("connection_pending").select(PENDING_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("pending read failed", error.code ?? "unknown");
    throw new Error("The pending connection could not be read.");
  }
  return (data as PendingRow | null) ?? null;
}

// Deletes the row and answers what it held, so two callers racing for one row never both get it.
export async function claimPending(admin: SupabaseClient, id: string): Promise<PendingRow | null> {
  const { data, error } = await admin.from("connection_pending").delete().eq("id", id).select(PENDING_COLUMNS).maybeSingle();
  if (error) {
    console.error("pending claim failed", error.code ?? "unknown");
    throw new Error("The pending connection could not be claimed.");
  }
  return (data as PendingRow | null) ?? null;
}

// The outside account ids held by every live connection (connected or in error) to this provider,
// in every company, since one outside account may be connected in more than one. An id that will
// not open reads as unknown (null). Throws when either read fails.
async function liveAccountIds(admin: SupabaseClient, provider: ProviderKey, keys: TokenKeys): Promise<Array<string | null>> {
  const { data: connections, error } = await admin.from("company_connections").select("id").eq("provider", provider).in("status", ["connected", "error"]);
  if (error) {
    console.error("live connections read failed", error.code ?? "unknown");
    throw new Error("Live connections could not be read.");
  }
  const ids = ((connections ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: held, error: heldError } = await admin.from("connection_tokens").select("connection_id, account_id").in("connection_id", ids);
  if (heldError) {
    console.error("live accounts read failed", heldError.code ?? "unknown");
    throw new Error("Live accounts could not be read.");
  }
  const out: Array<string | null> = [];
  for (const row of (held ?? []) as Array<{ connection_id: string; account_id: string | null }>) {
    if (row.account_id === null) {
      out.push(null);
      continue;
    }
    try {
      out.push(await decryptToken(row.account_id, tokenAad({ connectionId: row.connection_id }, "account_id"), keys));
    } catch {
      out.push(null);
    }
  }
  return out;
}

// Hands a grant that never became a connection back to its provider, but only when that cannot cut
// off a live connection: a provider keys a grant on its own terms (Google on client and user, Intuit
// on the company), so revoking a pending grant for an account a live connection also holds would end
// that connection too. The grant is kept, with an id-safe log line, when its account is unknown, when
// any live connection to the provider holds the same or an unknown account, or when the live
// connections cannot be read. True only when the provider confirmed the revoke. Never throws.
export async function handBackPending(admin: SupabaseClient, def: ProviderDef & { key: ProviderKey }, grant: IssuedGrant, keys: TokenKeys): Promise<boolean> {
  // A provider with no revoke (GoHighLevel) has nothing to hand back to.
  if (!def.revoke) return false;
  let live: Array<string | null>;
  try {
    live = await liveAccountIds(admin, def.key, keys);
  } catch {
    console.error("pending revoke skipped", def.key, "live connections unread");
    return false;
  }
  if (!shouldRevokePending(grant.accountId, live)) {
    console.error("pending revoke skipped", def.key, "account unknown or live elsewhere");
    return false;
  }
  return revokeGrant(def, grant);
}

// Deletes every row at or past its expiry, then hands each grant back to its provider, best effort,
// through handBackPending. Missing or unusable keys, or a provider without app keys, only skip the
// revoke. Answers how many rows went. Throws only when the delete itself fails.
export async function sweepExpiredPending(admin: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await admin.from("connection_pending").delete().lte("expires_at", now.toISOString()).select(PENDING_COLUMNS);
  if (error) {
    console.error("pending sweep failed", error.code ?? "unknown");
    throw new Error("Expired pending connections could not be swept.");
  }
  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) return 0;
  let keys: TokenKeys;
  try {
    keys = await loadTokenKeys((name) => Deno.env.get(name));
  } catch {
    return rows.length;
  }
  for (const row of rows) {
    try {
      const def = providerFor(row.provider);
      const opened = await openTokens({ pendingId: row.id }, row, keys);
      await handBackPending(admin, def, opened, keys);
    } catch (err) {
      console.error("pending sweep revoke skipped", row.provider, err instanceof Error ? err.name : "unknown");
    }
  }
  return rows.length;
}
