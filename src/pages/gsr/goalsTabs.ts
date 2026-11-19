// The Goals hub's tabs, each its own route so a link can land on one: the company's goals for the
// year and each person's goals for the year. The monthly focus topics moved to GSRs, Setup. Kept
// out of the page file so it exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type GoalsTab = "company" | "people";

export const GOALS_TABS: Array<TabItem & { key: GoalsTab }> = [
  { key: "company", to: "/goals/company", label: "Company" },
  { key: "people", to: "/goals/people", label: "People" },
];
