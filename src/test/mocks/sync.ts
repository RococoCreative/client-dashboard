// The sync service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/sync.ts. Runs and records are only ever read, as in the database; Sync now stamps
// the request and answers succeeded without changing a source's state.
import type { FieldMapEntry, SourceConfig, SyncProvider, SyncRecord, SyncRun, SyncSource, TargetModule } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const sources = fromAll((b) => b.syncSources).map((x) => ({ ...x }));
const runs = fromAll((b) => b.syncRuns).map((x) => ({ ...x }));
const records = fromAll((b) => b.syncRecords).map((x) => ({ ...x }));

let counter = 0;
const now = () => new Date().toISOString();

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
export interface SyncRunResult {
  status: "succeeded" | "failed" | "locked";
  message: string | null;
  rows_applied: number;
}

function findSource(id: string): SyncSource {
  const source = sources.find((s) => s.id === id);
  if (!source) throw new Error("Sync source not found.");
  return source;
}

export async function listSyncSources(companyId: string): Promise<SyncSource[]> {
  return sources
    .filter((s) => s.company_id === companyId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ ...s }));
}

export async function createSyncSource(input: SyncSourceInput): Promise<SyncSource> {
  const stamp = now();
  const created: SyncSource = {
    id: `sync-source-${++counter}`,
    ...input,
    current_run_id: null,
    last_attempt_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    sync_requested_at: null,
    created_by: null,
    updated_by: null,
    created_at: stamp,
    updated_at: stamp,
  };
  sources.push(created);
  return { ...created };
}

export async function updateSyncSource(id: string, patch: SyncSourcePatch): Promise<SyncSource> {
  const source = findSource(id);
  Object.assign(source, patch, { updated_at: now() });
  return { ...source };
}

export async function setSyncSourceEnabled(id: string, enabled: boolean): Promise<SyncSource> {
  return updateSyncSource(id, { enabled });
}

export async function listSyncRuns(sourceId: string, limit = 10): Promise<SyncRun[]> {
  return runs
    .filter((r) => r.source_id === sourceId)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

export async function listCurrentRecords(source: Pick<SyncSource, "id" | "current_run_id">): Promise<SyncRecord[]> {
  if (source.current_run_id === null) return [];
  return records
    .filter((r) => r.source_id === source.id && r.run_id === source.current_run_id)
    .sort((a, b) => a.record_key.localeCompare(b.record_key))
    .map((r) => ({ ...r }));
}

export async function requestSync(sourceId: string): Promise<SyncRunResult> {
  const source = findSource(sourceId);
  source.sync_requested_at = now();
  const applied = records.filter((r) => r.source_id === source.id && r.run_id === source.current_run_id).length;
  return { status: "succeeded", message: null, rows_applied: applied };
}

export interface SpreadsheetDescription { title: string; tabs: Array<{ gid: number; title: string }>; headers: string[] }

// Any link reads as the same sample workbook, a fresh copy each call; the arguments are ignored.
export async function describeSpreadsheet(): Promise<SpreadsheetDescription> {
  return {
    title: "Sample reporting workbook",
    tabs: [
      { gid: 0, title: "Sample sales" },
      { gid: 42, title: "Sample finance" },
    ],
    headers: ["Job", "Contract amount", "Margin", "Signed on"],
  };
}
