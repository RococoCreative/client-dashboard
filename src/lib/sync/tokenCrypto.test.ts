// Pins the token sealing helper every stored provider token goes through: the v1: layout, that a
// value only opens under the owner, field and key it was sealed with, that a rotation still opens
// values sealed under the previous key, and that a missing or malformed key names the secret at
// fault rather than failing later.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  TokenKeyError,
  TokenSealError,
  decryptToken,
  encryptToken,
  loadTokenKeys,
  openTokens,
  sealTokens,
  tokenAad,
  tokenKeyProblem,
} from "../../../supabase/functions/_shared/tokenCrypto.ts";

const keyOf = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
const A = keyOf(1);
const B = keyOf(2);
const read = (env: Record<string, string>) => (name: string) => env[name];

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0));

describe("tokenCrypto", () => {
  it("round-trips a value under the same owner and field", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const aad = tokenAad({ connectionId: "c1" }, "refresh_token");
    const sealed = await encryptToken("sample-refresh", aad, keys);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("sample-refresh");
    expect(await decryptToken(sealed, aad, keys)).toBe("sample-refresh");
  });

  it("lays out v1: then base64url of a 12-byte IV, the ciphertext and a 16-byte tag", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const sealed = await encryptToken("sample", tokenAad({ connectionId: "c1" }, "access_token"), keys);
    const body = sealed.slice(3);
    expect(body).not.toMatch(/[=+/]/);
    expect(fromBase64Url(body).length).toBe(12 + new TextEncoder().encode("sample").length + 16);
  });

  it("opens a fixed v1 value: IV first, then ciphertext and tag, bound to the exact AAD bytes", async () => {
    // Built once outside the helper with Node's Web Crypto: key A, IV 00..0b, AAD
    // utf8("connection:c1:access_token"), plaintext "known-answer". Stored rows must keep opening.
    const vector = "v1:AAECAwQFBgcICQoL0Mj6UU7TZxeNHYK2zstHhe3sGl0BDi0gcbVK4g";
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    expect(await decryptToken(vector, "connection:c1:access_token", keys)).toBe("known-answer");
    expect(fromBase64Url(vector.slice(3)).slice(0, 12)).toEqual(Uint8Array.from({ length: 12 }, (_, i) => i));

    // And what the helper seals opens with plain Web Crypto under that same layout and AAD.
    const sealed = await encryptToken("known-answer", tokenAad({ connectionId: "c1" }, "access_token"), keys);
    const bytes = fromBase64Url(sealed.slice(3));
    const raw = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(1), { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode("connection:c1:access_token"), tagLength: 128 },
      raw,
      bytes.slice(12),
    );
    expect(new TextDecoder().decode(plain)).toBe("known-answer");
  });

  it("seals the same value differently each time", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const aad = tokenAad({ connectionId: "c1" }, "access_token");
    const first = await encryptToken("same", aad, keys);
    const second = await encryptToken("same", aad, keys);
    expect(first).not.toBe(second);
    expect(fromBase64Url(first.slice(3)).slice(0, 12)).not.toEqual(fromBase64Url(second.slice(3)).slice(0, 12));
    expect(await decryptToken(first, aad, keys)).toBe("same");
    expect(await decryptToken(second, aad, keys)).toBe("same");
  });

  it("refuses a value under another owner or field (AAD mismatch)", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const sealed = await encryptToken("sample-access", tokenAad({ connectionId: "c1" }, "access_token"), keys);
    await expect(decryptToken(sealed, tokenAad({ connectionId: "c2" }, "access_token"), keys)).rejects.toThrow(TokenSealError);
    await expect(decryptToken(sealed, tokenAad({ connectionId: "c1" }, "refresh_token"), keys)).rejects.toThrow(TokenSealError);
    await expect(decryptToken(sealed, tokenAad({ pendingId: "c1" }, "access_token"), keys)).rejects.toThrow(TokenSealError);
  });

  it("refuses a value sealed with another key", async () => {
    const aad = tokenAad({ connectionId: "c1" }, "access_token");
    const sealed = await encryptToken("sample", aad, await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A })));
    const other = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: B }));
    await expect(decryptToken(sealed, aad, other)).rejects.toThrow(TokenSealError);
  });

  it("opens a value sealed with the previous key", async () => {
    const aad = tokenAad({ connectionId: "c1" }, "refresh_token");
    const sealed = await encryptToken("sample", aad, await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A })));
    const rotated = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: B, TOKEN_ENCRYPTION_KEY_PREVIOUS: A }));
    expect(await decryptToken(sealed, aad, rotated)).toBe("sample");
  });

  it("re-seals a value opened with the previous key under the current key", async () => {
    const aad = tokenAad({ connectionId: "c1" }, "refresh_token");
    const sealed = await encryptToken("sample", aad, await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A })));
    const rotated = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: B, TOKEN_ENCRYPTION_KEY_PREVIOUS: A }));
    const resealed = await encryptToken(await decryptToken(sealed, aad, rotated), aad, rotated);
    const currentOnly = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: B }));
    expect(await decryptToken(resealed, aad, currentOnly)).toBe("sample");
  });

  it("throws TokenKeyError naming TOKEN_ENCRYPTION_KEY when it is missing or empty", async () => {
    await expect(loadTokenKeys(read({}))).rejects.toThrow(TokenKeyError);
    await expect(loadTokenKeys(read({}))).rejects.toThrow("TOKEN_ENCRYPTION_KEY");
    await expect(loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: "" }))).rejects.toThrow(TokenKeyError);
    await expect(loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: "" }))).rejects.toThrow("TOKEN_ENCRYPTION_KEY");
    await expect(loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: "  \n\t " }))).rejects.toThrow(TokenKeyError);
    await expect(loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: "  \n\t " }))).rejects.toThrow("TOKEN_ENCRYPTION_KEY");
  });

  it("refuses anything without the v1: prefix or too short to hold an IV and a tag", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const aad = tokenAad({ connectionId: "c1" }, "access_token");
    for (const bad of ["plain", "v2:AAAA", "v1:", "v1:AAAA"]) {
      await expect(decryptToken(bad, aad, keys)).rejects.toThrow(TokenSealError);
    }
  });

  it("tokenKeyProblem accepts a key with surrounding whitespace and names the secret at fault", () => {
    expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: `${A}\n` }))).toBeNull();
    expect(tokenKeyProblem(read({}))).toBe("TOKEN_ENCRYPTION_KEY");
    expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: btoa("sixteen-bytes!!!") }))).toBe("TOKEN_ENCRYPTION_KEY");
    expect(tokenKeyProblem(read({ TOKEN_ENCRYPTION_KEY: A, TOKEN_ENCRYPTION_KEY_PREVIOUS: "not base64 at all" }))).toBe("TOKEN_ENCRYPTION_KEY_PREVIOUS");
  });

  it("tokenAad is connection:<id>:<field> or pending:<id>:<field>", () => {
    expect(tokenAad({ connectionId: "c1" }, "account_id")).toBe("connection:c1:account_id");
    expect(tokenAad({ pendingId: "p1" }, "access_token")).toBe("pending:p1:access_token");
  });

  it("sealTokens leaves account_id out when accountId is undefined, so a refresh save never overwrites it", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const owner = { connectionId: "c1" };
    const refresh = await sealTokens(owner, { accessToken: "a", refreshToken: null }, keys);
    expect(Object.keys(refresh)).toEqual(["access_token", "refresh_token"]);
    expect(refresh.refresh_token).toBeNull();
    expect(await decryptToken(refresh.access_token, tokenAad(owner, "access_token"), keys)).toBe("a");

    const first = await sealTokens(owner, { accessToken: "a", refreshToken: "r", accountId: "realm-1" }, keys);
    expect(Object.keys(first)).toContain("account_id");
    const opened = await openTokens(owner, { access_token: first.access_token, refresh_token: first.refresh_token, account_id: first.account_id ?? null }, keys);
    expect(opened).toEqual({ accessToken: "a", refreshToken: "r", accountId: "realm-1" });
  });

  it("refuses to seal anything but a non-empty string, and to open anything but a string", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const owner = { connectionId: "c1" };
    const aad = tokenAad(owner, "access_token");
    await expect(encryptToken("", aad, keys)).rejects.toThrow(TokenSealError);
    await expect(encryptToken(undefined as never, aad, keys)).rejects.toThrow(TokenSealError);
    await expect(encryptToken(null as never, aad, keys)).rejects.toThrow(TokenSealError);
    await expect(decryptToken(null as never, aad, keys)).rejects.toThrow(TokenSealError);
    await expect(decryptToken(undefined as never, aad, keys)).rejects.toThrow(TokenSealError);
    await expect(sealTokens(owner, { accessToken: undefined as never, refreshToken: null }, keys)).rejects.toThrow(TokenSealError);
    await expect(sealTokens(owner, { accessToken: "a", refreshToken: undefined as never }, keys)).rejects.toThrow(TokenSealError);
    await expect(sealTokens(owner, { accessToken: "a", refreshToken: "" }, keys)).rejects.toThrow(TokenSealError);
    await expect(openTokens(owner, { access_token: null as never, refresh_token: null, account_id: null }, keys)).rejects.toThrow(TokenSealError);
    const nulls = await sealTokens(owner, { accessToken: "a", refreshToken: null, accountId: null }, keys);
    expect(nulls.refresh_token).toBeNull();
    expect(nulls.account_id).toBeNull();
  });

  it("tokenAad refuses a missing or empty id, an owner with both keys or neither, and malformed text", () => {
    expect(() => tokenAad({ connectionId: undefined as never }, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ connectionId: "" }, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ pendingId: "" }, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ connectionId: "c1", pendingId: "p1" } as never, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({} as never, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad(null as never, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ connectionId: "c\uD800" }, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ pendingId: "\uDC00p" }, "access_token")).toThrow(TokenSealError);
    expect(() => tokenAad({ connectionId: "c1" }, "password" as never)).toThrow(TokenSealError);
    expect(tokenAad({ connectionId: "c\u{1F600}" }, "access_token")).toBe("connection:c\u{1F600}:access_token");
  });

  it("openTokens refuses an access token sealed as the refresh token (field swap)", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const owner = { connectionId: "c1" };
    const sealed = await sealTokens(owner, { accessToken: "a", refreshToken: "r" }, keys);
    const swapped = { access_token: sealed.refresh_token as string, refresh_token: sealed.access_token, account_id: null };
    await expect(openTokens(owner, swapped, keys)).rejects.toThrow(TokenSealError);
  });
});
