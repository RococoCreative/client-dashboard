// Settings' tabs, each its own route so a link can land on one: the company itself, its job roles
// and divisions, how it reviews people, its connections to outside systems, and the company's own
// change log. Company and Activity follow the company's permissions (settingsTabsFor); the rest
// are always there for an admin. Kept out of the page file so it exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";
import type { CapabilityKey } from "../../types/database.ts";

export type SettingsTab = "company" | "roles" | "reviews" | "connections" | "activity";

export const SETTINGS_TABS: Array<TabItem & { key: SettingsTab }> = [
  { key: "company", to: "/settings/company", label: "Company" },
  { key: "roles", to: "/settings/roles", label: "Roles" },
  { key: "reviews", to: "/settings/reviews", label: "Reviews" },
  { key: "connections", to: "/settings/connections", label: "Connections" },
  { key: "activity", to: "/settings/activity", label: "Activity" },
];

// The capability a tab needs; a tab not listed is open to every admin.
const TAB_CAPABILITY: Partial<Record<SettingsTab, CapabilityKey>> = { company: "company_settings", activity: "audit_log" };

// The tabs this person may open, in order. The first is where /settings lands.
export function settingsTabsFor(can: (key: CapabilityKey) => boolean): Array<TabItem & { key: SettingsTab }> {
  return SETTINGS_TABS.filter((t) => {
    const needs = TAB_CAPABILITY[t.key];
    return !needs || can(needs);
  });
}
