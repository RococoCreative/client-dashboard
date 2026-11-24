// A provider sign-in parked between the OAuth callback and the admin confirming it in the hub
// (connection_pending, 0052, read only by this function's service role). The callback mints a fresh
// random id for each one and never uses the state's nonce: the nonce sits readable in the state the
// starting admin holds, so keying on it would let that admin finish a connection whose link they
// forwarded to someone else. Only the browser that came back from the provider learns the id.
// Tokens and the account id are sealed under { pendingId }. Claiming a row deletes it as it reads
// it, so only one caller ever gets it. Expired rows are swept, and each swept grant is handed back
// to the provider, best effort. Logs carry a short message and a code, never a value.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { blankToNull, pendingExpiry } from "../_shared/connectFlow.ts";
import type { ProviderKey } from "../_shared/providers.ts";
import { loadTokenKeys, openTokens, sealTokens, type TokenKeys } from "../_shared/tokenCrypto.ts";
import { providerFor, revokeGrant, type Exchanged } from "./oauth.ts";

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

// Deletes every row at or past its expiry, then hands each grant back to its provider, best effort.
// Missing or unusable keys, or a provider without app keys, only skip the revoke. Answers how many
// rows went. Throws only when the delete itself fails.
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
      await revokeGrant(def, opened);
    } catch (err) {
      console.error("pending sweep revoke skipped", row.provider, err instanceof Error ? err.name : "unknown");
    }
  }
  return rows.length;
}
