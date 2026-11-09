// The one honest state a data source shows, so every screen that names a source's freshness says
// the same thing: not connected, waiting for its first sync, syncing, failed, stale past its own
// threshold, or synced. Pure, so the precedence is proven in one place.
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

// First match wins.
export function syncState(
  source: Pick<SyncSource, "last_status" | "last_success_at" | "stale_after_hours">,
  connection: Pick<CompanyConnection, "status"> | null,
  now: Date = new Date(),
): SyncState {
  if (connection === null || connection.status === "not_connected") return "not_connected";
  if (source.last_status === "running") return "syncing";
  if (source.last_status === "failed" || source.last_status === "abandoned" || connection.status === "error") return "failed";
  if (source.last_success_at === null) return "awaiting_first_sync";
  const age = ageHours(source.last_success_at, now);
  if (source.stale_after_hours !== null && age !== null && age > source.stale_after_hours) return "stale";
  return "synced";
}
