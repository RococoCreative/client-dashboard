// The Tasks page's tabs, each its own route so a link can land on one: my tasks, and the tasks of
// everyone the viewer may see. An admin reads that second tab as Everyone; a manager reads it as
// Team, because it holds the people they lead. Kept out of the page file so it exports only its
// component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type TasksTab = "mine" | "everyone";

export const TASKS_TABS: Array<TabItem & { key: TasksTab }> = [
  { key: "mine", to: "/tasks", label: "Mine", end: true },
  { key: "everyone", to: "/tasks/everyone", label: "Everyone" },
];

// The tabs as a viewer sees them: the second tab is "Team" for anyone who leads without running
// the company.
export function tasksTabsFor(isAdmin: boolean): Array<TabItem & { key: TasksTab }> {
  return TASKS_TABS.map((t) => (t.key === "everyone" && !isAdmin ? { ...t, label: "Team" } : t));
}
