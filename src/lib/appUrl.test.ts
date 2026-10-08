// The public address an invitation carries: the configured domain when set, the current
// origin otherwise, and never a malformed value.
import { describe, expect, it } from "vitest";
import { appOrigin } from "./appUrl.ts";
import { inviteLink } from "../services/invitations.ts";

describe("appOrigin", () => {
  it("uses the configured domain, trimmed to its origin", () => {
    expect(appOrigin("https://companyhub.rocococreative.io/")).toBe("https://companyhub.rocococreative.io");
    expect(appOrigin(" https://companyhub.rocococreative.io/login ")).toBe("https://companyhub.rocococreative.io");
  });

  it("falls back to the current origin when unset or malformed", () => {
    expect(appOrigin(undefined)).toBe(window.location.origin);
    expect(appOrigin("")).toBe(window.location.origin);
    expect(appOrigin("not a url")).toBe(window.location.origin);
  });
});

describe("inviteLink", () => {
  it("points at the given origin with the address pre-filled", () => {
    expect(inviteLink(" Amber@Example.com ", "https://companyhub.rocococreative.io")).toBe(
      "https://companyhub.rocococreative.io/?email=amber%40example.com",
    );
  });
});
