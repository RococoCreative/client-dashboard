// A company's data sources and what their syncs brought in. Sources are configuration an admin
// edits here; runs and records are written only by the connections Edge Function and are read
// here, never edited. Sync now goes through that function too, which records the request as the
// signed-in user under private.can_sync_source, so the browser never calls a provider.
import type { FieldMapEntry, SourceConfig, SyncProvider, SyncRecord, SyncRun, SyncSource, TargetModule } from "../types/database.ts";
import { invokeFunction } from "./invoke.ts";
import { db } from "./supabase.ts";

// Every column, listed: a column left out is silently invisible to every screen.
const SOURCE_COLUMNS =
  "id, company_id, connection_id, provider, name, target_module, config, field_map, record_key, sync_weekday, sync_time, sync_timezone, stale_after_hours, enabled, current_run_id, last_attempt_at, last_success_at, last_status, last_error, sync_requested_at, created_by, updated_by, created_at, updated_at";
const RUN_COLUMNS = "id, company_id, source_id, connection_id, trigger_kind, requested_by, status, started_at, finished_at, rows_read, rows_applied, rows_blank, error_detail";
const RECORD_COLUMNS = "id, company_id, source_id, run_id, record_key, data, source_ref, created_at";

// The API returns at most this many rows a request, so records are read a page at a time.
const PAGE = 1000;

export interface SyncSourceInput {
  company_id: string;
  connection_id: string;
  provider: SyncProvider;
  name: string;
  target_module: TargetModule;
  config: SourceConfig;
  field_map: FieldMapEntry[];
  record_key: string[];
  sync_weekday: number | null;
  sync_time: string | null;
  sync_timezone: string | null;
  stale_after_hours: number | null;
  enabled: boolean;
}
export type SyncSourcePatch = Partial<Omit<SyncSourceInput, "company_id" | "provider">>;

export async function listSyncSources(companyId: string): Promise<SyncSource[]> {
  const { data, error } = await db().from("sync_sources").select(SOURCE_COLUMNS).eq("company_id", companyId).order("name");
  if (error) throw error;
  return (data as SyncSource[]) ?? [];
}

export async function createSyncSource(input: SyncSourceInput): Promise<SyncSource> {
  const { data, error } = await db().from("sync_sources").insert(input).select(SOURCE_COLUMNS).single();
  if (error) throw error;
  return data as SyncSource;
}

export async function updateSyncSource(id: string, patch: SyncSourcePatch): Promise<SyncSource> {
  const { data, error } = await db().from("sync_sources").update(patch).eq("id", id).select(SOURCE_COLUMNS).single();
  if (error) throw error;
  return data as SyncSource;
}

export async function setSyncSourceEnabled(id: string, enabled: boolean): Promise<SyncSource> {
  return updateSyncSource(id, { enabled });
}

// Newest first.
export async function listSyncRuns(sourceId: string, limit = 10): Promise<SyncRun[]> {
  const { data, error } = await db().from("sync_runs").select(RUN_COLUMNS).eq("source_id", sourceId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as SyncRun[]) ?? [];
}

// The records of the source's last good run, every page of them, so a tab longer than one API
// page is never cut off without a word. A source that has never synced has none.
export async function listCurrentRecords(source: Pick<SyncSource, "id" | "current_run_id">): Promise<SyncRecord[]> {
  if (source.current_run_id === null) return [];
  const rows: SyncRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("sync_records")
      .select(RECORD_COLUMNS)
      .eq("source_id", source.id)
      .eq("run_id", source.current_run_id)
      .order("record_key")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data as SyncRecord[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export interface SyncRunResult {
  status: "succeeded" | "failed" | "locked";
  message: string | null;
  rows_applied: number;
}

// Asks the connections function to sync the source now and returns its answer as it is.
export async function requestSync(sourceId: string): Promise<SyncRunResult> {
  return invokeFunction<SyncRunResult>("connections/sync/run", { source_id: sourceId });
}
