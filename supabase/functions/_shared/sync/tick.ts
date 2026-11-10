// What the hourly tick starts and what it sweeps, kept pure so the rules are proven with fakes and
// the Edge Function only reads the rows and runs the plan. A source is started only when it is
// due, its connection is connected, and its company carries the data sources module: the module
// is a key in companies.modules, read as data for every company alike (rule 12), so turning it
// off stops the weekly reads as well as hiding the screens.
import { staleRunCutoff, type SyncStore } from "./runner.ts";
import { isDue } from "./schedule.ts";
import type { SyncSourceSpec } from "./types.ts";

// The companies.modules key that turns syncing on. The app's list of keys lives in
// src/lib/modules.ts, and a test proves it carries this one.
export const SYNC_MODULE = "data_sources";

export function carriesSyncModule(modules: readonly string[] | null | undefined): boolean {
  return (modules ?? []).includes(SYNC_MODULE);
}

export interface TickConnection { id: string; status: string }

export interface TickPlan<S extends SyncSourceSpec> {
  due: S[];
  // Due sources by connection, in the order they were read, so one connection runs at a time.
  byConnection: Map<string, S[]>;
  // Every connection the tick read, each swept of cut-off runs before anything starts.
  sweep: string[];
}

export function planTick<S extends SyncSourceSpec>(input: {
  sources: S[];
  connections: Map<string, TickConnection>;
  modules: Map<string, readonly string[]>;
  now: Date;
  onSkip?: (sourceId: string, message: string) => void;
}): TickPlan<S> {
  const { sources, connections, modules, now } = input;
  // Each source is judged on its own, so one that cannot be read never stops the others.
  const due = sources.filter((s) => {
    try {
      return carriesSyncModule(modules.get(s.company_id)) && connections.get(s.connection_id)?.status === "connected" && isDue(s, now);
    } catch (err) {
      input.onSkip?.(s.id, err instanceof Error ? err.message : "unknown");
      return false;
    }
  });
  const byConnection = new Map<string, S[]>();
  for (const source of due) byConnection.set(source.connection_id, [...(byConnection.get(source.connection_id) ?? []), source]);
  return { due, byConnection, sweep: [...connections.keys()] };
}

// Abandons runs older than the stale window on each connection, so a run the platform cut off is
// closed on the next tick rather than only when another run starts on the same connection. A
// connection whose sweep fails is reported and the rest carry on. Returns how many it abandoned.
export async function sweepStaleRuns(
  store: Pick<SyncStore, "abandonStaleRuns">,
  connectionIds: string[],
  now: Date,
  onFail?: (connectionId: string, message: string) => void,
): Promise<number> {
  const cutoff = staleRunCutoff(now);
  let abandoned = 0;
  for (const connectionId of connectionIds) {
    try {
      abandoned += await store.abandonStaleRuns(connectionId, cutoff);
    } catch (err) {
      onFail?.(connectionId, err instanceof Error ? err.message : "unknown");
    }
  }
  return abandoned;
}
