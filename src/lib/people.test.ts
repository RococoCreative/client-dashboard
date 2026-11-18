// Tenure wording, the compensation total, the role ranking the selects offer, and the app's reading
// of who leads whom and which divisions a viewer sees.
import { describe, expect, it } from "vitest";
import type { Profile, Role } from "../types/database.ts";
import {
  canGrantRole,
  canSeeDivisions,
  canSetDivisionAccess,
  canViewDivision,
  chainOf,
  directoryById,
  divisionLabel,
  formatTenure,
  grantableRoles,
  hasFullScope,
  inEveryDivision,
  isCompanyAdminRole,
  isDivisionLimited,
  isLeadRole,
  ledBy,
  nameFromDirectory,
  totalAnnual,
  viewerDivisions,
} from "./people.ts";

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

describe("canSeeDivisions", () => {
  const viewer = { role: "admin" as const, is_rococo_admin: false, can_view_divisions: false };
  it("shows the split to owners, Rococo and anyone given access, and nobody else", () => {
    expect(canSeeDivisions({ ...viewer, role: "owner" })).toBe(true);
    expect(canSeeDivisions({ ...viewer, is_rococo_admin: true })).toBe(true);
    expect(canSeeDivisions({ ...viewer, role: "employee", can_view_divisions: true })).toBe(true);
    expect(canSeeDivisions(viewer)).toBe(false);
  });
  it("lets only owners and Rococo give that access", () => {
    expect(canSetDivisionAccess({ role: "owner", is_rococo_admin: false })).toBe(true);
    expect(canSetDivisionAccess({ role: "employee", is_rococo_admin: true })).toBe(true);
    expect(canSetDivisionAccess({ role: "admin", is_rococo_admin: false })).toBe(false);
  });
});

describe("isLeadRole", () => {
  it("counts owners, admins and managers, never employees", () => {
    expect(isLeadRole("owner")).toBe(true);
    expect(isLeadRole("admin")).toBe(true);
    expect(isLeadRole("manager")).toBe(true);
    expect(isLeadRole("employee")).toBe(false);
  });
});

type Person = Pick<Profile, "id" | "reports_to" | "role">;
const person = (id: string, reports_to: string | null, role: Role = "employee"): Person => ({ id, reports_to, role });

describe("chainOf", () => {
  const people = [
    person("boss", null, "owner"),
    person("lead", "boss", "manager"),
    person("a", "lead"),
    person("b", "lead"),
    person("a1", "a"),
    person("a2", "a"),
    person("other", "boss"),
  ];

  it("walks every level below the root and leaves the root out", () => {
    expect(chainOf(people, "lead")).toEqual(new Set(["a", "b", "a1", "a2"]));
    expect(chainOf(people, "boss")).toEqual(new Set(["lead", "a", "b", "a1", "a2", "other"]));
  });

  it("is empty for someone nobody reports to, or an id nobody has", () => {
    expect(chainOf(people, "b").size).toBe(0);
    expect(chainOf(people, "missing").size).toBe(0);
  });

  it("stops at a loop instead of spinning, and never takes in the root", () => {
    const loop = [person("x", "z"), person("y", "x"), person("z", "y")];
    expect(chainOf(loop, "x")).toEqual(new Set(["y", "z"]));
  });

  it("stops after fifty levels, as the database does", () => {
    const line = Array.from({ length: 60 }, (_, i) => person(`p${i}`, i === 0 ? null : `p${i - 1}`));
    const chain = chainOf(line, "p0");
    expect(chain.size).toBe(50);
    expect(chain.has("p50")).toBe(true);
    expect(chain.has("p51")).toBe(false);
  });
});

const viewer = (role: Role, extra: Partial<Profile> = {}) => ({
  id: "me",
  role,
  is_rococo_admin: false,
  view_all_divisions: false,
  view_division_ids: [] as string[],
  ...extra,
});

describe("hasFullScope and isDivisionLimited", () => {
  it("gives full scope to owners, Rococo and admins who see every division", () => {
    expect(hasFullScope(viewer("owner"))).toBe(true);
    expect(hasFullScope(viewer("employee", { is_rococo_admin: true }))).toBe(true);
    expect(hasFullScope(viewer("admin", { view_all_divisions: true }))).toBe(true);
    expect(hasFullScope(viewer("admin"))).toBe(false);
    expect(hasFullScope(viewer("manager", { view_all_divisions: true }))).toBe(false);
    expect(hasFullScope(viewer("employee"))).toBe(false);
  });

  it("limits admins and managers without every division, and nobody else", () => {
    expect(isDivisionLimited(viewer("admin"))).toBe(true);
    expect(isDivisionLimited(viewer("manager", { view_division_ids: ["north"] }))).toBe(true);
    expect(isDivisionLimited(viewer("admin", { view_all_divisions: true }))).toBe(false);
    expect(isDivisionLimited(viewer("manager", { view_all_divisions: true }))).toBe(false);
    expect(isDivisionLimited(viewer("owner"))).toBe(false);
    expect(isDivisionLimited(viewer("admin", { is_rococo_admin: true }))).toBe(false);
    expect(isDivisionLimited(viewer("employee"))).toBe(false);
  });
});

