// A data source's recent sync runs, newest first, shown and never edited: when each ran, whether it
// was scheduled or pressed by hand, how it ended and how many rows it read. Its own file because a
// source shows its runs in two places, under its row and inside its own view once the sources are
// a list.
import Badge, { type BadgeTone } from "../ui/Badge.tsx";
import Notice from "../ui/Notice.tsx";
import SkeletonRows from "../ui/SkeletonRows.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { formatDateTime } from "../../lib/format.ts";
import { listSyncRuns } from "../../services/sync.ts";
import type { SyncRun } from "../../types/database.ts";

// The first message a failed run recorded: an array of { message } or one { message }.
function firstRunError(detail: unknown): string | null {
  const first = Array.isArray(detail) ? detail[0] : detail;
  if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") return (first as { message: string }).message;
  return null;
}

export default function SourceRuns({ sourceId }: { sourceId: string }) {
  const state = useAsync(() => listSyncRuns(sourceId), [sourceId]);
  if (state.error && !state.data) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return <SkeletonRows rows={2} />;
  if (state.data.length === 0) return <p className="text-[12.5px] text-ink-2">No runs yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {state.data.map((run: SyncRun) => {
        const tone: BadgeTone = run.status === "succeeded" ? "success" : run.status === "failed" ? "danger" : run.status === "running" ? "info" : "warning";
        const label = run.status === "succeeded" ? "Succeeded" : run.status === "failed" ? "Failed" : run.status === "running" ? "Running" : "Stopped";
        const problem = run.status === "failed" ? firstRunError(run.error_detail) : null;
        return (
          <li key={run.id} className="px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tnum text-ink">{formatDateTime(run.started_at)}</span>
              <span className="text-ink-3">{run.trigger_kind === "schedule" ? "Scheduled" : "Manual"}</span>
              <Badge tone={tone}>{label}</Badge>
              <span className="tnum text-ink-2">{`${run.rows_read} read, ${run.rows_applied} applied, ${run.rows_blank} blank`}</span>
            </div>
            {problem ? <p className="mt-1 text-danger">{problem}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
