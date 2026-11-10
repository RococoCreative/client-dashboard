// Pins the sidebar registry. Every company reads the same sections (Home, Sales & Finance,
// Production, People, Resources, then My GSR and Settings at the bottom) and a module adds or hides
// whole items, so the sidebar for each audience is written out here in full: an admin and an
// employee of a company with no modules, of one with every module, and a Rococo admin inside each.
import { describe, expect, it } from "vitest";
import { BookOpen, Building2, CalendarCheck, ChartColumn, CircleDollarSign, ClipboardCheck, ExternalLink, FolderOpen, Gauge, HardHat, History, LayoutDashboard, LayoutGrid, Megaphone, Settings, ShieldCheck, Target, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Company } from "../types/database.ts";
import { KINGDOM, KLASIK, RBA } from "../test/fixtures.ts";
import { NAV_GROUP_ORDER, NAV_ITEMS, PORTFOLIO_NAV, alsoActiveFor, navFor, sectionShortcuts, type NavItem, type NavLayout } from "./navigation.ts";

interface Expected { to: string; label: string; icon: LucideIcon; end?: boolean }
type Sections = Array<[string | null, Expected[]]>;

const HOME: Expected = { to: "/", label: "Home", icon: LayoutDashboard, end: true };
const WINS: Expected = { to: "/wins", label: "Wins", icon: Trophy };
const REPORTING: Expected = { to: "/sales-finance", label: "Reporting", icon: ChartColumn, end: true };
const CONTROLS: Expected = { to: "/sales-finance/controls", label: "Controls", icon: ShieldCheck };
const FINANCIALS: Expected = { to: "/financials", label: "Financials", icon: CircleDollarSign };
const MARKETING: Expected = { to: "/marketing", label: "Marketing", icon: Megaphone };
const PROJECTS: Expected = { to: "/production", label: "Projects", icon: HardHat };
const PEOPLE: Expected = { to: "/people", label: "People", icon: Users };
const GOALS: Expected = { to: "/goals", label: "Goals", icon: Target };
const GSRS: Expected = { to: "/gsr", label: "Monthly GSRs", icon: CalendarCheck };
const REVIEWS: Expected = { to: "/reviews", label: "Reviews", icon: ClipboardCheck };
const SCORECARDS: Expected = { to: "/scorecards", label: "Scorecards", icon: Gauge };
const MY_GSR: Expected = { to: "/my/gsr", label: "My GSR", icon: CalendarCheck };
const MY_REVIEWS: Expected = { to: "/my/reviews", label: "My Reviews", icon: ClipboardCheck };
const MY_GOALS: Expected = { to: "/my/goals", label: "My Goals", icon: Target };
const SOPS: Expected = { to: "/resources/sops", label: "SOPs", icon: BookOpen };
const FILES: Expected = { to: "/resources/files", label: "Files & media", icon: FolderOpen };
const LINKS: Expected = { to: "/resources/links", label: "Links", icon: ExternalLink };
const MY_GSR_ADMIN: Expected = { to: "/my/gsr", label: "My GSR", icon: UserRound };
const SETTINGS: Expected = { to: "/settings", label: "Settings", icon: Settings };

// A company with no modules on (Klasik and RBA in the fixtures).
const PLAIN_ADMIN: Sections = [
  [null, [HOME]],
  ["Sales & Finance", [FINANCIALS, MARKETING]],
  ["People", [PEOPLE, GOALS, GSRS, REVIEWS, SCORECARDS]],
  ["Resources", [SOPS, FILES]],
  [null, [MY_GSR_ADMIN, SETTINGS]],
];
const PLAIN_EMPLOYEE: Sections = [
  [null, [HOME]],
  ["My development", [MY_GSR, MY_REVIEWS, MY_GOALS]],
  ["Resources", [SOPS, FILES]],
];
const PLAIN_ROCOCO: Sections = [...PLAIN_ADMIN.slice(0, 4), [null, [SETTINGS]]];

// A company with every module on (Kingdom in the fixtures).
const FULL_ADMIN: Sections = [
  [null, [HOME, WINS]],
  ["Sales & Finance", [REPORTING, CONTROLS, FINANCIALS, MARKETING]],
  ["Production", [PROJECTS]],
  ["People", [PEOPLE, GOALS, GSRS, REVIEWS, SCORECARDS]],
  ["Resources", [SOPS, FILES, LINKS]],
  [null, [MY_GSR_ADMIN, SETTINGS]],
];
const FULL_EMPLOYEE: Sections = [
  [null, [HOME, WINS]],
  ["Production", [PROJECTS]],
  ["My development", [MY_GSR, MY_REVIEWS, MY_GOALS]],
  ["Resources", [SOPS, FILES, LINKS]],
];
const FULL_ROCOCO: Sections = [...FULL_ADMIN.slice(0, 5), [null, [SETTINGS]]];

const PORTFOLIO: Expected[] = [
  { to: "/rococo", label: "Portfolio", icon: LayoutGrid, end: true },
  { to: "/rococo/companies", label: "Companies", icon: Building2 },
  { to: "/rococo/people", label: "People", icon: Users },
  { to: "/rococo/activity", label: "Activity", icon: History },
];

function shape(items: readonly (Expected | NavItem)[]) {
  return items.map(({ to, label, icon, end }) => ({ to, label, icon, end: Boolean(end) }));
}

