// Activity tab of the Rococo portfolio: the audit log (0025), newest first. Every change to a role,
// access, company setup, domain, connection, pillar weight or job-role module lands here with who
// made it. Only Rococo admins can read every company's events, in the database and here; no company
// nav links it. The list itself is shared with a company's own Settings > Activity tab.
import { useState } from "react";
import PageHeader from "../../components/ui/PageHeader.tsx";
import Tabs from "../../components/ui/Tabs.tsx";
import ActivityList from "../../components/audit/ActivityList.tsx";
import { selectClass } from "../../components/ui/forms.ts";
import { useHub } from "../../context/HubContext.tsx";
import { PORTFOLIO_TABS } from "./portfolioTabs.ts";

export default function ActivityPage() {
  const { companies } = useHub();
  const [filter, setFilter] = useState("");
  // The hub already lists every company for a Rococo admin, so the filter has its options at once.
  return (
    <>
      <PageHeader eyebrow="Rococo Creative" title="Activity" description="Changes to roles, access, company setup and connections, newest first. Only Rococo sees this." />
      <Tabs items={PORTFOLIO_TABS} />
      <div className="mb-5 max-w-xs">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by company" className={`${selectClass} mt-0`}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <ActivityList key={filter} companyId={filter || undefined} />
    </>
  );
}
