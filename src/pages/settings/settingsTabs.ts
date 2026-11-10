// Settings' tabs, each its own route so a link can land on one: the company itself, its job roles
// and divisions, how it reviews people, and its connections to outside systems. Kept out of the
// page file so it exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type SettingsTab = "company" | "roles" | "reviews" | "connections";

export const SETTINGS_TABS: Array<TabItem & { key: SettingsTab }> = [
  { key: "company", to: "/settings/company", label: "Company" },
  { key: "roles", to: "/settings/roles", label: "Roles" },
  { key: "reviews", to: "/settings/reviews", label: "Reviews" },
  { key: "connections", to: "/settings/connections", label: "Connections" },
];
