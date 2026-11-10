// The Goals hub's tabs, each its own route so a link can land on one: the company's goals for the
// year, the goals each job role brings into every month, the monthly focus topics, and each
// person's goals for the year. Kept out of the page file so it exports only its component, which
// Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type GoalsTab = "company" | "roles" | "focus" | "people";

export const GOALS_TABS: Array<TabItem & { key: GoalsTab }> = [
  { key: "company", to: "/goals/company", label: "Company" },
  { key: "roles", to: "/goals/roles", label: "By role" },
  { key: "focus", to: "/goals/focus", label: "Monthly focus" },
  { key: "people", to: "/goals/people", label: "People" },
];
