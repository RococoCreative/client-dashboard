// People, Roles: the company's job roles and the goals each role brings into every month, both
// still edited in place. Two panels one after the other for now, so a link to a role's goals
// scrolls to its card on this page.
import JobRolesPanel from "../../components/settings/JobRolesPanel.tsx";
import RoleGoalsPanel from "../../components/goals/RoleGoalsPanel.tsx";
import PeopleHeader from "../../components/people/PeopleHeader.tsx";
import { useHub } from "../../context/HubContext.tsx";

export default function RolesPage() {
  const { company } = useHub();
  const companyId = company!.id;
  return (
    <>
      <PeopleHeader tab="roles" />
      <div className="space-y-6">
        <JobRolesPanel companyId={companyId} />
        <RoleGoalsPanel companyId={companyId} />
      </div>
    </>
  );
}
