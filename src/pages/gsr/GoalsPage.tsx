// Goals, for admins: one place for every kind of goal the company sets, each tab saying who it
// applies to and when it shows. Company is the year's shared numbers leadership reviews monthly;
// People is each person's goals for the year and their BHAG. Each tab
// is its own route (/goals/company and so on), so a link from anywhere can land on the right one.
// Employees keep their own goals on My Goals. Role goals and focus topics used to be tabs here; one
// quiet line at the foot says where each lives now.
import { Link } from "react-router-dom";
import CompanyGoalsPanel from "../../components/goals/CompanyGoalsPanel.tsx";
import PeopleGoalsPanel from "../../components/goals/PeopleGoalsPanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { metaClass } from "../../components/ui/type.ts";
import { useHub } from "../../context/HubContext.tsx";
import { GOALS_TABS, type GoalsTab } from "./goalsTabs.ts";

export default function GoalsPage({ tab }: { tab: GoalsTab }) {
  const { company } = useHub();
  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Goals"
        description="Where every goal is set: the company's numbers for the year and each person's goals."
      />
      <Tabs items={GOALS_TABS} label="Goals" />
      {tab === "company" ? <CompanyGoalsPanel /> : null}
      {tab === "people" ? <PeopleGoalsPanel /> : null}
      <p className={`mt-6 ${metaClass}`}>
        Role goals are set under <Link to="/people/roles" className="text-link hover:underline">People, Roles</Link>, and focus topics under{" "}
        <Link to="/gsr/setup" className="text-link hover:underline">GSRs, Setup</Link>.
      </p>
    </>
  );
}
