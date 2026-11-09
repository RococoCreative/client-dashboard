// Pins the sidebar registry. Today's three nav arrays are copied here from AppLayout as they were
// before the registry replaced them, so a company without the switchboard module is proven to see
// exactly the sidebar it always had, and the four-section layout is pinned for one that has it.
import { describe, expect, it } from "vitest";
import { BookOpen, Building2, CalendarCheck, CircleDollarSign, ClipboardCheck, FolderOpen, History, LayoutDashboard, LayoutGrid, Megaphone, Settings, Target, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Company } from "../types/database.ts";
import { KINGDOM, KLASIK, RBA } from "../test/fixtures.ts";
import { NAV_GROUP_ORDER, NAV_ITEMS, PORTFOLIO_NAV, navFor, sectionShortcuts, type NavItem, type NavLayout } from "./navigation.ts";

interface TodayItem { to: string; label: string; icon: LucideIcon; end?: boolean }

const TODAY_ADMIN: TodayItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/gsr", label: "GSRs", icon: CalendarCheck },
  { to: "/reviews", label: "Reviews", icon: ClipboardCheck },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/people", label: "People", icon: Users },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/resources", label: "Resources", icon: FolderOpen },
  { to: "/financials", label: "Financials", icon: CircleDollarSign },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/my/gsr", label: "My GSR", icon: UserRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

const TODAY_PORTFOLIO: TodayItem[] = [
  { to: "/rococo", label: "Portfolio", icon: LayoutGrid, end: true },
  { to: "/rococo/companies", label: "Companies", icon: Building2 },
  { to: "/rococo/people", label: "People", icon: Users },
];

// The portfolio sidebar is today's three plus the Activity page (0025).
const PORTFOLIO: TodayItem[] = [...TODAY_PORTFOLIO, { to: "/rococo/activity", label: "Activity", icon: History, end: false }];

const TODAY_EMPLOYEE: TodayItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/my/gsr", label: "My GSR", icon: CalendarCheck },
  { to: "/my/reviews", label: "My Reviews", icon: ClipboardCheck },
  { to: "/my/goals", label: "My Goals", icon: Target },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/resources", label: "Resources", icon: FolderOpen },
];

function shape(items: readonly (TodayItem | NavItem)[]) {
  return items.map(({ to, label, icon, end }) => ({ to, label, icon, end: Boolean(end) }));
}

function flatItems(layout: NavLayout): NavItem[] {
  if (layout.kind !== "flat") throw new Error("Expected a flat layout");
  return layout.items;
}

function sections(layout: NavLayout) {
  if (layout.kind !== "grouped") throw new Error("Expected a grouped layout");
  return layout.sections;
}

function labelsOf(layout: NavLayout, heading: string | null): string[] | undefined {
  return sections(layout).find((s) => s.heading === heading)?.items.map((i) => i.label);
}

const klasik: Company = KLASIK.company;
const rba: Company = RBA.company;
const kingdom: Company = KINGDOM.company;
const withoutRococoMy = TODAY_ADMIN.filter((i) => i.to !== "/my/gsr");

describe("navFor without the switchboard module", () => {
  it("gives a Klasik admin today's admin sidebar", () => {
    expect(shape(flatItems(navFor(klasik, true, false)))).toEqual(shape(TODAY_ADMIN));
  });

  it("gives a Klasik employee today's employee sidebar", () => {
    expect(shape(flatItems(navFor(klasik, false, false)))).toEqual(shape(TODAY_EMPLOYEE));
  });

  it("gives a Rococo admin inside Klasik today's admin sidebar without My GSR", () => {
    expect(shape(flatItems(navFor(klasik, true, true)))).toEqual(shape(withoutRococoMy));
  });

  it("gives RBA the same three sidebars", () => {
    expect(shape(flatItems(navFor(rba, true, false)))).toEqual(shape(TODAY_ADMIN));
    expect(shape(flatItems(navFor(rba, false, false)))).toEqual(shape(TODAY_EMPLOYEE));
    expect(shape(flatItems(navFor(rba, true, true)))).toEqual(shape(withoutRococoMy));
  });

  it("stays flat with other modules on, and their gated items are all that differ", () => {
    const others = { ...klasik, modules: ["wins", "production", "data_sources", "external_links"] };
    const ungated = (layout: NavLayout) => flatItems(layout).filter((i) => !i.requires);
    expect(shape(ungated(navFor(others, true, false)))).toEqual(shape(TODAY_ADMIN));
    expect(shape(ungated(navFor(others, false, false)))).toEqual(shape(TODAY_EMPLOYEE));
    expect(shape(ungated(navFor(others, true, true)))).toEqual(shape(withoutRococoMy));
  });

  it("ignores an unknown key entirely", () => {
    const future = { ...klasik, modules: ["future"] };
    expect(shape(flatItems(navFor(future, true, false)))).toEqual(shape(TODAY_ADMIN));
    expect(shape(flatItems(navFor(future, false, false)))).toEqual(shape(TODAY_EMPLOYEE));
    expect(shape(flatItems(navFor(future, true, true)))).toEqual(shape(withoutRococoMy));
  });
});

