// Projects, Setup, for an admin: the standard milestones and letters every new project starts with.
// It used to sit in Settings; it lives beside the projects it configures now. The list is the
// company's own rows (rule 12), never a branch on its name. The Projects tab is offered only to
// someone who can open Projects (production_view), so it is never a link to a blocked page.
import MilestoneTemplatePanel from "../../components/production/MilestoneTemplatePanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { PRODUCTION_TABS } from "./productionTabs.ts";

export default function ProductionSetupPage() {
  const { company, can } = useHub();
  const current = company!;
  return (
    <>
      <PageHeader eyebrow={current.name} title="Production" description="The milestones and letters every new project starts with." />
      <Tabs items={PRODUCTION_TABS.filter((tab) => tab.key !== "projects" || can("production_view"))} label="Projects" />
      <MilestoneTemplatePanel key={current.id} companyId={current.id} />
    </>
  );
}
