// Proves how an imported value reads on screen: each field type formatted the house way, a blank
// as a hyphen and never a zero, a real zero kept as zero, and text that is not a number left as
// it came rather than coerced.
import { describe, expect, it } from "vitest";
import { FIELD_TYPES } from "../../../supabase/functions/_shared/sync/types.ts";
import { formatAge, formatMappedValue } from "./format.ts";

describe("formatMappedValue", () => {
  it("formats money to whole dollars", () => {
    expect(formatMappedValue(250000, "currency")).toBe("$250,000");
    expect(formatMappedValue(-1200.4, "currency")).toBe("-$1,200");
  });

  it("keeps a real zero as zero", () => {
    expect(formatMappedValue(0, "currency")).toBe("$0");
  });

  it("renders a blank as a hyphen for every type", () => {
    for (const type of FIELD_TYPES) expect(formatMappedValue(null, type)).toBe("-");
    expect(formatMappedValue("", "text")).toBe("-");
  });

  it("formats percent, number and date", () => {
    expect(formatMappedValue(0.256, "percent")).toBe("25.6%");
    expect(formatMappedValue(1234.5678, "number")).toBe("1,234.57");
    expect(formatMappedValue("2026-08-14", "date")).toBe("Aug 14, 2026");
  });

  it("shows text as it came, numbers stringified", () => {
    expect(formatMappedValue("Sample job 101", "text")).toBe("Sample job 101");
    expect(formatMappedValue(42, "text")).toBe("42");
  });

  it("shows a non-number in a numeric type as its raw text, never 0", () => {
    expect(formatMappedValue("n/a", "currency")).toBe("n/a");
  });
});

describe("formatAge", () => {
  it("reads under an hour, then hours, then days", () => {
    expect(formatAge(0.5)).toBe("less than an hour");
    expect(formatAge(1)).toBe("1 hour");
    expect(formatAge(47.9)).toBe("47 hours");
    expect(formatAge(50)).toBe("2 days");
  });
});
