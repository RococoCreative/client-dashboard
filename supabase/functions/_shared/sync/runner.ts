// Runs one sync of one source against a store and the provider adapters it is handed, so the
// order of writes and the keep-the-last-good-data rule are proven here with fakes and the Edge
// Function only supplies the database and the providers. A failure never moves the source's
// pointer or its last success: the records the company last saw stay current until a sync
// succeeds.
import { mapRows } from "./parse.ts";
import type { AdapterRegistry, ConnectionRef, ParsedRow, SyncSourceSpec, ValidationError } from "./types.ts";

// A run still marked running after this long was cut off, and no longer holds the lock. The one
// stale window: the runner, the hourly tick's sweep and the app's sync state all read it here.
export const STALE_RUN_MINUTES = 15;

// The instant before which a run still marked running counts as cut off.
export function staleRunCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_RUN_MINUTES * 60000);
}

// The database side of a sync. The Edge Function implements it with the service role.
export interface SyncStore {
  // Marks the connection's running runs started before olderThan as abandoned, and sets their
  // sources' last_status to failed with last_error "The sync stopped before finishing.".
  // Returns how many it abandoned.
  abandonStaleRuns(connectionId: string, olderThan: Date): Promise<number>;
  // Inserts a running sync_runs row and sets the source's last_status to running and its
  // last_attempt_at. A unique-index violation on the running lock comes back as { locked: true }.
  startRun(input: { source: SyncSourceSpec; trigger: "schedule" | "manual"; requestedBy: string | null; now: Date }): Promise<{ runId: string } | { locked: true }>;
  // Inserts the run's records.
  insertRecords(runId: string, source: SyncSourceSpec, rows: ParsedRow[]): Promise<void>;
  // Writes the result columns on the source; only the keys given change.
  markSource(sourceId: string, patch: { current_run_id?: string; last_success_at?: string; last_status: "succeeded" | "failed"; last_error: string | null }): Promise<void>;
  // Closes the run with its status and counts.
  finishRun(runId: string, result: { status: "succeeded" | "failed"; rowsRead: number; rowsApplied: number; rowsBlank: number; errorDetail: unknown | null; finishedAt: Date }): Promise<void>;
  // Deletes the source's records from every run not in keepRunIds.
  pruneRecords(sourceId: string, keepRunIds: string[]): Promise<void>;
}

export interface RunOutcome {
  status: "succeeded" | "failed" | "locked"; runId: string | null;
  rowsRead: number; rowsApplied: number; rowsBlank: number; errors: ValidationError[]; message: string | null;
}

type Attempt =
  | { ok: true; rows: ParsedRow[]; rowsRead: number; rowsBlank: number }
  | { ok: false; message: string; errors: ValidationError[]; rowsRead: number; rowsBlank: number };

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function runSync(args: {
  source: SyncSourceSpec; connection: ConnectionRef; trigger: "schedule" | "manual"; requestedBy: string | null;
  store: SyncStore; adapters: AdapterRegistry; now?: () => Date;
}): Promise<RunOutcome> {
  const { source, connection, trigger, requestedBy, store, adapters } = args;
  const now = args.now ?? (() => new Date());

  await store.abandonStaleRuns(connection.id, staleRunCutoff(now()));
  const started = await store.startRun({ source, trigger, requestedBy, now: now() });
  if ("locked" in started) {
    return { status: "locked", runId: null, rowsRead: 0, rowsApplied: 0, rowsBlank: 0, errors: [], message: "A sync is already running for this connection." };
  }
  const runId = started.runId;

  // Everything from here to the success markSource fails the run, not the caller: a throw from
  // anywhere in it, the column map included, closes the run and frees the lock.
  const attempt = async (): Promise<Attempt> => {
    let rowsRead = 0;
    let rowsBlank = 0;
    try {
      const adapter = adapters[source.provider];
      if (!adapter) return { ok: false, message: "Provider not supported yet", errors: [], rowsRead, rowsBlank };
      let table;
      try {
        table = await adapter.read(source, connection);
      } catch (err) {
        return { ok: false, message: messageOf(err, "The source could not be read."), errors: [], rowsRead, rowsBlank };
      }
      rowsRead = table.rows.length;
      const mapped = mapRows(table, source.field_map, source.record_key);
      rowsBlank = mapped.rowsBlank;
      if (!mapped.ok) {
        const more = mapped.errors.length - 1;
        const message = mapped.errors[0].message + (more > 0 ? ` (and ${more} more)` : "");
        return { ok: false, message, errors: mapped.errors, rowsRead: mapped.rowsRead, rowsBlank };
      }
      await store.insertRecords(runId, source, mapped.rows);
      await store.markSource(source.id, { current_run_id: runId, last_success_at: now().toISOString(), last_status: "succeeded", last_error: null });
      return mapped;
    } catch (err) {
      return { ok: false, message: messageOf(err, "The sync could not finish."), errors: [], rowsRead, rowsBlank };
    }
  };

  const result = await attempt();
  if (!result.ok) {
    const { message, errors, rowsRead, rowsBlank } = result;
    await store.finishRun(runId, { status: "failed", rowsRead, rowsApplied: 0, rowsBlank, errorDetail: errors.length ? errors : { message }, finishedAt: now() });
    // Never the pointer or last_success_at: the last good data stays current.
    await store.markSource(source.id, { last_status: "failed", last_error: message });
    return { status: "failed", runId, rowsRead, rowsApplied: 0, rowsBlank, errors, message };
  }

  const rowsApplied = result.rows.length;
  await store.finishRun(runId, { status: "succeeded", rowsRead: result.rowsRead, rowsApplied, rowsBlank: result.rowsBlank, errorDetail: null, finishedAt: now() });
  try {
    await store.pruneRecords(source.id, [runId, source.current_run_id].filter((id): id is string => Boolean(id)));
  } catch {
    // The next success prunes what this one left.
  }
  return { status: "succeeded", runId, rowsRead: result.rowsRead, rowsApplied, rowsBlank: result.rowsBlank, errors: [], message: null };
}
