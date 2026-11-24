// The sealing half of the token store a sync reads its sign-in through. A load opens the stored row
// and remembers the account id it held; every save seals the access token, the refresh token and
// that account id again under the current key, so a key rotation moves the whole row on its next
// refresh and nothing is left that only the previous key can open. The database half (the
// service-role select and update on connection_tokens) lives in connections/sync.ts; this half has
// no client of its own, so it is unit-tested without one. Errors carry fixed text, never a value.
import { openTokens, sealTokens, type SealedTokens, type TokenKeys } from "../tokenCrypto.ts";
import { SyncError } from "./errors.ts";
import type { ProviderTokens, StoredTokens, TokenStore } from "./types.ts";

export const NO_SIGN_IN = "This connection has no sign-in on file. Connect it again in Settings.";

export interface StoredTokenRow {
  access_token: string;
  refresh_token: string | null;
  account_id: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
}

export type TokenRowWrite = SealedTokens & { access_expires_at: string | null; refresh_expires_at: string | null };

export interface TokenRows {
  // The connection's row, or null when there is none or it could not be read.
  read(connectionId: string): Promise<StoredTokenRow | null>;
  write(connectionId: string, values: TokenRowWrite): Promise<void>;
}

export function createSealedTokenStore(rows: TokenRows, keys: TokenKeys): TokenStore {
  // The account id each connection opened with, by connection id, for the save that follows.
  const accounts = new Map<string, string | null>();
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
      accounts.set(connectionId, opened.accountId);
      return { ...opened, accessExpiresAt: row.access_expires_at ?? null, refreshExpiresAt: row.refresh_expires_at ?? null };
    },
    async save(connectionId, tokens: ProviderTokens) {
      // A connection this store never opened keeps whatever account id it has (undefined is left
      // out of the write); one it opened is sealed again, a blank id stored as none.
      const opened = accounts.get(connectionId);
      const accountId = accounts.has(connectionId) ? (opened && opened.trim() ? opened : null) : undefined;
      const sealed = await sealTokens({ connectionId }, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, accountId }, keys);
      await rows.write(connectionId, { ...sealed, access_expires_at: tokens.accessExpiresAt, refresh_expires_at: tokens.refreshExpiresAt });
    },
  };
}
