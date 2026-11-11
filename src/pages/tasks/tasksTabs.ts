// The Tasks page's tabs, each its own route so a link can land on one: my tasks, and every task in
// the company for admins. Kept out of the page file so it exports only its component, which Fast
// Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type TasksTab = "mine" | "everyone";

export const TASKS_TABS: Array<TabItem & { key: TasksTab }> = [
  { key: "mine", to: "/tasks", label: "Mine", end: true },
  { key: "everyone", to: "/tasks/everyone", label: "Everyone" },
];
