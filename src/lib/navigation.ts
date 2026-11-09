// The sidebar registry. Every company nav item lives here once, with who sees it, the section it
// belongs to, and the module it needs, so the sidebar is the same code for every company and only
// its data differs: without the switchboard module a company gets the flat sidebar it always had,
// with it the same items grouped into four sections plus an unlabeled utility group.
import type { LucideIcon } from "lucide-react";
import { BookOpen, Building2, CalendarCheck, CircleDollarSign, ClipboardCheck, FolderOpen, History, LayoutDashboard, LayoutGrid, Megaphone, Settings, Target, UserRound, Users } from "lucide-react";
import type { Company, LinkNavGroup } from "../types/database.ts";
import { hasModule, type ModuleKey } from "./modules.ts";

export type NavGroup = LinkNavGroup | "utility";
export type NavAudience = "admin" | "employee" | "both";

export interface NavItem {
  id: string;
  to: string;
  label: string;
  // The label inside a grouped sidebar, when it differs (the Dashboard reads "Home" there).
  groupedLabel?: string;
  icon: LucideIcon;
  end?: boolean;
  audience: NavAudience;
  group: NavGroup;
  // The module a company needs on for this item to show at all.
  requires?: ModuleKey;
}

export const NAV_GROUP_ORDER: readonly NavGroup[] = ["home", "sales_finance", "production", "people_hr", "utility"];

export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = {
  home: "Home",
  sales_finance: "Sales & Finance",
  production: "Production",
  people_hr: "People / HR",
  utility: null,
};

// Registry order is the flat sidebar's order and each section's order.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", to: "/", label: "Dashboard", groupedLabel: "Home", icon: LayoutDashboard, end: true, audience: "both", group: "home" },
  { id: "gsr", to: "/gsr", label: "GSRs", icon: CalendarCheck, audience: "admin", group: "people_hr" },
  { id: "reviews", to: "/reviews", label: "Reviews", icon: ClipboardCheck, audience: "admin", group: "people_hr" },
  { id: "goals", to: "/goals", label: "Goals", icon: Target, audience: "admin", group: "people_hr" },
  { id: "my-gsr-employee", to: "/my/gsr", label: "My GSR", icon: CalendarCheck, audience: "employee", group: "people_hr" },
  { id: "my-reviews", to: "/my/reviews", label: "My Reviews", icon: ClipboardCheck, audience: "employee", group: "people_hr" },
  { id: "my-goals", to: "/my/goals", label: "My Goals", icon: Target, audience: "employee", group: "people_hr" },
  { id: "people", to: "/people", label: "People", icon: Users, audience: "admin", group: "people_hr" },
  { id: "sops", to: "/sops", label: "SOPs", icon: BookOpen, audience: "both", group: "utility" },
  { id: "resources", to: "/resources", label: "Resources", icon: FolderOpen, audience: "both", group: "utility" },
  { id: "financials", to: "/financials", label: "Financials", icon: CircleDollarSign, audience: "admin", group: "sales_finance" },
  { id: "marketing", to: "/marketing", label: "Marketing", icon: Megaphone, audience: "admin", group: "sales_finance" },
  { id: "my-gsr-admin", to: "/my/gsr", label: "My GSR", icon: UserRound, audience: "admin", group: "people_hr" },
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

export function navFor(company: Company, isAdmin: boolean, isRococo: boolean): NavLayout {
  const items = NAV_ITEMS.filter((item) => visible(item, company, isAdmin, isRococo));
  if (!hasModule(company, "switchboard")) return { kind: "flat", items };
  const sections: NavSection[] = [];
  for (const group of NAV_GROUP_ORDER) {
    const inGroup = items.filter((item) => item.group === group).map((item) => ({ ...item, label: item.groupedLabel ?? item.label }));
    if (inGroup.length > 0) sections.push({ group, heading: NAV_GROUP_LABELS[group], items: inGroup });
  }
  return { kind: "grouped", sections };
}

// One shortcut per working section (not Home, not the utility group), to its first page.
export function sectionShortcuts(layout: NavLayout): Array<{ group: NavGroup; heading: string; to: string }> {
  if (layout.kind === "flat") return [];
  return layout.sections
    .filter((section) => section.group !== "home" && section.group !== "utility")
    .map((section) => ({ group: section.group, heading: section.heading ?? "", to: section.items[0].to }));
}
