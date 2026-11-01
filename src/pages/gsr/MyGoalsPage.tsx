// An employee's own goals beyond the month, editable: personal, professional and role goals for
// this year and next, and their BHAG. The month's goals live on the GSR tab. Admins see the same
// page for themselves. The page says plainly what their manager sees and what stays theirs, which
// is the line the database draws (0021).
import { Lock } from "lucide-react";
import GoalsPanel from "../../components/gsr/GoalsPanel.tsx";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import { useHub } from "../../context/HubContext.tsx";
import { MY_TABS } from "./myTabs.ts";

export default function MyGoalsPage() {
  const { company, profile } = useHub();
  const companyId = company!.id;

  return (
    <>
      <PageHeader eyebrow="This year and beyond" title="My goals" description="Professional, personal, and role goals for this year and next, and your BHAG, with the action steps to get there." />
      <Tabs items={MY_TABS} />
      <p className="mb-5 flex items-start gap-2 rounded-md border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        <Lock size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
        <span>
          Your manager sees each goal's title, description, kind, period and completion, on your profile and on every quarterly review. Your action steps and progress notes stay private to you.
        </span>
      </p>
      <GoalsPanel companyId={companyId} employeeId={profile.id} canEdit />
    </>
  );
}
