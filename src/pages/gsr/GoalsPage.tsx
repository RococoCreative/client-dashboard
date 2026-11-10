// Goals, for admins: one place for every kind of goal the company sets, each tab saying who it
// applies to and when it shows. Company is the year's shared numbers leadership reviews monthly;
// By role is the goals a job role brings into every month; Monthly focus is the topic each
// month's #1 GSR is built on; People is each person's goals for the year and their BHAG. Each tab
// is its own route (/goals/company and so on), so a link from anywhere can land on the right one.
// Employees keep their own goals on My Goals.
import FocusTopicCalendar from "../../components/gsr/FocusTopicCalendar.tsx";
import CompanyGoalsPanel from "../../components/goals/CompanyGoalsPanel.tsx";
import PeopleGoalsPanel from "../../components/goals/PeopleGoalsPanel.tsx";
import RoleGoalsPanel from "../../components/goals/RoleGoalsPanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { GOALS_TABS, type GoalsTab } from "./goalsTabs.ts";

export default function GoalsPage({ tab }: { tab: GoalsTab }) {
  const { company } = useHub();
  const companyId = company!.id;
  return (
    <>
      <PageHeader
        eyebrow={company!.name}
        title="Goals"
        description="Where every goal is set: the company's numbers for the year, the goals each role brings into every month, the monthly focus topic, and each person's goals."
      />
      <Tabs items={GOALS_TABS} label="Goals" />
      {tab === "company" ? <CompanyGoalsPanel /> : null}
      {tab === "roles" ? <RoleGoalsPanel companyId={companyId} /> : null}
      {tab === "focus" ? <FocusTopicCalendar companyId={companyId} /> : null}
      {tab === "people" ? <PeopleGoalsPanel /> : null}
    </>
  );
}
