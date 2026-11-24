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

  it("seals the same value differently each time", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const aad = tokenAad({ connectionId: "c1" }, "access_token");
    const first = await encryptToken("same", aad, keys);
    const second = await encryptToken("same", aad, keys);
    expect(first).not.toBe(second);
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

  it("openTokens refuses an access token sealed as the refresh token (field swap)", async () => {
    const keys = await loadTokenKeys(read({ TOKEN_ENCRYPTION_KEY: A }));
    const owner = { connectionId: "c1" };
    const sealed = await sealTokens(owner, { accessToken: "a", refreshToken: "r" }, keys);
    const swapped = { access_token: sealed.refresh_token as string, refresh_token: sealed.access_token, account_id: null };
    await expect(openTokens(owner, swapped, keys)).rejects.toThrow(TokenSealError);
  });
});
