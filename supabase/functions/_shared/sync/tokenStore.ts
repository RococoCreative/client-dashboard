// The sealing half of the token store a sync reads its sign-in through. A load opens the stored row
// and remembers the account id it held and when the row was last written; every save seals the
// access token, the refresh token and that account id again under the current key, so a key
// rotation moves the whole row on its next refresh and nothing is left that only the previous key
// can open. A save lands only on the row its load read (a compare-and-swap on updated_at): a
// reconnect or a disconnect that wrote the row in between wins, the save writes nothing, and the
// sync stops with one plain line rather than putting the old grant and account back. The database
// half (the service-role select and conditional update on connection_tokens) lives in
// connections/sync.ts; this half has no client of its own, so it is unit-tested without one.
// Errors carry fixed text, never a value.
import { openTokens, sealTokens, type SealedTokens, type TokenKeys } from "../tokenCrypto.ts";
import { SyncError } from "./errors.ts";
import type { ProviderTokens, StoredTokens, TokenStore } from "./types.ts";

export const NO_SIGN_IN = "This connection has no sign-in on file. Connect it again in Settings.";
export const CONNECTION_CHANGED = "This connection changed while it was syncing. Sync it again.";

export interface StoredTokenRow {
  access_token: string;
  refresh_token: string | null;
  account_id: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  updated_at: string;
}

export type TokenRowWrite = SealedTokens & { access_expires_at: string | null; refresh_expires_at: string | null };

export interface TokenRows {
  // The connection's row, or null when there is none or it could not be read.
  read(connectionId: string): Promise<StoredTokenRow | null>;
  // Writes the values only if the row's updated_at is still loadedAt. True when a row was written;
  // false when none matched (the row was replaced or removed since it was read).
  write(connectionId: string, values: TokenRowWrite, loadedAt: string): Promise<boolean>;
}

export function createSealedTokenStore(rows: TokenRows, keys: TokenKeys): TokenStore {
  // What each connection's load read, by connection id: its account id and its updated_at.
  const loaded = new Map<string, { accountId: string | null; updatedAt: string }>();
  return {
    async load(connectionId): Promise<StoredTokens> {
      const row = await rows.read(connectionId);
      if (!row) throw new SyncError(NO_SIGN_IN);
      // Opening fails only with a TokenSealError (wrong key, owner or field, or not sealed at all),
      // and every one of those is a sign-in this connection cannot use.
      let opened: Awaited<ReturnType<typeof openTokens>>;
      try {
        opened = await openTokens({ connectionId }, row, keys);
      } catch {
        throw new SyncError(NO_SIGN_IN);
      }
      loaded.set(connectionId, { accountId: opened.accountId, updatedAt: row.updated_at });
      return { ...opened, accessExpiresAt: row.access_expires_at ?? null, refreshExpiresAt: row.refresh_expires_at ?? null };
    },
    async save(connectionId, tokens: ProviderTokens) {
      // Only a row this store read can be compared, so a save without a load writes nothing.
      const read = loaded.get(connectionId);
      if (!read) throw new SyncError(CONNECTION_CHANGED);
      // The account id it opened is sealed again, a blank id stored as none.
      const accountId = read.accountId && read.accountId.trim() ? read.accountId : null;
      const sealed = await sealTokens({ connectionId }, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, accountId }, keys);
      const written = await rows.write(connectionId, { ...sealed, access_expires_at: tokens.accessExpiresAt, refresh_expires_at: tokens.refreshExpiresAt }, read.updatedAt);
      if (!written) throw new SyncError(CONNECTION_CHANGED);
    },
  };
}
