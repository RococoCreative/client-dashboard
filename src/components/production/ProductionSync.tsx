// Sync now and a last-updated stamp for the Production section, for a person who may sync but is not
// an admin. Their database access reaches the source rows and nothing else (no connection, run or
// record rows), so the stamp is built from the source row alone and the connection list is never
// read: an empty list would wrongly say "Not connected". Admins keep the full SourcePanel instead.
import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button.tsx";
import Notice from "../ui/Notice.tsx";
import Section from "../ui/Section.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { errorMessage } from "../../lib/errors.ts";
import { formatDateTime, pluralize } from "../../lib/format.ts";
import { listSyncSources, requestSync } from "../../services/sync.ts";
import type { SyncSource } from "../../types/database.ts";

type Message = { tone: "success" | "info" | "error"; text: string };

// The one line a source's row can honestly support. Anything that ended without success reads as
// not finished, and the last good time stays beside it so old figures are never read as new ones.
function stamp(source: SyncSource): string {
  if (source.last_status === "running") return "Syncing";
  if (source.last_status === "failed" || source.last_status === "abandoned") {
    return source.last_success_at
      ? `The last sync did not finish. Showing figures from ${formatDateTime(source.last_success_at)}.`
      : "The last sync did not finish. No figures yet.";
  }
  return source.last_success_at ? `Last updated ${formatDateTime(source.last_success_at)}` : "Not synced yet";
}

async function loadProductionSources(companyId: string): Promise<SyncSource[]> {
  const sources = await listSyncSources(companyId);
  return sources.filter((source) => source.enabled && source.target_module === "pm_capacity");
}

export default function ProductionSync({ companyId }: { companyId: string }) {
  const state = useAsync(() => loadProductionSources(companyId), [companyId]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Message | null>(null);
  // A ref, so two clicks in one batch cannot both start a sync; and the company this component
  // currently shows, so nothing lands after unmount or after the company changed.
  const busy = useRef(false);
  const current = useRef(companyId);
  useEffect(() => {
    current.current = companyId;
    return () => {
      current.current = "";
    };
  }, [companyId]);

  async function syncNow(source: SyncSource) {
    if (busy.current) return;
    busy.current = true;
    const forCompany = companyId;
    const live = () => current.current === forCompany;
    setSyncing(source.id);
    setNotice(null);
    try {
      const result = await requestSync(source.id);
      if (!live()) { busy.current = false; return; }
      setNotice(
        result.status === "succeeded"
          ? { tone: "success", text: `${source.name} synced: ${pluralize(result.rows_applied, "row")}.` }
          : result.status === "locked"
            ? { tone: "info", text: "A sync is already running for this connection. Try again in a few minutes." }
            : // The runner's message can quote sheet cells and column names; a failed run gets a fixed line.
              { tone: "error", text: "The sync did not finish. Ask an admin to check the source." },
      );
    } catch (err) {
      if (!live()) { busy.current = false; return; }
      setNotice({ tone: "error", text: errorMessage(err) });
    }
    // Render from what the database now says, never from an assumed time.
    try {
      const next = await loadProductionSources(companyId);
      if (live()) state.setData(next);
    } catch (err) {
      if (live()) setNotice((prev) => prev ?? { tone: "error", text: errorMessage(err) });
    } finally {
      busy.current = false;
      if (live()) setSyncing(null);
    }
  }

  if (state.error && !state.data) return <Notice tone="error" className="mt-6">{state.error}</Notice>;
  if (!state.data) return <div className="mt-6"><SkeletonRows rows={2} /></div>;
  if (state.data.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {state.data.map((source) => (
        <Section
          key={source.id}
          eyebrow="Production"
          title={source.name}
          actions={
            <Button
              size="sm"
              aria-label={`Sync ${source.name} now`}
              disabled={syncing !== null || source.last_status === "running"}
              onClick={() => void syncNow(source)}
            >
              {syncing === source.id ? "Syncing..." : "Sync now"}
            </Button>
          }
        >
          <p className="text-[12.5px] text-ink-2">{stamp(source)}</p>
        </Section>
      ))}
    </div>
  );
}
