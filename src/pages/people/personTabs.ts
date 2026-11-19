// A person page's tabs, each its own route so a link can land on one, and what the page hands every
// tab. The page loads the person once; a tab reads what was loaded and writes through the page's
// callbacks, so switching tabs never loads the person again. Kept out of the page and tab files so
// each of those exports only its component, which Fast Refresh relies on.
import type { TabItem } from "../../components/ui/Tabs.tsx";
import { displayName } from "../../lib/format.ts";
import { directoryById, nameFromDirectory } from "../../lib/people.ts";
import type {
  CompensationItem,
  DirectoryEntry,
  EmployeeFinancial,
  EmployeeKpi,
  Goal,
  GsrCriterion,
  GsrPillar,
  ImpactScore,
  JobRole,
  Profile,
  Review,
  ReviewCycle,
  ReviewScore,
} from "../../types/database.ts";

export type PersonTab = "overview" | "gsr" | "scorecard" | "tasks" | "reviews" | "setup";

const LABELS: Record<PersonTab, string> = {
  overview: "Overview",
  gsr: "GSR and goals",
  scorecard: "Scorecard",
  tasks: "Tasks",
  reviews: "Reviews",
  setup: "Setup",
};

const ORDER: PersonTab[] = ["overview", "gsr", "scorecard", "tasks", "reviews", "setup"];

// The tabs this viewer gets on this person: Tasks only when the company has the module, Setup only
// for an admin. A Rococo admin placed on a company roster has no Tasks tab, as their page never
// listed tasks; every other tab is the viewer's as usual.
export function personTabsFor(v: { personId: string; isAdmin: boolean; tasksOn: boolean; rococoPerson: boolean }): Array<TabItem & { key: PersonTab }> {
  const keys = ORDER.filter((key) => (key === "tasks" ? v.tasksOn && !v.rococoPerson : key === "setup" ? v.isAdmin : true));
  return keys.map((key) => ({
    key,
    label: LABELS[key],
    to: key === "overview" ? `/people/${v.personId}` : `/people/${v.personId}/${key}`,
    end: key === "overview",
  }));
}

// Everything the page loads for one person, in one go.
export interface PersonRecord {
  people: Profile[];
  directory: DirectoryEntry[];
  person: Profile | null;
  reviews: Review[];
  cycles: ReviewCycle[];
  pillars: GsrPillar[];
  criteria: GsrCriterion[];
  impact: ImpactScore[];
  scores: ReviewScore[];
  kpis: EmployeeKpi[];
  compensation: CompensationItem[];
  financials: EmployeeFinancial[];
  jobRoles: JobRole[];
  goals: Goal[];
  omittedCycleIds: string[];
}

// What every tab is handed: the loaded record, the person in it, a way to change what was loaded
// after a write, and where a failure is reported.
export interface PersonTabProps {
  companyId: string;
  data: PersonRecord;
  person: Profile;
  update: (change: (prev: PersonRecord) => PersonRecord) => void;
  onError: (message: string) => void;
}

// Who they report to: from the people the viewer sees, else the company directory, so a manager
// who is inactive or outside the viewer's divisions still reads by name (D6).
export function reportsTo(data: Pick<PersonRecord, "people" | "directory">, person: Profile) {
  if (!person.reports_to) return { manager: null, name: null, inactive: false };
  const manager = data.people.find((p) => p.id === person.reports_to) ?? null;
  const names = directoryById(data.directory);
  const entry = names.get(person.reports_to) ?? null;
  return {
    manager,
    name: manager ? displayName(manager) : nameFromDirectory(names, person.reports_to, "Someone outside your view"),
    inactive: manager ? !manager.is_active : entry ? !entry.is_active : false,
  };
}
