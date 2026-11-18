// Tests for the wins date rules: where the Home cut-off falls, and which day it is for a company.
import { describe, expect, it } from "vitest";
import { companyToday, homeCutoff } from "./wins.ts";

describe("homeCutoff", () => {
  it("has no cut-off when the company has no setting", () => expect(homeCutoff(null, "2026-11-18")).toBeNull());
  it("keeps a win for exactly its days", () => expect(homeCutoff(14, "2026-11-18")).toBe("2026-11-05"));
  it("crosses a month and a year", () => expect(homeCutoff(14, "2027-01-03")).toBe("2026-12-21"));
  it("keeps today's win when the setting is 1", () => expect(homeCutoff(1, "2026-11-18")).toBe("2026-11-18"));
  it("counts leap days", () => expect(homeCutoff(3, "2028-03-01")).toBe("2028-02-28"));
});

describe("companyToday", () => {
  it("reads the date in the company's zone, ahead of UTC", () => {
    expect(companyToday("Pacific/Kiritimati", new Date("2026-09-15T12:00:00Z"))).toBe("2026-09-16");
  });
  it("reads the date in the company's zone, behind UTC", () => {
    expect(companyToday("America/New_York", new Date("2026-09-15T02:00:00Z"))).toBe("2026-09-14");
  });
  it("does not throw on an unreadable zone", () => {
    expect(() => companyToday("Not/AZone", new Date("2026-09-15T12:00:00Z"))).not.toThrow();
    expect(companyToday("Not/AZone", new Date("2026-09-15T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
