// Projects' tabs, each its own route so a link can land on one: the projects themselves, and the
// setup behind them (the standard milestones every new project starts with). Kept out of the page
// files so each exports only its component, which Fast Refresh relies on. Only an admin at a
// company with the production module reaches Setup, so only they are shown the tab row.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type ProductionTab = "projects" | "setup";

export const PRODUCTION_TABS: Array<TabItem & { key: ProductionTab }> = [
  { key: "projects", to: "/production", label: "Projects", end: true },
  { key: "setup", to: "/production/setup", label: "Setup" },
];
