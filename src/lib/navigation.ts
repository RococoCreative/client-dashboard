// The sidebar registry. Every company nav item lives here once, with who sees it, the section it
// belongs to, and the module it needs, so the sidebar is the same code for every company and only
// its data differs. Every company reads the same sections: Home, Sales & Finance, Production,
// People, Resources, then My GSR and Settings at the bottom. A module adds or hides whole items
// (Wins, Tasks, Reporting, Controls, Projects, Links), never a company name.
import type { LucideIcon } from "lucide-react";
import { BookOpen, Building2, CalendarCheck, ChartColumn, CircleDollarSign, ClipboardCheck, ExternalLink, FolderOpen, Gauge, HardHat, History, LayoutDashboard, LayoutGrid, ListChecks, Megaphone, Settings, ShieldCheck, Target, Trophy, UserRound, Users } from "lucide-react";
import type { Company, LinkNavGroup } from "../types/database.ts";
import { hasModule, type ModuleKey } from "./modules.ts";

export type NavGroup = LinkNavGroup | "resources" | "utility";
export type NavAudience = "admin" | "employee" | "both";

export interface NavItem {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  audience: NavAudience;
  group: NavGroup;
  // The module a company needs on for this item to show at all.
  requires?: ModuleKey;
  // Other paths that belong to this item, so it stays marked there too (an SOP opened from the
  // SOPs tab lives at /sops/:id).
  alsoActive?: readonly string[];
}

export const NAV_GROUP_ORDER: readonly NavGroup[] = ["home", "sales_finance", "production", "people_hr", "resources", "utility"];

// Section headings. Home and the bottom group carry none: Home is the first thing in the bar and
// the bottom group is set off by a hairline.
export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = {
  home: null,
  sales_finance: "Sales & Finance",
  production: "Production",
  people_hr: "People",
  resources: "Resources",
  utility: null,
};

// An employee's People section holds only their own pages, so it reads as theirs.
const EMPLOYEE_GROUP_LABELS: Partial<Record<NavGroup, string>> = { people_hr: "My development" };

// Registry order is each section's order.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", to: "/", label: "Home", icon: LayoutDashboard, end: true, audience: "both", group: "home" },
  { id: "wins", to: "/wins", label: "Wins", icon: Trophy, audience: "both", group: "home", requires: "wins" },
  { id: "tasks", to: "/tasks", label: "Tasks", icon: ListChecks, audience: "both", group: "home", requires: "tasks" },
  { id: "sales-reporting", to: "/sales-finance", label: "Reporting", icon: ChartColumn, end: true, audience: "admin", group: "sales_finance", requires: "data_sources" },
  { id: "controls", to: "/sales-finance/controls", label: "Controls", icon: ShieldCheck, audience: "admin", group: "sales_finance", requires: "data_sources" },
  { id: "financials", to: "/financials", label: "Financials", icon: CircleDollarSign, audience: "admin", group: "sales_finance" },
  { id: "marketing", to: "/marketing", label: "Marketing", icon: Megaphone, audience: "admin", group: "sales_finance" },
  { id: "projects", to: "/production", label: "Projects", icon: HardHat, audience: "both", group: "production", requires: "production" },
  { id: "people", to: "/people", label: "People", icon: Users, audience: "admin", group: "people_hr" },
  { id: "goals", to: "/goals", label: "Goals", icon: Target, audience: "admin", group: "people_hr" },
  { id: "gsr", to: "/gsr", label: "Monthly GSRs", icon: CalendarCheck, audience: "admin", group: "people_hr" },
  { id: "reviews", to: "/reviews", label: "Reviews", icon: ClipboardCheck, audience: "admin", group: "people_hr" },
  { id: "scorecards", to: "/scorecards", label: "Scorecards", icon: Gauge, audience: "admin", group: "people_hr" },
  { id: "my-gsr-employee", to: "/my/gsr", label: "My GSR", icon: CalendarCheck, audience: "employee", group: "people_hr" },
  { id: "my-reviews", to: "/my/reviews", label: "My Reviews", icon: ClipboardCheck, audience: "employee", group: "people_hr" },
  { id: "my-goals", to: "/my/goals", label: "My Goals", icon: Target, audience: "employee", group: "people_hr" },
  { id: "sops", to: "/resources/sops", label: "SOPs", icon: BookOpen, audience: "both", group: "resources", alsoActive: ["/sops"] },
  { id: "files", to: "/resources/files", label: "Files & media", icon: FolderOpen, audience: "both", group: "resources" },
  { id: "links", to: "/resources/links", label: "Links", icon: ExternalLink, audience: "both", group: "resources", requires: "external_links" },
  { id: "my-gsr-admin", to: "/my/gsr", label: "My GSR", icon: UserRound, audience: "admin", group: "utility" },
  { id: "settings", to: "/settings", label: "Settings", icon: Settings, audience: "admin", group: "utility" },
];

// The Rococo portfolio's own sidebar, always flat. Audience and group are unused there.
export const PORTFOLIO_NAV: readonly NavItem[] = [
  { id: "portfolio", to: "/rococo", label: "Portfolio", icon: LayoutGrid, end: true, audience: "both", group: "utility" },
  { id: "companies", to: "/rococo/companies", label: "Companies", icon: Building2, audience: "both", group: "utility" },
  { id: "rococo-people", to: "/rococo/people", label: "People", icon: Users, audience: "both", group: "utility" },
  { id: "activity", to: "/rococo/activity", label: "Activity", icon: History, audience: "both", group: "utility" },
];

export interface NavSection {
  group: NavGroup;
  heading: string | null;
  items: NavItem[];
}

export type NavLayout = { kind: "flat"; items: NavItem[] } | { kind: "grouped"; sections: NavSection[] };

function visible(item: NavItem, company: Company, isAdmin: boolean, isRococo: boolean): boolean {
  const audienceOk = isAdmin ? item.audience !== "employee" : item.audience !== "admin";
  if (!audienceOk) return false;
  if (item.requires && !hasModule(company, item.requires)) return false;
  // Rococo admins have no company of their own, so a "My" page would be empty for them.
  if (isRococo && item.to.startsWith("/my")) return false;
  return true;
}

// The company sidebar, in sections, for every company alike.
export function navFor(company: Company, isAdmin: boolean, isRococo: boolean): NavLayout {
  const items = NAV_ITEMS.filter((item) => visible(item, company, isAdmin, isRococo));
  const sections: NavSection[] = [];
  for (const group of NAV_GROUP_ORDER) {
    const inGroup = items.filter((item) => item.group === group);
    const heading = (!isAdmin ? EMPLOYEE_GROUP_LABELS[group] : undefined) ?? NAV_GROUP_LABELS[group];
    if (inGroup.length > 0) sections.push({ group, heading, items: inGroup });
  }
  return { kind: "grouped", sections };
}

// Whether an item is the one to mark for a path, beyond what its own link matches.
export function alsoActiveFor(item: NavItem, pathname: string): boolean {
  return (item.alsoActive ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// One shortcut per working section (not Home, not the bottom group), to its first page.
export function sectionShortcuts(layout: NavLayout): Array<{ group: NavGroup; heading: string; to: string }> {
  if (layout.kind === "flat") return [];
  return layout.sections
    .filter((section) => section.group !== "home" && section.group !== "utility")
    .map((section) => ({ group: section.group, heading: section.heading ?? "", to: section.items[0].to }));
}
