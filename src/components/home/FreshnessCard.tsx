// The Home card that says when each of the company's data sources last synced, with a way into
// the page each one feeds. Only a company with the switchboard and data sources modules mounts
// it, so a company without them makes none of these calls.
import { Link } from "react-router-dom";
import FreshnessLine from "../sync/FreshnessLine.tsx";
import SyncStateBadge from "../sync/SyncStateBadge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { syncState } from "../../lib/sync/state.ts";
import { listConnections } from "../../services/connections.ts";
import { listSyncSources } from "../../services/sync.ts";
import { TARGET_MODULE_LABELS, type TargetModule } from "../../types/database.ts";

// The page each module's values show on.
const MODULE_PATHS: Record<TargetModule, string> = {
  sales_reporting: "/sales-finance",
  financial_reporting: "/sales-finance",
  controls: "/sales-finance/controls",
  pm_capacity: "/production",
};

export default function FreshnessCard({ companyId }: { companyId: string }) {
  const state = useAsync(async () => {
    const [sources, connections] = await Promise.all([listSyncSources(companyId), listConnections(companyId)]);
    return sources.filter((source) => source.enabled).map((source) => ({ source, connection: connections.find((c) => c.id === source.connection_id) ?? null }));
  }, [companyId]);
  const now = new Date();

  return (
    <Section eyebrow="Data sources" title="Freshness" description="When each source last synced. Imported values are read-only." padded={false}>
      {state.error && !state.data ? (
        <div className="p-5"><Notice tone="error">{state.error}</Notice></div>
      ) : !state.data ? (
        <div className="p-5"><SkeletonRows rows={3} /></div>
      ) : state.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">
          No data sources yet. Add one in <Link to="/settings" className="text-accent hover:underline">Settings</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {state.data.map(({ source, connection }) => (
            <li key={source.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link to={MODULE_PATHS[source.target_module]} className="text-sm font-medium text-ink hover:text-accent">{source.name}</Link>
                  <p className="text-[12px] text-ink-3">{TARGET_MODULE_LABELS[source.target_module]}</p>
                </div>
                <SyncStateBadge state={syncState(source, connection, now)} />
              </div>
              <div className="mt-1">
                <FreshnessLine source={source} connection={connection} now={now} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
