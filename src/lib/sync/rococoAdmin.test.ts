// Pins the connections function's Rococo admin rule to the database's (private.is_rococo_admin,
// 0051): an active, flagged profile whose own address is also its account's address, confirmed.
// The list itself is read under row level security by the function, so only this half is here.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rococoAccountMatches } from "../../../supabase/functions/_shared/rococoAdmin.ts";

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
