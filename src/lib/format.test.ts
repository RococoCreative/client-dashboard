import { describe, expect, it } from "vitest";
import { displayName, formatMoney, formatPercent, formatPeriod, initials, parseDate } from "./format.ts";

describe("format", () => {
  it("formats money and percentages with a hyphen for empties", () => {
    expect(formatMoney(1240000)).toBe("$1,240,000");
    expect(formatMoney(1240000, true)).toBe("$1.2M");
    expect(formatMoney(null)).toBe("-");
    expect(formatPercent(0.427)).toBe("43%");
    expect(formatPercent(null)).toBe("-");
  });

  it("parses date-only strings in local time", () => {
    const date = parseDate("2026-09-01");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(1);
    expect(parseDate("garbage")).toBeNull();
  });

  it("formats periods with the year once when shared", () => {
    expect(formatPeriod("2026-09-01", "2026-09-30")).toBe("Sep 1 to Sep 30, 2026");
    expect(formatPeriod("2026-12-01", "2027-01-31")).toBe("Dec 1, 2026 to Jan 31, 2027");
  });

  it("derives names and initials", () => {
    expect(displayName({ full_name: " Jeff Klasik ", email: "j@x.com" })).toBe("Jeff Klasik");
    expect(displayName({ full_name: null, email: "j@x.com" })).toBe("j@x.com");
    expect(initials({ full_name: "Jeff Klasik", email: "j@x.com" })).toBe("JK");
    expect(initials({ full_name: "Cher", email: "c@x.com" })).toBe("C");
    expect(initials({ full_name: null, email: "jk@x.com" })).toBe("JK");
  });
});
