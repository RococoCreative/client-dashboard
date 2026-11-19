// Settings' tabs, each its own route so a link can land on one: the company itself, how it reviews people, the standard milestones its projects start with, its
// connections to outside systems, and the company's own change log. Company and Activity follow
// the company's permissions and Production its modules (settingsTabsFor); the rest are always
// there for an admin. Kept out of the page file so it exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";
import { hasModule, type ModuleKey } from "../../lib/modules.ts";
import type { CapabilityKey, Company } from "../../types/database.ts";

export type SettingsTab = "company" | "reviews" | "production" | "connections" | "activity";

export const SETTINGS_TABS: Array<TabItem & { key: SettingsTab }> = [
  { key: "company", to: "/settings/company", label: "Company" },
  { key: "reviews", to: "/settings/reviews", label: "Reviews" },
  { key: "production", to: "/settings/production", label: "Production" },
  { key: "connections", to: "/settings/connections", label: "Connections" },
  { key: "activity", to: "/settings/activity", label: "Activity" },
];

// The capability a tab needs; a tab not listed is open to every admin.
const TAB_CAPABILITY: Partial<Record<SettingsTab, CapabilityKey>> = { company: "company_settings", activity: "audit_log" };

// The module a tab needs; a tab not listed shows for every company.
const TAB_MODULE: Partial<Record<SettingsTab, ModuleKey>> = { production: "production" };

// The tabs this person may open at this company, in order. The first is where /settings lands.
export function settingsTabsFor(can: (key: CapabilityKey) => boolean, company: Pick<Company, "modules"> | null | undefined): Array<TabItem & { key: SettingsTab }> {
  return SETTINGS_TABS.filter((t) => {
    const needs = TAB_CAPABILITY[t.key];
    const gate = TAB_MODULE[t.key];
    return (!needs || can(needs)) && (!gate || hasModule(company, gate));
  });
}
