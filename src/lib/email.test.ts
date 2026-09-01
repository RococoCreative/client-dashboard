import { describe, expect, it } from "vitest";
import { emailDomain, isRococoEmail, isValidEmail, normalizeDomain, normalizeEmail } from "./email.ts";

describe("email helpers", () => {
  it("normalizes and extracts domains", () => {
    expect(normalizeEmail("  Austin@RococoCreative.io ")).toBe("austin@rocococreative.io");
    expect(emailDomain("Someone@BeKlasik.com")).toBe("beklasik.com");
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("nope@")).toBeNull();
    expect(emailDomain("@nope.com")).toBeNull();
    expect(emailDomain("x@localhost")).toBeNull();
  });

  it("validates addresses loosely and recognizes Rococo", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a b@b.co")).toBe(false);
    expect(isRococoEmail("austin@rocococreative.io")).toBe(true);
    expect(isRococoEmail("austin@gmail.com")).toBe(false);
  });

  it("normalizes domain input", () => {
    expect(normalizeDomain("@BeKlasik.com")).toBe("beklasik.com");
    expect(normalizeDomain("https://www.rbaprojects.com/about")).toBe("rbaprojects.com");
    expect(normalizeDomain("kingdom custom")).toBeNull();
    expect(normalizeDomain("gmail")).toBeNull();
  });
});
