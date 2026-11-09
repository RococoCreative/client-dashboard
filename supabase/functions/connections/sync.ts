// The sync routes for Google Sheets and QuickBooks Online, both read-only. They run inside the
// connections function so it stays the only reader of connection_tokens (rule 6). Sync now is
// authorised by the caller's own one-row write under row level security
// (private.can_sync_source), never by a role check here; the hourly tick is authorised by a
// shared secret that can only start a sync; describe is for a company admin choosing a Google
// Sheets tab. The database side of the runner and the token store live here, over the service
// role; everything else a sync does is in the pure modules under _shared/sync.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createGoogleSheetsAdapter, describeSheet } from "../_shared/sync/googleSheets.ts";
import { createQuickBooksAdapter } from "../_shared/sync/quickbooks.ts";
import { runSync, type RunOutcome, type SyncStore } from "../_shared/sync/runner.ts";
import { isDue } from "../_shared/sync/schedule.ts";
import type { AdapterRegistry, ProviderAdapter, ProviderTokens, SyncProvider, SyncSourceSpec, TokenStore } from "../_shared/sync/types.ts";
import { HttpError, json, requireAdmin, sameBytes, service, signedInUser } from "./http.ts";

const SOURCE_COLUMNS =
  "id, company_id, connection_id, provider, name, config, field_map, record_key, enabled, sync_weekday, sync_time, sync_timezone, current_run_id, last_attempt_at, last_success_at";
const CONNECTION_COLUMNS = "id, company_id, provider, status, external_account_id";

// Wall time the tick spends starting sources; the rest stay due and run on the next tick.
const TICK_BUDGET_MS = 100_000;
const INSERT_CHUNK = 500;
const SPREADSHEET_ID = /^[A-Za-z0-9_-]+$/;

const SYNC_LABELS: Record<SyncProvider, string> = { google_sheets: "Google Sheets", quickbooks: "QuickBooks Online" };

type SourceRow = SyncSourceSpec & { name: string };
interface ConnectionRow { id: string; company_id: string; provider: string; status: string; external_account_id: string | null }

// A body that is not JSON reads as empty, as the OAuth routes read theirs.
async function readJsonBody<T>(req: Request): Promise<Partial<T>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

export function createTokenStore(service: SupabaseClient): TokenStore {
  return {
    async load(connectionId) {
      const { data, error } = await service
        .from("connection_tokens")
        .select("access_token, refresh_token, access_expires_at, refresh_expires_at")
        .eq("connection_id", connectionId)
        .maybeSingle();
      if (error) console.error("token load failed", error.message);
      if (error || !data) throw new Error("This connection has no sign-in on file. Connect it again in Settings.");
      return {
        accessToken: data.access_token as string,
        refreshToken: (data.refresh_token as string | null) ?? null,
        accessExpiresAt: (data.access_expires_at as string | null) ?? null,
        refreshExpiresAt: (data.refresh_expires_at as string | null) ?? null,
      };
    },
    async save(connectionId, tokens: ProviderTokens) {
      const { error } = await service
        .from("connection_tokens")
        .update({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          access_expires_at: tokens.accessExpiresAt,
          refresh_expires_at: tokens.refreshExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("connection_id", connectionId);
      if (error) {
        console.error("token save failed", error.message);
        throw new Error("The new sign-in could not be saved.");
      }
    },
  };
}

export function createSyncStore(service: SupabaseClient): SyncStore {
  return {
    async abandonStaleRuns(connectionId, olderThan) {
      const { data, error } = await service
        .from("sync_runs")
        .update({ status: "abandoned", finished_at: new Date().toISOString() })
        .eq("connection_id", connectionId)
        .eq("status", "running")
        .lt("started_at", olderThan.toISOString())
        .select("source_id");
      if (error) throw new Error("Stale runs could not be cleared.");
      const runs = (data ?? []) as Array<{ source_id: string }>;
      const sourceIds = [...new Set(runs.map((run) => run.source_id))];
      if (sourceIds.length > 0) {
        const { error: sourceError } = await service
          .from("sync_sources")
          .update({ last_status: "failed", last_error: "The sync stopped before finishing." })
          .in("id", sourceIds)
          .eq("last_status", "running");
        if (sourceError) throw new Error("Stale runs could not be cleared.");
      }
      return runs.length;
    },

    async startRun({ source, trigger, requestedBy, now }) {
      const { data, error } = await service
        .from("sync_runs")
        .insert({
          company_id: source.company_id,
          source_id: source.id,
          connection_id: source.connection_id,
          trigger_kind: trigger,
          requested_by: requestedBy,
          status: "running",
          started_at: now.toISOString(),
        })
        .select("id")
        .single();
      if (error?.code === "23505") return { locked: true };
      if (error || !data) throw new Error("The sync could not start.");
      const { error: sourceError } = await service
        .from("sync_sources")
        .update({ last_status: "running", last_attempt_at: now.toISOString() })
        .eq("id", source.id);
      if (sourceError) throw new Error("The sync could not start.");
      return { runId: data.id as string };
    },

    async insertRecords(runId, source, rows) {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK).map((row) => ({
          company_id: source.company_id,
          source_id: source.id,
          run_id: runId,
          record_key: row.key,
          data: row.data,
          source_ref: row.source_ref,
        }));
        const { error } = await service.from("sync_records").insert(chunk);
        if (error) throw new Error("The rows could not be saved.");
      }
    },

    async markSource(sourceId, patch) {
      const { error } = await service.from("sync_sources").update(patch).eq("id", sourceId);
      if (error) throw new Error("The source could not be updated.");
    },

    async finishRun(runId, result) {
      const { error } = await service
        .from("sync_runs")
        .update({
          status: result.status,
          rows_read: result.rowsRead,
          rows_applied: result.rowsApplied,
          rows_blank: result.rowsBlank,
          error_detail: result.errorDetail,
          finished_at: result.finishedAt.toISOString(),
        })
        .eq("id", runId);
      if (error) throw new Error("The run could not be closed.");
    },

    async pruneRecords(sourceId, keepRunIds) {
      const { error } = await service.from("sync_records").delete().eq("source_id", sourceId).not("run_id", "in", `(${keepRunIds.join(",")})`);
      if (error) throw new Error("Old rows could not be cleared.");
    },
  };
}

