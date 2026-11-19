// People's tabs, each its own route so a link can land on one: the roster, the company's job roles,
// and its divisions. Only an admin has the tabs; a manager's page stays "Your team" with no tab row
// (peopleTabsFor). Kept out of the page files so each exports only its component, which Fast
// Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";

export type PeopleTab = "roster" | "roles" | "divisions";

export const PEOPLE_TABS: Array<TabItem & { key: PeopleTab }> = [
  { key: "roster", to: "/people", label: "Roster", end: true },
  { key: "roles", to: "/people/roles", label: "Roles" },
  { key: "divisions", to: "/people/divisions", label: "Divisions" },
];

// Every tab for an admin, none for anyone else.
export function peopleTabsFor(isAdmin: boolean): Array<TabItem & { key: PeopleTab }> {
  return isAdmin ? PEOPLE_TABS : [];
}