function sectionsOf(layout: NavLayout) {
  if (layout.kind !== "grouped") throw new Error("Expected a grouped layout");
  return layout.sections;
}

function read(layout: NavLayout) {
  return sectionsOf(layout).map((s) => [s.heading, shape(s.items)]);
}

function expected(sections: Sections) {
  return sections.map(([heading, items]) => [heading, shape(items)]);
}

const klasik: Company = KLASIK.company;
const rba: Company = RBA.company;
const kingdom: Company = KINGDOM.company;

describe("navFor for a company with no modules", () => {
  it("gives a Klasik admin the sections with the standard items", () => {
    expect(read(navFor(klasik, true, false))).toEqual(expected(PLAIN_ADMIN));
  });

  it("gives a Klasik employee Home, their own pages and Resources", () => {
    expect(read(navFor(klasik, false, false))).toEqual(expected(PLAIN_EMPLOYEE));
  });

  it("gives a Rococo admin inside Klasik the admin sidebar without My GSR", () => {
    expect(read(navFor(klasik, true, true))).toEqual(expected(PLAIN_ROCOCO));
  });

  it("gives RBA the same three sidebars, since its modules are the same", () => {
    expect(read(navFor(rba, true, false))).toEqual(expected(PLAIN_ADMIN));
    expect(read(navFor(rba, false, false))).toEqual(expected(PLAIN_EMPLOYEE));
    expect(read(navFor(rba, true, true))).toEqual(expected(PLAIN_ROCOCO));
  });

  it("ignores an unknown module key entirely", () => {
    const future = { ...klasik, modules: ["future"] };
    expect(read(navFor(future, true, false))).toEqual(expected(PLAIN_ADMIN));
    expect(read(navFor(future, false, false))).toEqual(expected(PLAIN_EMPLOYEE));
  });
});

describe("navFor for a company with every module", () => {
  it("gives a Kingdom admin every section", () => {
    expect(read(navFor(kingdom, true, false))).toEqual(expected(FULL_ADMIN));
  });

  it("gives a Kingdom employee no Sales & Finance", () => {
    expect(read(navFor(kingdom, false, false))).toEqual(expected(FULL_EMPLOYEE));
  });

  it("drops My GSR for a Rococo admin inside Kingdom", () => {
    expect(read(navFor(kingdom, true, true))).toEqual(expected(FULL_ROCOCO));
  });
});

describe("each module adds only its own items", () => {
  const without = (sections: Sections, drop: Expected[]) =>
    sections.map(([h, items]): [string | null, Expected[]] => [h, items.filter((i) => !drop.includes(i))]).filter(([, items]) => items.length > 0);

  it.each([
    ["wins", [WINS]],
    ["production", [PROJECTS]],
    ["data_sources", [REPORTING, CONTROLS]],
    ["external_links", [LINKS]],
  ] as const)("%s adds %j and nothing else", (module, items) => {
    const company = { ...klasik, modules: [module] };
    const others = [WINS, PROJECTS, REPORTING, CONTROLS, LINKS].filter((i) => !(items as readonly Expected[]).includes(i));
    expect(read(navFor(company, true, false))).toEqual(expected(without(FULL_ADMIN, others)));
    expect(read(navFor(company, false, false))).toEqual(expected(without(FULL_EMPLOYEE, others)));
  });

  it("switchboard changes nothing in the sidebar: every company has the sections", () => {
    const company = { ...klasik, modules: ["switchboard"] };
    expect(read(navFor(company, true, false))).toEqual(expected(PLAIN_ADMIN));
    expect(read(navFor(company, false, false))).toEqual(expected(PLAIN_EMPLOYEE));
  });
});

describe("PORTFOLIO_NAV", () => {
  it("is the portfolio, companies, people and activity", () => {
    expect(shape(PORTFOLIO_NAV)).toEqual(shape(PORTFOLIO));
  });
});

describe("alsoActiveFor", () => {
  const sops = NAV_ITEMS.find((i) => i.id === "sops")!;
  const files = NAV_ITEMS.find((i) => i.id === "files")!;

  it("keeps SOPs marked on an SOP's own pages, and nothing else", () => {
    expect(alsoActiveFor(sops, "/sops/sop-1")).toBe(true);
    expect(alsoActiveFor(sops, "/sops/sop-1/edit")).toBe(true);
    expect(alsoActiveFor(sops, "/sops/new")).toBe(true);
    expect(alsoActiveFor(sops, "/sopsx")).toBe(false);
    expect(alsoActiveFor(files, "/sops/sop-1")).toBe(false);
  });
});

describe("sectionShortcuts", () => {
  it("points at each working section's first page, except Home and the bottom group", () => {
    expect(sectionShortcuts(navFor(kingdom, true, false))).toEqual([
      { group: "sales_finance", heading: "Sales & Finance", to: "/sales-finance" },
      { group: "production", heading: "Production", to: "/production" },
      { group: "people_hr", heading: "People", to: "/people" },
      { group: "resources", heading: "Resources", to: "/resources/sops" },
    ]);
    expect(sectionShortcuts(navFor(kingdom, false, false))).toEqual([
      { group: "production", heading: "Production", to: "/production" },
      { group: "people_hr", heading: "My development", to: "/my/gsr" },
      { group: "resources", heading: "Resources", to: "/resources/sops" },
    ]);
  });

  it("is empty for the flat portfolio layout", () => {
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
