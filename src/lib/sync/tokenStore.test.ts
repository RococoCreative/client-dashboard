// Pins the token store every sync reads its sign-in through: it opens a sealed row, hands back the
// account id it holds, refuses anything it cannot open with one plain line, and seals every save
// under the current key, the account id included, so a key rotation moves all three values on the
// next refresh and never strands the QuickBooks company under the previous key.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSealedTokenStore, type StoredTokenRow, type TokenRowWrite } from "../../../supabase/functions/_shared/sync/tokenStore.ts";
import { loadTokenKeys, openTokens, sealTokens, type TokenKeys } from "../../../supabase/functions/_shared/tokenCrypto.ts";
import type { ProviderTokens } from "../../../supabase/functions/_shared/sync/types.ts";

const keyOf = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
const OLD = keyOf(1);
const NEW = keyOf(2);
const keysFor = (current: string, previous?: string) =>
  loadTokenKeys((name) => (name === "TOKEN_ENCRYPTION_KEY" ? current : name === "TOKEN_ENCRYPTION_KEY_PREVIOUS" ? previous : undefined));

const NO_SIGN_IN = "This connection has no sign-in on file. Connect it again in Settings.";
const OWNER = { connectionId: "sample-conn" };
const EXPIRES = { access_expires_at: "2026-11-09T15:00:00.000Z", refresh_expires_at: "2027-02-07T14:00:00.000Z" };
const NEXT: ProviderTokens = { accessToken: "sample-access-2", refreshToken: "sample-refresh-2", accessExpiresAt: "2026-11-09T16:00:00.000Z", refreshExpiresAt: null };

async function sealedRow(keys: TokenKeys, accountId: string | null = "sample-realm", owner = OWNER): Promise<StoredTokenRow> {
  const sealed = await sealTokens(owner, { accessToken: "sample-access", refreshToken: "sample-refresh", accountId }, keys);
  return { access_token: sealed.access_token, refresh_token: sealed.refresh_token, account_id: sealed.account_id ?? null, ...EXPIRES };
}

function rowsOf(row: StoredTokenRow | null) {
  const writes: Array<{ connectionId: string; values: TokenRowWrite }> = [];
  return {
    writes,
    rows: {
      read: async () => row,
      write: async (connectionId: string, values: TokenRowWrite) => {
        writes.push({ connectionId, values });
      },
    },
  };
}

describe("createSealedTokenStore", () => {
  it("opens a sealed row and hands back its account id and expiries", async () => {
    const keys = await keysFor(NEW);
    const { rows } = rowsOf(await sealedRow(keys));
    expect(await createSealedTokenStore(rows, keys).load("sample-conn")).toEqual({
      accessToken: "sample-access",
      refreshToken: "sample-refresh",
      accountId: "sample-realm",
      accessExpiresAt: EXPIRES.access_expires_at,
      refreshExpiresAt: EXPIRES.refresh_expires_at,
    });
  });

  it("reads a missing row, a plaintext row, or a row sealed for another connection as no sign-in on file", async () => {
    const keys = await keysFor(NEW);
    const plaintext: StoredTokenRow = { access_token: "sample-access", refresh_token: "sample-refresh", account_id: null, ...EXPIRES };
    for (const row of [null, plaintext, await sealedRow(keys, "sample-realm", { connectionId: "other-conn" })]) {
      const err = await createSealedTokenStore(rowsOf(row).rows, keys)
        .load("sample-conn")
        .catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(NO_SIGN_IN);
      expect((err as Error).message).not.toContain("sample-access");
    }
  });

  it("seals every save, with the account id it opened, under the current key", async () => {
    const keys = await keysFor(NEW);
    const { rows, writes } = rowsOf(await sealedRow(keys));
    const store = createSealedTokenStore(rows, keys);
    await store.load("sample-conn");
    await store.save("sample-conn", NEXT);
    expect(writes).toHaveLength(1);
    const { connectionId, values } = writes[0];
    expect(connectionId).toBe("sample-conn");
    expect(values.access_expires_at).toBe(NEXT.accessExpiresAt);
    expect(values.refresh_expires_at).toBeNull();
    for (const sealed of [values.access_token, values.refresh_token, values.account_id]) expect(sealed?.startsWith("v1:")).toBe(true);
    expect(JSON.stringify(values)).not.toMatch(/sample-(access|refresh|realm)/);
    expect(await openTokens(OWNER, { access_token: values.access_token, refresh_token: values.refresh_token, account_id: values.account_id ?? null }, keys)).toEqual({
      accessToken: "sample-access-2",
      refreshToken: "sample-refresh-2",
      accountId: "sample-realm",
    });
  });

  it("moves a row sealed under the previous key wholly onto the current key on its next save", async () => {
    const { rows, writes } = rowsOf(await sealedRow(await keysFor(OLD)));
    const store = createSealedTokenStore(rows, await keysFor(NEW, OLD));
    expect((await store.load("sample-conn")).accountId).toBe("sample-realm");
    await store.save("sample-conn", NEXT);
    const { values } = writes[0];
    const currentOnly = await keysFor(NEW);
    expect(await openTokens(OWNER, { access_token: values.access_token, refresh_token: values.refresh_token, account_id: values.account_id ?? null }, currentOnly)).toEqual({
      accessToken: "sample-access-2",
      refreshToken: "sample-refresh-2",
      accountId: "sample-realm",
    });
  });

  it("keeps a connection with no account id at none", async () => {
    const keys = await keysFor(NEW);
    const { rows, writes } = rowsOf(await sealedRow(keys, null));
    const store = createSealedTokenStore(rows, keys);
    await store.load("sample-conn");
    await store.save("sample-conn", NEXT);
    expect(writes[0].values.account_id).toBeNull();
  });

  it("leaves the stored account id alone when it saves a connection it never opened", async () => {
    const keys = await keysFor(NEW);
    const { rows, writes } = rowsOf(null);
    await createSealedTokenStore(rows, keys).save("sample-conn", NEXT);
    expect(writes[0].values).not.toHaveProperty("account_id");
  });
});
