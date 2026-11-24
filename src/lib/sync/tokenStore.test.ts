// Pins the token store every sync reads its sign-in through: it opens a sealed row, hands back the
// account id it holds, refuses anything it cannot open with one plain line, and seals every save
// under the current key, the account id included, so a key rotation moves all three values on the
// next refresh and never strands the QuickBooks company under the previous key. A save lands only
// on the row its load read: a reconnect or disconnect in between wins, and the save writes nothing.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CONNECTION_CHANGED, createSealedTokenStore, type StoredTokenRow, type TokenRowWrite } from "../../../supabase/functions/_shared/sync/tokenStore.ts";
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
const LOADED_AT = "2026-11-09T13:00:00.123456+00:00";
const NEXT: ProviderTokens = { accessToken: "sample-access-2", refreshToken: "sample-refresh-2", accessExpiresAt: "2026-11-09T16:00:00.000Z", refreshExpiresAt: null };

async function sealedRow(keys: TokenKeys, accountId: string | null = "sample-realm", owner = OWNER): Promise<StoredTokenRow> {
  const sealed = await sealTokens(owner, { accessToken: "sample-access", refreshToken: "sample-refresh", accountId }, keys);
  return { access_token: sealed.access_token, refresh_token: sealed.refresh_token, account_id: sealed.account_id ?? null, ...EXPIRES, updated_at: LOADED_AT };
}

// A fake table of one row. A write lands only when the row is still the one the load read, as the
// database's conditional update does; changeRow stands in for a reconnect or disconnect in between.
function rowsOf(row: StoredTokenRow | null) {
  let current = row;
  const writes: Array<{ connectionId: string; values: TokenRowWrite; loadedAt: string }> = [];
  return {
    writes,
    changeRow: (next: StoredTokenRow | null) => {
      current = next;
    },
    rows: {
      read: async () => current,
      write: async (connectionId: string, values: TokenRowWrite, loadedAt: string) => {
        if (!current || current.updated_at !== loadedAt) return false;
        writes.push({ connectionId, values, loadedAt });
        return true;
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
    const plaintext: StoredTokenRow = { access_token: "sample-access", refresh_token: "sample-refresh", account_id: null, ...EXPIRES, updated_at: LOADED_AT };
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

  it("saves only onto the row it loaded, by the updated_at it read", async () => {
    const keys = await keysFor(NEW);
    const { rows, writes } = rowsOf(await sealedRow(keys));
    const store = createSealedTokenStore(rows, keys);
    await store.load("sample-conn");
    await store.save("sample-conn", NEXT);
    expect(writes).toHaveLength(1);
    expect(writes[0].loadedAt).toBe(LOADED_AT);
  });

  it("writes nothing and says the connection changed when a reconnect replaced the row after the load", async () => {
    const keys = await keysFor(NEW);
    const fake = rowsOf(await sealedRow(keys));
    const store = createSealedTokenStore(fake.rows, keys);
    await store.load("sample-conn");
    const reconnected = { ...(await sealedRow(keys, "sample-realm-new")), updated_at: "2026-11-09T13:00:05.000001+00:00" };
    fake.changeRow(reconnected);
    const err = await store.save("sample-conn", NEXT).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(CONNECTION_CHANGED);
    expect(fake.writes).toHaveLength(0);
    // The reconnect's own sign-in and account are what the connection still holds.
    expect(await openTokens(OWNER, (await fake.rows.read())!, keys)).toEqual({ accessToken: "sample-access", refreshToken: "sample-refresh", accountId: "sample-realm-new" });
  });

  it("writes nothing and says the connection changed when the row went after the load", async () => {
    const keys = await keysFor(NEW);
    const fake = rowsOf(await sealedRow(keys));
    const store = createSealedTokenStore(fake.rows, keys);
    await store.load("sample-conn");
    fake.changeRow(null);
    await expect(store.save("sample-conn", NEXT)).rejects.toThrow(CONNECTION_CHANGED);
    expect(fake.writes).toHaveLength(0);
  });

  it("refuses to save a connection it never opened, writing nothing", async () => {
    const keys = await keysFor(NEW);
    const { rows, writes } = rowsOf(await sealedRow(keys));
    await expect(createSealedTokenStore(rows, keys).save("sample-conn", NEXT)).rejects.toThrow(CONNECTION_CHANGED);
    expect(writes).toHaveLength(0);
  });

  it("says the connection changed in one plain line", () => {
    expect(CONNECTION_CHANGED).toBe("This connection changed while it was syncing. Sync it again.");
  });
});
