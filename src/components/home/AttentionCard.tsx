// The Home card that lists what needs an admin's attention, from signals the hub already holds
// (lib/attention.ts owns the rules). Only a company with the switchboard module mounts it, so a
// company without it makes none of these calls; data sources are read only when the company has
// that module too. People are the ones the database shows the viewer, so for an admin who sees
// only some divisions the not-signed-in count says it covers their divisions.
import { Link } from "react-router-dom";
import Badge from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { tapTargetClass } from "../ui/tap.ts";
import { useHub } from "../../context/HubContext.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { attentionItems } from "../../lib/attention.ts";
import { todayIso } from "../../lib/format.ts";
import { hasModule } from "../../lib/modules.ts";
import { isDivisionLimited } from "../../lib/people.ts";
import { listConnections } from "../../services/connections.ts";
import { listCycles } from "../../services/gsr.ts";
import { listCampaigns } from "../../services/marketing.ts";
import { listCompanyProfiles } from "../../services/profiles.ts";
import { listSyncSources } from "../../services/sync.ts";
import type { Company } from "../../types/database.ts";

export default function AttentionCard({ company }: { company: Company }) {
  const { profile } = useHub();
  const limited = isDivisionLimited(profile);
  const companyId = company.id;
  const withSources = hasModule(company, "data_sources");
  const state = useAsync(async () => {
    const [people, cycles, campaigns, connections, sources] = await Promise.all([
      listCompanyProfiles(companyId),
      listCycles(companyId),
      listCampaigns(companyId),
      listConnections(companyId),
      withSources ? listSyncSources(companyId) : Promise.resolve(undefined),
    ]);
    const items = attentionItems({ people, cycles, campaigns, connections, sources, now: new Date(), today: todayIso(), companyTimeZone: company.time_zone });
    return limited ? items.map((item) => (item.kind === "not_signed_in" ? { ...item, title: `${item.title}, in your divisions` } : item)) : items;
  }, [companyId, withSources, limited]);

  return (
    <Section eyebrow="Attention" title="Needs attention" padded={false}>
      {state.error && !state.data ? (
        <div className="p-4 sm:p-6"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-4 sm:p-6"><SkeletonRows rows={3} /></div>
      ) : state.data.length === 0 ? (
        <p className="px-4 sm:px-6 py-4 text-sm text-ink-2">Nothing needs attention right now.</p>
      ) : (
        <ul className="divide-y divide-line">
          {state.data.map((item, i) => (
            <li key={`${item.kind}-${i}`} className="flex items-start gap-3 px-4 sm:px-6 py-3">
              <Badge tone={item.severity} className="mt-0.5">{item.severity === "danger" ? "Fix" : "Check"}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{item.detail}</p>
              </div>
              <Link to={item.to} aria-label={`Open: ${item.title}`} className={`mt-0.5 shrink-0 text-[13px] font-medium text-link hover:underline ${tapTargetClass}`}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
