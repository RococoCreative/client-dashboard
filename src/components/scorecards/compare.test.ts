// Pins how the compare strip groups people now that a person can work in several divisions: they
// count in each of their divisions and once in the whole, the unplaced get their own group only
// when there are some, and a viewer limited to some divisions reads the whole under their label.
import { describe, expect, it } from "vitest";
import type { CompanyDivision, Profile } from "../../types/database.ts";
import { RBA } from "../../test/fixtures.ts";
import { COMBINED, NO_DIVISION, divisionCompareRows, peopleInScope } from "./compare.ts";

const base = RBA.profiles[0];
const person = (id: string, division_ids: string[], extra: Partial<Profile> = {}): Profile => ({
  ...base,
  id,
  full_name: id,
  job_role_id: null,
  division_ids,
  division_id: division_ids.length === 1 ? division_ids[0] : null,
  is_active: true,
  ...extra,
});
const division = (id: string, name: string, sort_order: number): CompanyDivision => ({ id, name, sort_order, company_id: base.company_id!, created_at: "", updated_at: "" });

const south = division("south", "South", 1);
const north = division("north", "North", 2);
const people = [person("s1", ["south"]), person("n1", ["north"]), person("both", ["south", "north"]), person("none", []), person("gone", ["south"], { is_active: false })];

describe("peopleInScope", () => {
  it("puts someone in both divisions in each one, and everyone once in Combined", () => {
    expect(peopleInScope(people, COMBINED).map((p) => p.id)).toEqual(["s1", "n1", "both", "none", "gone"]);
    expect(peopleInScope(people, "south").map((p) => p.id)).toEqual(["s1", "both", "gone"]);
    expect(peopleInScope(people, "north").map((p) => p.id)).toEqual(["n1", "both"]);
  });

  it("finds the people with no division", () => {
    expect(peopleInScope(people, NO_DIVISION).map((p) => p.id)).toEqual(["none"]);
  });
});

describe("divisionCompareRows", () => {
  const input = { divisions: [south, north], metrics: [], entries: [], month: "2026-09-01", cycle: null, reviews: [], omissions: [] };

  it("counts active people per division, the Both person in each and once in the whole", () => {
    const rows = divisionCompareRows({ ...input, people });
    expect(rows.map((r) => [r.key, r.label, r.people])).toEqual([
      [COMBINED, "Combined", 4],
      ["south", "South", 2],
      ["north", "North", 2],
      [NO_DIVISION, "No division", 1],
    ]);
  });

  it("leaves out the No division group when everyone is placed", () => {
    const rows = divisionCompareRows({ ...input, people: people.filter((p) => p.id !== "none") });
    expect(rows.map((r) => r.key)).toEqual([COMBINED, "south", "north"]);
  });

  it("labels the whole for a viewer who sees only some divisions", () => {
    const rows = divisionCompareRows({ ...input, divisions: [north], people, combinedLabel: "In your divisions" });
    expect(rows[0]).toMatchObject({ key: COMBINED, label: "In your divisions", people: 4 });
    expect(rows.map((r) => r.key)).toEqual([COMBINED, "north", NO_DIVISION]);
  });
});
