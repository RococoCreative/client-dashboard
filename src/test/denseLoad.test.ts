// Pins the counts the dense demo load promises, so a change to the fixtures cannot quietly make
// the heavy-roster visual check lighter. Works on a copy; the shared fixtures are never touched.
import { describe, expect, it } from "vitest";
import { applyDenseLoad } from "./denseLoad.ts";
import { RBA } from "./fixtures.ts";

describe("applyDenseLoad", () => {
  it("brings a company to 22 people, 17 roles, 54 metrics and 35 role goals", () => {
    const bundle = structuredClone(RBA);
    applyDenseLoad(bundle);
    expect(bundle.profiles.filter((p) => p.is_active)).toHaveLength(22);
    expect(bundle.jobRoles.filter((r) => r.is_active)).toHaveLength(17);
    expect(bundle.roleMetrics.filter((m) => m.is_active)).toHaveLength(54);
    expect(bundle.jobRoleGoals.filter((g) => g.is_active)).toHaveLength(35);
  });
});