describe("canViewDivision and viewerDivisions", () => {
  const divisions = [{ id: "south" }, { id: "north" }, { id: "east" }];

  it("lets owners and Rococo see every division", () => {
    expect(canViewDivision(viewer("owner"), "east")).toBe(true);
    expect(canViewDivision(viewer("employee", { is_rococo_admin: true }), "east")).toBe(true);
  });

  it("gives admins and managers what an owner gave them", () => {
    expect(canViewDivision(viewer("admin", { view_all_divisions: true }), "east")).toBe(true);
    expect(canViewDivision(viewer("admin", { view_division_ids: ["north"] }), "north")).toBe(true);
    expect(canViewDivision(viewer("admin", { view_division_ids: ["north"] }), "south")).toBe(false);
    expect(canViewDivision(viewer("manager", { view_division_ids: ["south"] }), "south")).toBe(true);
    expect(canViewDivision(viewer("manager"), "south")).toBe(false);
  });

  it("gives an employee none, whatever is stored", () => {
    expect(canViewDivision(viewer("employee", { view_all_divisions: true, view_division_ids: ["south"] }), "south")).toBe(false);
  });

  it("lists the divisions a viewer may pick, in the company's order", () => {
    expect(viewerDivisions(viewer("admin", { view_division_ids: ["east", "south"] }), divisions).map((d) => d.id)).toEqual(["south", "east"]);
    expect(viewerDivisions(viewer("owner"), divisions)).toHaveLength(3);
    expect(viewerDivisions(viewer("employee"), divisions)).toEqual([]);
  });
});

describe("ledBy", () => {
  const people = [
    person("me", "top", "manager"),
    person("top", null, "owner"),
    person("peer", "top", "manager"),
    person("a", "me"),
    person("a1", "a"),
    person("sub", "me", "manager"),
    person("sub1", "sub"),
    person("adminBelow", "me", "admin"),
    person("elsewhere", "peer"),
  ];
  const ids = (list: Person[]) => list.map((p) => p.id);

  it("gives owners, Rococo and full-scope admins everyone in the list", () => {
    expect(ledBy(viewer("owner"), people)).toHaveLength(people.length);
    expect(ledBy(viewer("employee", { is_rococo_admin: true }), people)).toHaveLength(people.length);
    expect(ledBy(viewer("admin", { view_all_divisions: true }), people)).toHaveLength(people.length);
  });

  it("gives a division-limited admin the people ranked below them that the database showed them", () => {
    // me (manager), top (owner), peer (manager), adminBelow (admin): the owner and a fellow admin
    // are seen at most, never led (0038 manageable_person_ids).
    expect(ids(ledBy(viewer("admin"), people))).toEqual(["me", "peer", "a", "a1", "sub", "sub1", "elsewhere"]);
  });

  it("gives a manager their chain below them, minus anyone ranked at or above a manager", () => {
    expect(ids(ledBy(viewer("manager"), people))).toEqual(["a", "a1", "sub1"]);
  });

  it("walks through a manager under a manager to the employee below, and leads only the employee", () => {
    // Harper (manager) > Sam (manager) > Lee (employee).
    const chain = [person("harper", "owner1", "manager"), person("sam", "harper", "manager"), person("lee", "sam")];
    expect(ids(ledBy(viewer("manager", { id: "harper" }), chain))).toEqual(["lee"]);
    // Sam leads Lee too, and nobody above.
    expect(ids(ledBy(viewer("manager", { id: "sam" }), chain))).toEqual(["lee"]);
  });

  it("gives an employee nobody, even when someone reports to them", () => {
    expect(ledBy(viewer("employee"), [person("me", null), person("x", "me")])).toEqual([]);
  });
});

describe("divisionLabel and inEveryDivision", () => {
  const two = [
    { id: "south", name: "RBA South" },
    { id: "north", name: "RBA North" },
  ];
  const three = [...two, { id: "east", name: "RBA East" }];

  it("names one division", () => {
    expect(divisionLabel(["north"], two)).toBe("RBA North");
  });

  it("reads every division of a two-division company as Both", () => {
    expect(divisionLabel(["north", "south"], two)).toBe("Both");
    expect(inEveryDivision(["north", "south"], two)).toBe(true);
  });

  it("reads every division of a larger company as All divisions", () => {
    expect(divisionLabel(["east", "north", "south"], three)).toBe("All divisions");
  });

  it("lists some of several in the company's order", () => {
    expect(divisionLabel(["east", "north"], three)).toBe("RBA North, RBA East");
    expect(inEveryDivision(["east", "north"], three)).toBe(false);
  });

  it("reads no division, or only unknown ones, as No division", () => {
    expect(divisionLabel([], two)).toBe("No division");
    expect(divisionLabel(["gone"], two)).toBe("No division");
  });

  it("has no Both at a company with one division", () => {
    const one = [{ id: "solo", name: "Main" }];
    expect(divisionLabel(["solo"], one)).toBe("Main");
    expect(inEveryDivision(["solo"], one)).toBe(false);
  });
});

describe("nameFromDirectory", () => {
  const directory = directoryById([
    { id: "a", full_name: "Casey Lin" },
    { id: "b", full_name: null },
    { id: "c", full_name: "   " },
  ]);

  it("reads a name, and Unnamed for someone with none yet", () => {
    expect(nameFromDirectory(directory, "a", "Hub admin")).toBe("Casey Lin");
    expect(nameFromDirectory(directory, "b", "Hub admin")).toBe("Unnamed");
    expect(nameFromDirectory(directory, "c", "Hub admin")).toBe("Unnamed");
  });

  it("falls back for someone not in it, or no one", () => {
    expect(nameFromDirectory(directory, "z", "Hub admin")).toBe("Hub admin");
    expect(nameFromDirectory(directory, null, "Unassigned")).toBe("Unassigned");
  });
});
