// The header every People screen opens with: the title block and, for an admin, the tab row
// (Roster, Roles, Divisions). A manager reads the same roster as "Your team" with no tabs, and the
// roster passes its own actions (Add staff, or the link to the manager's own profile).
import type { ReactNode } from "react";
import PageHeader from "../ui/PageHeader.tsx";
import Tabs from "../ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { peopleTabsFor, type PeopleTab } from "../../pages/people/peopleTabs.ts";

const DESCRIPTIONS: Record<PeopleTab, string> = {
  roster: "Everyone on the team. Set someone up in full before you invite them; the invitation is the last step, not the first.",
  roles: "The jobs people do here, what each role sees and is scored on, and the goals each role brings into every month.",
  divisions: "The parts the company splits into for reporting. A person's divisions are set on their profile.",
};

const TEAM_DESCRIPTION = "The people who report to you, and their teams. Open someone for their profile, goals and tasks.";

export default function PeopleHeader({ tab, actions }: { tab: PeopleTab; actions?: ReactNode }) {
  const { company, isAdmin } = useHub();
  const tabs = peopleTabsFor(isAdmin);
  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title={isAdmin ? "People" : "Your team"}
        description={isAdmin ? DESCRIPTIONS[tab] : TEAM_DESCRIPTION}
        actions={actions}
      />
      {tabs.length > 0 ? <Tabs items={tabs} label="People" /> : null}
    </>
  );
}