describe("PORTFOLIO_NAV", () => {
  it("is today's portfolio sidebar plus Activity", () => {
    expect(shape(PORTFOLIO_NAV)).toEqual(shape(PORTFOLIO));
  });
});

describe("navFor with the switchboard module", () => {
  it("groups a Kingdom admin's sidebar into sections", () => {
    const layout = navFor(kingdom, true, false);
    expect(sections(layout).map((s) => s.heading)).toEqual(["Home", "Sales & Finance", "People / HR", null]);
    expect(labelsOf(layout, "Home")).toEqual(["Home"]);
    expect(labelsOf(layout, "Sales & Finance")).toEqual(["Financials", "Marketing"]);
    expect(labelsOf(layout, "People / HR")).toEqual(["GSRs", "Reviews", "Goals", "People", "My GSR"]);
    expect(labelsOf(layout, null)).toEqual(["SOPs", "Resources", "Settings"]);
    expect(labelsOf(layout, "Production")).toBeUndefined();
  });

  it("groups a Kingdom employee's sidebar without Sales & Finance", () => {
    const layout = navFor(kingdom, false, false);
    expect(sections(layout).map((s) => s.heading)).toEqual(["Home", "People / HR", null]);
    expect(labelsOf(layout, "People / HR")).toEqual(["My GSR", "My Reviews", "My Goals"]);
    expect(labelsOf(layout, null)).toEqual(["SOPs", "Resources"]);
  });

  it("drops My GSR for a Rococo admin inside Kingdom", () => {
    const layout = navFor(kingdom, true, true);
    expect(sections(layout).map((s) => s.heading)).toEqual(["Home", "Sales & Finance", "People / HR", null]);
    expect(labelsOf(layout, "Home")).toEqual(["Home"]);
    expect(labelsOf(layout, "Sales & Finance")).toEqual(["Financials", "Marketing"]);
    expect(labelsOf(layout, "People / HR")).toEqual(["GSRs", "Reviews", "Goals", "People"]);
    expect(labelsOf(layout, null)).toEqual(["SOPs", "Resources", "Settings"]);
  });
});

describe("sectionShortcuts", () => {
  it("points at each section's first page, except Home and the utility group", () => {
    expect(sectionShortcuts(navFor(kingdom, true, false))).toEqual([
      { group: "sales_finance", heading: "Sales & Finance", to: "/financials" },
      { group: "people_hr", heading: "People / HR", to: "/gsr" },
    ]);
    expect(sectionShortcuts(navFor(kingdom, false, false))).toEqual([{ group: "people_hr", heading: "People / HR", to: "/my/gsr" }]);
  });

  it("is empty for a flat layout", () => {
    expect(sectionShortcuts(navFor(klasik, true, false))).toEqual([]);
    expect(sectionShortcuts(navFor(klasik, false, false))).toEqual([]);
    expect(sectionShortcuts({ kind: "flat", items: [...PORTFOLIO_NAV] })).toEqual([]);
  });
});

describe("NAV_ITEMS", () => {
  it("has unique ids and only known groups", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of NAV_ITEMS) expect(NAV_GROUP_ORDER).toContain(item.group);
  });
});
