// Pins the edge functions' Rococo admin rule to the database's (private.is_rococo_admin, 0051): an
// active, flagged profile whose own address is also its account's address, confirmed, and on the
// list. The list itself is read under row level security by each function, so a fake lookup
// stands in for it here.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isRococoAdmin, rococoAccountMatches } from "../../../supabase/functions/_shared/rococoAdmin.ts";

const profile = { is_active: true, is_rococo_admin: true, email: "Sam@rocococreative.io" };
const account = { email: "sam@rocococreative.io", emailConfirmed: true };

describe("rococoAccountMatches", () => {
  it("holds for an active, flagged profile whose confirmed account has the same address, in any case", () => {
    expect(rococoAccountMatches(profile, account)).toBe(true);
  });

  it("fails for an unconfirmed email, another account address, or a missing one", () => {
    expect(rococoAccountMatches(profile, { ...account, emailConfirmed: false })).toBe(false);
    expect(rococoAccountMatches(profile, { ...account, email: "other@rocococreative.io" })).toBe(false);
    expect(rococoAccountMatches(profile, { ...account, email: null })).toBe(false);
    expect(rococoAccountMatches(profile, { ...account, email: "" })).toBe(false);
  });

  it("fails for an inactive or unflagged profile, or one with no address", () => {
    expect(rococoAccountMatches({ ...profile, is_active: false }, account)).toBe(false);
    expect(rococoAccountMatches({ ...profile, is_rococo_admin: false }, account)).toBe(false);
    expect(rococoAccountMatches({ ...profile, is_rococo_admin: "true" }, account)).toBe(false);
    expect(rococoAccountMatches({ ...profile, email: null }, account)).toBe(false);
    expect(rococoAccountMatches({ ...profile, email: "" }, { ...account, email: "" })).toBe(false);
  });
});

describe("isRococoAdmin", () => {
  it("holds when the account half holds and the lowercased address is on the list", async () => {
    const asked: string[] = [];
    const onList = async (email: string) => {
      asked.push(email);
      return true;
    };
    expect(await isRococoAdmin(profile, account, onList)).toBe(true);
    expect(asked).toEqual(["sam@rocococreative.io"]);
  });

  it("never asks the list when the account half fails, whatever the flag says", async () => {
    const asked: string[] = [];
    const onList = async (email: string) => {
      asked.push(email);
      return true;
    };
    expect(await isRococoAdmin(profile, { ...account, emailConfirmed: false }, onList)).toBe(false);
    expect(await isRococoAdmin(profile, { ...account, email: "other@rocococreative.io" }, onList)).toBe(false);
    expect(await isRococoAdmin({ ...profile, is_active: false }, account, onList)).toBe(false);
    expect(await isRococoAdmin({ ...profile, is_rococo_admin: false }, account, onList)).toBe(false);
    expect(asked).toEqual([]);
  });

  it("fails when the address is off the list or the list cannot be read", async () => {
    expect(await isRococoAdmin(profile, account, async () => false)).toBe(false);
    expect(
      await isRococoAdmin(profile, account, async () => {
        throw new Error("The list could not be read.");
      }),
    ).toBe(false);
  });
});
