// Pins the one shared byte helper the edge functions use: base64url without padding both ways,
// standard base64 for secrets pasted by hand, and a compare that does not stop at the first
// difference.
import { describe, expect, it } from "vitest";
import { fromBase64, fromBase64Url, sameBytes, toBase64Url } from "../../../supabase/functions/_shared/bytes.ts";

describe("bytes", () => {
  it("round-trips through base64url without padding or the + and / characters", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const length of [0, 1, 2, 3, 4, 31, 32, 256]) {
      const slice = bytes.slice(0, length);
      const text = toBase64Url(slice);
      expect(text).not.toMatch(/[=+/]/);
      expect(fromBase64Url(text)).toEqual(slice);
    }
  });

  it("fromBase64Url refuses padding, the standard alphabet, and impossible lengths", () => {
    expect(fromBase64Url("AA==")).toBeNull();
    expect(fromBase64Url("+/+/")).toBeNull();
    expect(fromBase64Url("AAAAA")).toBeNull();
    expect(fromBase64Url("not base64")).toBeNull();
  });

  it("fromBase64Url refuses a final character that carries padding bits, so each value has one spelling", () => {
    expect(fromBase64Url("AA")).toEqual(Uint8Array.from([0]));
    expect(fromBase64Url("AB")).toBeNull();
    expect(fromBase64Url("AAA")).toEqual(Uint8Array.from([0, 0]));
    expect(fromBase64Url("AAB")).toBeNull();
    expect(fromBase64Url("AAAA")).toEqual(Uint8Array.from([0, 0, 0]));
  });

  it("fromBase64 reads standard base64 or base64url, padded or not, and trims the ends", () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
    const standard = btoa(String.fromCharCode(...bytes));
    expect(standard).toMatch(/[+/]/);
    expect(fromBase64(standard)).toEqual(bytes);
    expect(fromBase64(` ${standard}\n`)).toEqual(bytes);
    expect(fromBase64(toBase64Url(bytes))).toEqual(bytes);
    expect(fromBase64("not base64 at all")).toBeNull();
    expect(fromBase64("A")).toBeNull();
  });

  it("sameBytes is true only for equal length and equal content", () => {
    expect(sameBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(true);
    expect(sameBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4]))).toBe(false);
    expect(sameBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2]))).toBe(false);
    expect(sameBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
