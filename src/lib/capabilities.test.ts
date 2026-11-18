// Pins the capability rules: catalog defaults, company overrides, the role ranking, the rococo
// level no company role reaches, and the refusal of a capability that did not load.
import { describe, expect, it } from "vitest";
import { meets, resolveCapabilities } from "./capabilities.ts";
import type { Capability } from "../types/database.ts";

const catalog: Capability[] = [
  { key: "pay", default_min_role: "admin", sort_order: 1 },
  { key: "audit_log", default_min_role: "rococo", sort_order: 3 },
  { key: "production_view", default_min_role: "employee", sort_order: 7 },
];

describe("capabilities", () => {
  it("uses the catalog default when a company has no row", () => {
    expect(resolveCapabilities(catalog, []).pay).toBe("admin");
  });
  it("lets a company's row win", () => {
    expect(resolveCapabilities(catalog, [{ id: "r1", company_id: "c1", capability: "pay", min_role: "owner" }]).pay).toBe("owner");
  });
  it("ranks roles employee, manager, admin, owner", () => {
    expect(meets("admin", false, "owner")).toBe(false);
    expect(meets("owner", false, "owner")).toBe(true);
    expect(meets("manager", false, "employee")).toBe(true);
  });
  it("never lets a company role meet the rococo level", () => {
    expect(meets("owner", false, "rococo")).toBe(false);
  });
  it("lets a Rococo admin through everything", () => {
    expect(meets("employee", true, "rococo")).toBe(true);
  });
  it("refuses a capability that did not load", () => {
    expect(meets("owner", false, undefined)).toBe(false);
  });
});
