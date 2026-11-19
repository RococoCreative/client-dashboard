// Reviews, Setup, for an admin: how the company reviews people. Pillars and their weights, the
// criteria a rated pillar scores, the Monthly GSRs rule, and the categories deliverables are filed
// under. It used to sit in Settings; it lives beside the cycles it configures now. Everything shown
// is the company's own data (rule 12), never a branch on its name.
import DeliverableCategoriesPanel from "../../components/reviews/DeliverableCategoriesPanel.tsx";
import PillarsPanel from "../../components/reviews/PillarsPanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { SECTION_LABEL } from "../../lib/gsr/cycles.ts";
import { REVIEWS_TABS } from "./reviewsTabs.ts";

export default function ReviewsSetupPage() {
  const { company } = useHub();
  const current = company!;
  return (
    <>
      <PageHeader
        eyebrow={current.name}
        title={SECTION_LABEL.reviews}
        description="How people are reviewed: the pillars and their weights, the criteria rated, the Monthly GSRs rule, and the categories deliverables are filed under."
      />
      <Tabs items={REVIEWS_TABS} label="Reviews" />
      <div className="space-y-6">
        <PillarsPanel />
        <DeliverableCategoriesPanel companyId={current.id} />
      </div>
    </>
  );
}
