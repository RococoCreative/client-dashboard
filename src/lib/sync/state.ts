// The one honest state a data source shows, so every screen that names a source's freshness says
// the same thing: not connected, waiting for its first sync, syncing, failed, stale past its own
// threshold, or synced. Pure, so the precedence is proven in one place. A sync still marked
// running past the runner's stale window was cut off, so it reads as failed rather than Syncing
// forever.
import { staleRunCutoff } from "../../../supabase/functions/_shared/sync/runner.ts";
import type { CompanyConnection, SyncSource } from "../../types/database.ts";

export type SyncState = "not_connected" | "awaiting_first_sync" | "syncing" | "failed" | "stale" | "synced";
export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  not_connected: "Not connected",
  awaiting_first_sync: "Awaiting first sync",
  syncing: "Syncing",
  failed: "Sync failed",
  stale: "Stale data",
  synced: "Synced",
};

// Hours since the last success, or null when there has never been one.
export function ageHours(lastSuccessAt: string | null, now: Date): number | null {
  if (lastSuccessAt === null) return null;
  return (now.getTime() - new Date(lastSuccessAt).getTime()) / 3600000;
}

// A sync marked running whose run started before the stale window: the platform cut it off and
// nothing closed it yet. A run start is the source's last_attempt_at.
export function runCutOff(source: Pick<SyncSource, "last_status" | "last_attempt_at">, now: Date): boolean {
  if (source.last_status !== "running" || source.last_attempt_at === null) return false;
  return new Date(source.last_attempt_at).getTime() < staleRunCutoff(now).getTime();
}

// The plain line under a failed source: a cut-off run says so, since any error on the row is
// from an older run; otherwise the source's own error, then the connection's.
export function failureDetail(
  source: Pick<SyncSource, "last_status" | "last_attempt_at" | "last_error">,
  now: Date,
  connection: Pick<CompanyConnection, "last_error"> | null = null,
): string {
  if (runCutOff(source, now)) return "The last sync did not finish.";
  return source.last_error ?? connection?.last_error ?? "The last attempt did not finish.";
}

// First match wins.
export function syncState(
  source: Pick<SyncSource, "last_status" | "last_attempt_at" | "last_success_at" | "stale_after_hours">,
  connection: Pick<CompanyConnection, "status"> | null,
  now: Date = new Date(),
): SyncState {
  if (connection === null || connection.status === "not_connected") return "not_connected";
  if (source.last_status === "running") return runCutOff(source, now) ? "failed" : "syncing";
  if (source.last_status === "failed" || source.last_status === "abandoned" || connection.status === "error") return "failed";
  if (source.last_success_at === null) return "awaiting_first_sync";
  const age = ageHours(source.last_success_at, now);
  if (source.stale_after_hours !== null && age !== null && age > source.stale_after_hours) return "stale";
  return "synced";
}
