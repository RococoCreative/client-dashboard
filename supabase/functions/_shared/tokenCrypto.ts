// Seals provider tokens before they are stored and opens them when the connections function needs
// them, so a copy of the database alone never yields a working sign-in. AES-256-GCM through Web
// Crypto, keyed by the TOKEN_ENCRYPTION_KEY function secret, with TOKEN_ENCRYPTION_KEY_PREVIOUS
// read too while a rotation is under way. Each value is bound to its owner and field as additional
// authenticated data, so it cannot be moved to another connection or column and still open.
// Format: "v1:" then base64url without padding of the 12-byte IV, the ciphertext and the 16-byte
// tag. The prefix marks the format only, never a key. Errors carry fixed text, never a value.
import { fromBase64, fromBase64Url, toBase64Url } from "./bytes.ts";

export const TOKEN_FORMAT = "v1:";
export const TOKENS_NOT_SET_UP = "Connections are not set up yet. Ask Rococo Creative to finish the setup.";

export type TokenField = "access_token" | "refresh_token" | "account_id";
export type TokenOwner = { connectionId: string } | { pendingId: string };

export interface TokenKeys {
  current: CryptoKey;
  previous: CryptoKey | null;
}

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

export class TokenSealError extends Error {
  constructor(message = "The stored sign-in could not be read.") {
    super(message);
    this.name = "TokenSealError";
  }
}

const CURRENT = "TOKEN_ENCRYPTION_KEY";
const PREVIOUS = "TOKEN_ENCRYPTION_KEY_PREVIOUS";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

type KeyReading = { state: "unset" } | { state: "bad" } | { state: "ok"; raw: Uint8Array<ArrayBuffer> };

// Unset and blank read the same; set means 32 bytes of base64 once the ends are trimmed.
function readKey(value: string | undefined): KeyReading {
  const text = (value ?? "").trim();
  if (!text) return { state: "unset" };
  const raw = fromBase64(text);
  return raw && raw.length === KEY_BYTES ? { state: "ok", raw } : { state: "bad" };
}

// The secret at fault, or null when the keys are usable. The current key must be set and well
// formed; the previous key may be unset, but if it is set it must be well formed too.
export function tokenKeyProblem(read: (name: string) => string | undefined): typeof CURRENT | typeof PREVIOUS | null {
  if (readKey(read(CURRENT)).state !== "ok") return CURRENT;
  if (readKey(read(PREVIOUS)).state === "bad") return PREVIOUS;
  return null;
}

const importKey = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

export async function loadTokenKeys(read: (name: string) => string | undefined): Promise<TokenKeys> {
  const current = readKey(read(CURRENT));
  if (current.state !== "ok") throw new TokenKeyError(`${CURRENT} is missing or is not 32 bytes of base64.`);
  const previous = readKey(read(PREVIOUS));
  if (previous.state === "bad") throw new TokenKeyError(`${PREVIOUS} is not 32 bytes of base64.`);
  return {
    current: await importKey(current.raw),
    previous: previous.state === "ok" ? await importKey(previous.raw) : null,
  };
}

export function tokenAad(owner: TokenOwner, field: TokenField): string {
  return "connectionId" in owner ? `connection:${owner.connectionId}:${field}` : `pending:${owner.pendingId}:${field}`;
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const gcm = (iv: Uint8Array<ArrayBuffer>, aad: string): AesGcmParams => ({ name: "AES-GCM", iv, additionalData: utf8(aad), tagLength: TAG_BYTES * 8 });

export async function encryptToken(plain: string, aad: string, keys: TokenKeys): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(gcm(iv, aad), keys.current, utf8(plain)));
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return TOKEN_FORMAT + toBase64Url(out);
}

// Tries the current key, then the previous one; GCM's tag check refuses the wrong key, owner or
// field. Every failure reads the same, so nothing about why reaches a caller or a log.
export async function decryptToken(sealed: string, aad: string, keys: TokenKeys): Promise<string> {
  if (!sealed.startsWith(TOKEN_FORMAT)) throw new TokenSealError();
  const bytes = fromBase64Url(sealed.slice(TOKEN_FORMAT.length));
  if (!bytes || bytes.length < IV_BYTES + TAG_BYTES) throw new TokenSealError();
  const params = gcm(bytes.slice(0, IV_BYTES), aad);
  const body = bytes.slice(IV_BYTES);
  for (const key of [keys.current, keys.previous]) {
    if (!key) continue;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(await crypto.subtle.decrypt(params, key, body));
    } catch {
      // The wrong key for this value; the next one may be right.
    }
  }
  throw new TokenSealError();
}

export interface SealedTokens {
  access_token: string;
  refresh_token: string | null;
  account_id?: string | null;
}

// The row values to store. account_id is left out entirely when accountId is undefined, so a save
// after a token refresh, which never learns the account, does not overwrite the stored one.
export async function sealTokens(
  owner: TokenOwner,
  tokens: { accessToken: string; refreshToken: string | null; accountId?: string | null },
  keys: TokenKeys,
): Promise<SealedTokens> {
  const out: SealedTokens = {
    access_token: await encryptToken(tokens.accessToken, tokenAad(owner, "access_token"), keys),
    refresh_token: tokens.refreshToken === null ? null : await encryptToken(tokens.refreshToken, tokenAad(owner, "refresh_token"), keys),
  };
  if (tokens.accountId !== undefined) {
    out.account_id = tokens.accountId === null ? null : await encryptToken(tokens.accountId, tokenAad(owner, "account_id"), keys);
  }
  return out;
}

export async function openTokens(
  owner: TokenOwner,
  row: { access_token: string; refresh_token: string | null; account_id: string | null },
  keys: TokenKeys,
): Promise<{ accessToken: string; refreshToken: string | null; accountId: string | null }> {
  return {
    accessToken: await decryptToken(row.access_token, tokenAad(owner, "access_token"), keys),
    refreshToken: row.refresh_token === null ? null : await decryptToken(row.refresh_token, tokenAad(owner, "refresh_token"), keys),
    accountId: row.account_id === null ? null : await decryptToken(row.account_id, tokenAad(owner, "account_id"), keys),
  };
}
