// An employee's own goals, editable. Admins see the same page for themselves.
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listCycles } from "../../services/gsr.ts";
import { MY_TABS } from "./MyGsrPage.tsx";

export default function MyGoalsPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;
  const cycles = useAsync(() => listCycles(companyId), [companyId]);

  return (
    <>
      <PageHeader eyebrow="Goal Setting and Review" title="My goals" description="Professional, personal, and role goals with the action steps to get there. Your manager sees these alongside your review." />
      <Tabs items={MY_TABS} />
      {cycles.error ? <Notice tone="error" className="mb-4">{cycles.error}</Notice> : null}
      <GoalsPanel companyId={companyId} employeeId={profile.id} canEdit cycles={cycles.data ?? []} />
    </>
  );
}