function googleKeys(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function unconfigured(provider: SyncProvider, label: string): ProviderAdapter {
  return {
    provider,
    read: () => Promise.reject(new Error(`${label} is not set up yet. Ask Rococo Creative to add the app keys.`)),
  };
}

function quickBooksKeys(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("QBO_CLIENT_ID");
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Both providers, each read-only; one whose app keys are missing fails its sources with a plain line.
export function adaptersFor(tokens: TokenStore): AdapterRegistry {
  const google = googleKeys();
  const qbo = quickBooksKeys();
  return {
    google_sheets: google ? createGoogleSheetsAdapter({ ...google, tokens, fetch, now: () => new Date() }) : unconfigured("google_sheets", "Google Sheets"),
    quickbooks: qbo
      ? createQuickBooksAdapter({
          ...qbo,
          tokens,
          fetch,
          environment: Deno.env.get("QBO_ENVIRONMENT") === "production" ? "production" : "sandbox",
          now: () => new Date(),
        })
      : unconfigured("quickbooks", "QuickBooks Online"),
  };
}

async function runOne(service: SupabaseClient, source: SourceRow, connection: ConnectionRow, trigger: "schedule" | "manual", requestedBy: string | null): Promise<RunOutcome> {
  const outcome = await runSync({
    source,
    connection: { id: connection.id, external_account_id: connection.external_account_id },
    trigger,
    requestedBy,
    store: createSyncStore(service),
    adapters: adaptersFor(createTokenStore(service)),
    now: () => new Date(),
  });
  if (outcome.status === "succeeded") {
    // The Connections card's "last sync" line.
    const { error } = await service.from("company_connections").update({ last_synced_at: new Date().toISOString() }).eq("id", connection.id);
    if (error) console.error("last sync stamp failed", connection.id);
  }
  return outcome;
}

export async function handleSyncRun(req: Request): Promise<Response> {
  const body = await readJsonBody<{ source_id?: unknown }>(req);
  if (typeof body.source_id !== "string" || !body.source_id) throw new HttpError(400, "Missing source.");
  const sourceId = body.source_id;
  const { asUser, userId } = await signedInUser(req);

  // The one write that authorises the run: allowed only by private.can_sync_source under RLS.
  const { error: requestError, count } = await asUser
    .from("sync_sources")
    .update({ sync_requested_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", sourceId);
  if (requestError || count !== 1) throw new HttpError(403, "That source was not found, or you cannot sync it.");

  const admin = service();
  const { data: source } = await admin.from("sync_sources").select(SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
  if (!source) throw new HttpError(403, "That source was not found, or you cannot sync it.");
  const spec = source as unknown as SourceRow;
  const { data: connection } = await admin.from("company_connections").select(CONNECTION_COLUMNS).eq("id", spec.connection_id).maybeSingle();
  // A disabled source may still be synced by hand, so an admin can test it before enabling it.
  if (!connection || connection.status !== "connected") throw new HttpError(409, `Connect ${SYNC_LABELS[spec.provider] ?? "the source"} in Settings first.`);

  const { data: profile } = await asUser.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  const requestedBy = (profile?.id as string | undefined) ?? null;

  const outcome = await runOne(admin, spec, connection as ConnectionRow, "manual", requestedBy);
  return json(200, { status: outcome.status, message: outcome.message, rows_applied: outcome.rowsApplied });
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function handleSyncTick(req: Request): Promise<Response> {
  const secret = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!secret) throw new HttpError(503, "Scheduled syncs are not set up yet.");
  const offered = req.headers.get("x-sync-secret") ?? "";
  if (!sameBytes(await sha256(offered), await sha256(secret))) throw new HttpError(401, "Not allowed.");

  const started = Date.now();
  const now = new Date();
  const admin = service();
  const { data: sourceData, error: sourceError } = await admin.from("sync_sources").select(SOURCE_COLUMNS).eq("enabled", true).not("sync_weekday", "is", null);
  if (sourceError) throw new Error("The scheduled sources could not be read.");
  const scheduled = (sourceData ?? []) as unknown as SourceRow[];
  const connectionIds = [...new Set(scheduled.map((s) => s.connection_id))];
  const connections = new Map<string, ConnectionRow>();
  if (connectionIds.length > 0) {
    const { data: connectionData, error: connectionError } = await admin.from("company_connections").select(CONNECTION_COLUMNS).in("id", connectionIds);
    if (connectionError) throw new Error("The connections could not be read.");
    for (const row of (connectionData ?? []) as ConnectionRow[]) connections.set(row.id, row);
  }

  // Due and connected; a source whose connection is not connected is left alone, nothing written.
  const due = scheduled.filter((s) => isDue(s, now) && connections.get(s.connection_id)?.status === "connected");
  const byConnection = new Map<string, SourceRow[]>();
  for (const source of due) byConnection.set(source.connection_id, [...(byConnection.get(source.connection_id) ?? []), source]);

  // One connection at a time and, within it, one source at a time, so sources sharing a
  // connection never meet on the lock and a refresh token never rotates twice at once.
  const ran: Array<{ source_id: string; status: RunOutcome["status"] }> = [];
  outer: for (const [connectionId, sources] of byConnection) {
    const connection = connections.get(connectionId)!;
    for (const source of sources) {
      if (Date.now() - started > TICK_BUDGET_MS) break outer;
      try {
        const outcome = await runOne(admin, source, connection, "schedule", null);
        ran.push({ source_id: source.id, status: outcome.status });
      } catch (err) {
        console.error("scheduled sync failed", source.id, err instanceof Error ? err.message : "unknown");
        ran.push({ source_id: source.id, status: "failed" });
      }
    }
  }
  console.log("sync tick", JSON.stringify({ due: due.length, ran }));
  return json(200, { due: due.length, ran });
}

export async function handleSyncDescribe(req: Request): Promise<Response> {
  const body = await readJsonBody<{ connection_id?: unknown; spreadsheet_id?: unknown; gid?: unknown }>(req);
  if (typeof body.connection_id !== "string" || !body.connection_id) throw new HttpError(400, "Missing connection.");
  const notALink = "That does not look like a Google Sheets link.";
  if (typeof body.spreadsheet_id !== "string" || !SPREADSHEET_ID.test(body.spreadsheet_id)) throw new HttpError(400, notALink);
  const gid = body.gid;
  if (gid !== null && !(typeof gid === "number" && Number.isInteger(gid) && gid >= 0)) throw new HttpError(400, notALink);

  const admin = service();
  const { data: connection } = await admin.from("company_connections").select(CONNECTION_COLUMNS).eq("id", body.connection_id).maybeSingle();
  if (!connection) throw new HttpError(404, "That connection was not found.");
  await requireAdmin(req, connection.company_id as string);
  if (connection.provider !== "google_sheets" || connection.status !== "connected") throw new HttpError(409, "Connect Google Sheets in Settings first.");

  const keys = googleKeys();
  if (!keys) throw new HttpError(503, "Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.");
  try {
    const description = await describeSheet(
      { ...keys, tokens: createTokenStore(admin), fetch, now: () => new Date() },
      { id: connection.id as string, external_account_id: (connection.external_account_id as string | null) ?? null },
      body.spreadsheet_id,
      gid as number | null,
    );
    return json(200, description);
  } catch (err) {
    if (err instanceof Error) throw new HttpError(502, err.message);
    throw err;
  }
}
