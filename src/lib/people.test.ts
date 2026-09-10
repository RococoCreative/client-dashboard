// Tenure wording and the compensation total.
import { describe, expect, it } from "vitest";
import { formatTenure, totalAnnual } from "./people.ts";

describe("formatTenure", () => {
  const today = new Date(2026, 8, 10);
  it("counts whole months and years", () => {
    expect(formatTenure("2026-05-26", today)).toBe("3 months");
    expect(formatTenure("2023-09-01", today)).toBe("3 years");
    expect(formatTenure("2025-06-20", today)).toBe("1 year, 2 months");
  });
  it("handles the edges", () => {
    expect(formatTenure("2026-09-01", today)).toBe("Less than a month");
    expect(formatTenure("2026-10-01", today)).toMatch(/^Starts /);
    expect(formatTenure(null, today)).toBeNull();
  });
});

describe("totalAnnual", () => {
  it("sums the annual amounts and ignores bad numbers", () => {
    expect(totalAnnual([{ annual_amount: 75000 }, { annual_amount: 2400 }, { annual_amount: 360 }, { annual_amount: Number.NaN }])).toBe(77760);
  });
});
