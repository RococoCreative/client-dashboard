// Tenure wording, the compensation total, and the role ranking the selects offer.
import { describe, expect, it } from "vitest";
import { canGrantRole, formatTenure, grantableRoles, isCompanyAdminRole, totalAnnual } from "./people.ts";

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

describe("isCompanyAdminRole", () => {
  it("treats owners and admins as company admins", () => {
    expect(isCompanyAdminRole("owner")).toBe(true);
    expect(isCompanyAdminRole("admin")).toBe(true);
    expect(isCompanyAdminRole("manager")).toBe(false);
    expect(isCompanyAdminRole("employee")).toBe(false);
  });
});

describe("canGrantRole", () => {
  it("lets a Rococo admin grant owner", () => {
    expect(canGrantRole({ role: "employee", is_rococo_admin: true }, "owner")).toBe(true);
  });
  it("lets an owner grant every role", () => {
    const owner = { role: "owner" as const, is_rococo_admin: false };
    expect(canGrantRole(owner, "owner")).toBe(true);
    expect(canGrantRole(owner, "admin")).toBe(true);
    expect(canGrantRole(owner, "manager")).toBe(true);
    expect(canGrantRole(owner, "employee")).toBe(true);
  });
  it("lets an admin grant up to admin but never owner", () => {
    const admin = { role: "admin" as const, is_rococo_admin: false };
    expect(canGrantRole(admin, "owner")).toBe(false);
    expect(canGrantRole(admin, "admin")).toBe(true);
    expect(canGrantRole(admin, "manager")).toBe(true);
    expect(canGrantRole(admin, "employee")).toBe(true);
  });
  it("never grants above the granter's own rank", () => {
    const manager = { role: "manager" as const, is_rococo_admin: false };
    expect(canGrantRole(manager, "admin")).toBe(false);
    expect(canGrantRole(manager, "manager")).toBe(true);
    expect(canGrantRole(manager, "employee")).toBe(true);
    const employee = { role: "employee" as const, is_rococo_admin: false };
    expect(canGrantRole(employee, "manager")).toBe(false);
    expect(canGrantRole(employee, "employee")).toBe(true);
  });
});

describe("grantableRoles", () => {
  it("lists the grantable roles in label order", () => {
    expect(grantableRoles({ role: "owner", is_rococo_admin: false })).toEqual(["owner", "admin", "manager", "employee"]);
    expect(grantableRoles({ role: "admin", is_rococo_admin: false })).toEqual(["admin", "manager", "employee"]);
    expect(grantableRoles({ role: "employee", is_rococo_admin: true })).toEqual(["owner", "admin", "manager", "employee"]);
    expect(grantableRoles({ role: "employee", is_rococo_admin: false })).toEqual(["employee"]);
  });
});
