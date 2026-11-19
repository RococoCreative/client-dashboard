// Pins the capability rules: catalog defaults, company overrides, the role ranking, the rococo
// level no company role reaches, and the refusal of a capability that did not load.
import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, CAPABILITY_LABELS, LEVEL_LABELS, allowedLevels, meets, resolveCapabilities } from "./capabilities.ts";
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

describe("labels and allowed levels", () => {
  it("names every capability", () => {
    expect(CAPABILITY_LABELS).toEqual({
      pay: "See pay",
      company_settings: "Change company settings",
      audit_log: "Read the change log",
      milestones_edit: "Edit milestones",
      wins_post: "Record wins",
      sync_run: "Press Sync now",
      production_view: "Open Production",
    });
    for (const key of CAPABILITY_KEYS) expect(CAPABILITY_LABELS[key]).toBeTruthy();
  });
  it("names every level", () => {
    expect(LEVEL_LABELS).toEqual({
      employee: "Everyone",
      manager: "Managers and up",
      admin: "Admins and owners",
      owner: "Owners only",
      rococo: "Rococo only",
    });
  });
  it("lists the levels each capability may take, lowest first", () => {
    expect(allowedLevels("pay")).toEqual(["admin", "owner"]);
    expect(allowedLevels("company_settings")).toEqual(["admin", "owner"]);
    expect(allowedLevels("audit_log")).toEqual(["admin", "owner", "rococo"]);
    expect(allowedLevels("milestones_edit")).toEqual(["employee", "manager", "admin", "owner"]);
    expect(allowedLevels("wins_post")).toEqual(["employee", "manager", "admin", "owner"]);
    expect(allowedLevels("sync_run")).toEqual(["employee", "manager", "admin"]);
    expect(allowedLevels("production_view")).toEqual(["employee", "manager", "admin", "owner"]);
  });
  it("keeps every catalog default inside its allowed list", () => {
    const defaults = { pay: "admin", company_settings: "admin", audit_log: "rococo", milestones_edit: "admin", wins_post: "admin", sync_run: "admin", production_view: "employee" } as const;
    for (const key of CAPABILITY_KEYS) expect(allowedLevels(key)).toContain(defaults[key]);
  });
});
