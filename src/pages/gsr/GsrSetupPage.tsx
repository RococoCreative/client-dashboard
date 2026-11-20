// GSRs, Setup, for an admin: what shapes every monthly GSR. The focus topic calendar (it used to
// sit in Goals) and, for a company that scores its GSRs, how many goals each GSR requires (it used
// to sit inside the Monthly GSRs pillar on Reviews). Which pillars exist is the company's own data,
// never a branch on its name (rule 12): no active Monthly GSRs pillar means GSRs are not scored here.
import FocusTopicCalendar from "../../components/gsr/FocusTopicCalendar.tsx";
import RequiredGoalsField from "../../components/gsr/RequiredGoalsField.tsx";
import Notice from "../../components/ui/Notice.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Section from "../../components/ui/Section.tsx";
import SkeletonRows from "../../components/ui/SkeletonRows.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { listPillars } from "../../services/gsr.ts";
import { secondaryClass } from "../../components/ui/type.ts";
import { SECTION_LABEL } from "../../lib/gsr/cycles.ts";
import { gsrTabsFor } from "./gsrTabs.ts";

export default function GsrSetupPage() {
  const { company } = useHub();
  const current = company!;
  const state = useAsync(async () => (await listPillars(current.id)).filter((p) => p.scoring_type === "gsr_goals"), [current.id]);
  const pillars = state.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow={current.name}
        title={SECTION_LABEL.gsr}
        description="What shapes every month: the focus topic each GSR is built on, and how many goals each one requires."
      />
      <Tabs items={gsrTabsFor(current.gsr_mode)} label="GSRs" />
      <div className="space-y-6">
        <Section eyebrow="Scoring" title="How GSRs are scored" padded={false}>
          <div className="px-4 pb-1 sm:px-6">
            {state.error ? <Notice tone="error" className="my-4">{state.error}</Notice> : null}
            {!state.data && !state.error ? <div className="py-4"><SkeletonRows rows={1} /></div> : null}
            {state.data && pillars.length === 0 ? <p className={`${secondaryClass} py-4`}>GSRs are not scored here yet.</p> : null}
            {pillars.map((pillar) => (
              <RequiredGoalsField
                key={pillar.id}
                pillar={pillar}
                label={pillars.length > 1 ? `${pillar.name}: goals each GSR requires` : undefined}
                onSaved={(next) => state.setData((prev) => (prev ? prev.map((p) => (p.id === next.id ? next : p)) : prev))}
              />
            ))}
          </div>
        </Section>
        <FocusTopicCalendar companyId={current.id} />
      </div>
    </>
  );
}
