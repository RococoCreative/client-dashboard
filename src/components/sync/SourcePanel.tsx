// A module's data sources on its own page: each enabled source that feeds the module, with its
// state, how fresh it is, and the values its last good sync brought in. With no such source the
// page keeps its honest scaffold. The last good values stay on screen through a running or failed
// sync, always beside the time they are from, and a blank is never shown as a zero.
import type { ReactNode } from "react";
import FreshnessLine from "./FreshnessLine.tsx";
import MappedTable from "./MappedTable.tsx";
import SyncStateBadge from "./SyncStateBadge.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { syncState } from "../../lib/sync/state.ts";
import { listConnections } from "../../services/connections.ts";
import { listCurrentRecords, listSyncSources } from "../../services/sync.ts";
import { TARGET_MODULE_LABELS, type TargetModule } from "../../types/database.ts";

export default function SourcePanel({
  companyId,
  targetModule,
  scaffold,
  showRecords = true,
}: {
  companyId: string;
  targetModule: TargetModule;
  scaffold: ReactNode;
  showRecords?: boolean;
}) {
  const state = useAsync(async () => {
    const [sources, connections] = await Promise.all([listSyncSources(companyId), listConnections(companyId)]);
    const feeding = sources.filter((source) => source.enabled && source.target_module === targetModule);
    const records = await Promise.all(feeding.map((source) => listCurrentRecords(source)));
    return feeding.map((source, i) => ({ source, records: records[i], connection: connections.find((c) => c.id === source.connection_id) ?? null }));
  }, [companyId, targetModule]);

  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) {
    return (
      <Section eyebrow={TARGET_MODULE_LABELS[targetModule]}>
        <SkeletonRows rows={3} />
      </Section>
    );
  }
  if (state.data.length === 0) return <>{scaffold}</>;

  const now = new Date();
  return (
    <div className="space-y-6">
      {state.data.map(({ source, records, connection }) => (
        <Section
          key={source.id}
          eyebrow={TARGET_MODULE_LABELS[targetModule]}
          title={source.name}
          actions={<SyncStateBadge state={syncState(source, connection, now)} />}
        >
          <FreshnessLine source={source} connection={connection} now={now} />
          {showRecords && source.current_run_id !== null ? (
            <div className="mt-4">
              <MappedTable source={source} records={records} />
            </div>
          ) : null}
        </Section>
      ))}
    </div>
  );
}
