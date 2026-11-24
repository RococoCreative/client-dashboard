// The sync routes for Google Sheets and QuickBooks Online, both read-only. They run inside the
// connections function so it stays the only reader of connection_tokens (rule 6). Sync now is
// authorised by the caller's own one-row write under row level security
// (private.can_sync_source), never by a role check here; the hourly tick is authorised by a
// shared secret that can only start a sync; describe is for a company admin choosing a Google
// Sheets tab. Neither sync route runs a source whose company has the data sources module off.
// The database side of the runner and the token store live here, over the service role;
// everything else a sync does is in the pure modules under _shared/sync. Tokens are stored sealed
// and opened only here, with keys loaded once the caller is authorised; without usable keys a sync
// answers 503 with the setup line rather than reading anything. The tick also sweeps expired
// pending connections (pending.ts). The only error text a sync shows, in its answer or on the
// source, is a SyncError's fixed line (_shared/sync/errors.ts); anything else reads as a plain line.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { SHEET_NOT_READ, SyncError, syncMessage } from "../_shared/sync/errors.ts";
import { createGoogleSheetsAdapter, describeSheet } from "../_shared/sync/googleSheets.ts";
import { createQuickBooksAdapter } from "../_shared/sync/quickbooks.ts";
import { runSync, type RunOutcome, type SyncStore } from "../_shared/sync/runner.ts";
import { carriesSyncModule, planTick, sweepStaleRuns } from "../_shared/sync/tick.ts";
import { createSealedTokenStore, type StoredTokenRow } from "../_shared/sync/tokenStore.ts";
import type { AdapterRegistry, ProviderAdapter, SyncProvider, SyncSourceSpec, TokenStore } from "../_shared/sync/types.ts";
import { TOKENS_NOT_SET_UP, TokenKeyError, loadTokenKeys, type TokenKeys } from "../_shared/tokenCrypto.ts";
import { sameBytes } from "../_shared/bytes.ts";
import { HttpError, json, requireAdmin, service, signedInUser } from "./http.ts";
import { sweepExpiredPending } from "./pending.ts";

const SOURCE_COLUMNS =
  "id, company_id, connection_id, provider, name, config, field_map, record_key, enabled, sync_weekday, sync_weekdays, sync_time, sync_timezone, current_run_id, last_attempt_at, last_success_at";
const CONNECTION_COLUMNS = "id, company_id, provider, status";

// Wall time the tick spends starting sources; the rest stay due and run on the next tick.
const TICK_BUDGET_MS = 100_000;
const INSERT_CHUNK = 500;
const SPREADSHEET_ID = /^[A-Za-z0-9_-]+$/;

const SYNC_LABELS: Record<SyncProvider, string> = { google_sheets: "Google Sheets", quickbooks: "QuickBooks Online" };

type SourceRow = SyncSourceSpec & { name: string };
interface ConnectionRow { id: string; company_id: string; provider: string; status: string }

// A body that is not JSON reads as empty, as the OAuth routes read theirs.
async function readJsonBody<T>(req: Request): Promise<Partial<T>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

// The token store over connection_tokens. Reads and writes sealed values only; sealing and opening
// are in _shared/sync/tokenStore.ts. Errors are logged by code and kind, never by value.
export function createTokenStore(service: SupabaseClient, keys: TokenKeys): TokenStore {
  return createSealedTokenStore(
    {
      async read(connectionId) {
        const { data, error } = await service
          .from("connection_tokens")
          .select("access_token, refresh_token, account_id, access_expires_at, refresh_expires_at")
          .eq("connection_id", connectionId)
          .maybeSingle();
        if (error) console.error("token load failed", error.code ?? "unknown");
        return error || !data ? null : (data as StoredTokenRow);
      },
      async write(connectionId, values) {
        const { error } = await service
          .from("connection_tokens")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("connection_id", connectionId);
        if (error) {
          console.error("token save failed", error.code ?? "unknown");
          throw new SyncError("The new sign-in could not be saved.");
        }
      },
    },
    keys,
  );
}

// The token keys, loaded once a caller is authorised. Keys that are missing or malformed answer
// 503 with the setup line; which secret is at fault is for /status, not for a sync's caller.
async function tokenKeys(): Promise<TokenKeys> {
  try {
    return await loadTokenKeys((name) => Deno.env.get(name));
  } catch (err) {
    if (err instanceof TokenKeyError) throw new HttpError(503, TOKENS_NOT_SET_UP);
    throw err;
  }
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
      if (error) throw new SyncError("Stale runs could not be cleared.");
      const runs = (data ?? []) as Array<{ source_id: string }>;
      const sourceIds = [...new Set(runs.map((run) => run.source_id))];
      if (sourceIds.length > 0) {
        const { error: sourceError } = await service
          .from("sync_sources")
          .update({ last_status: "failed", last_error: "The sync stopped before finishing." })
          .in("id", sourceIds)
          .eq("last_status", "running");
        if (sourceError) throw new SyncError("Stale runs could not be cleared.");
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
      if (error || !data) throw new SyncError("The sync could not start.");
      const { error: sourceError } = await service
        .from("sync_sources")
        .update({ last_status: "running", last_attempt_at: now.toISOString() })
        .eq("id", source.id);
      if (sourceError) throw new SyncError("The sync could not start.");
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
        if (error) throw new SyncError("The rows could not be saved.");
      }
    },

    async markSource(sourceId, patch) {
      const { error } = await service.from("sync_sources").update(patch).eq("id", sourceId);
      if (error) throw new SyncError("The source could not be updated.");
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
      if (error) throw new SyncError("The run could not be closed.");
    },

    async pruneRecords(sourceId, keepRunIds) {
      const { error } = await service.from("sync_records").delete().eq("source_id", sourceId).not("run_id", "in", `(${keepRunIds.join(",")})`);
      if (error) throw new SyncError("Old rows could not be cleared.");
    },
  };
}

function googleKeys(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// The line a source shows when its provider's app keys are missing.
const NOT_SET_UP: Record<SyncProvider, string> = {
  google_sheets: "Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.",
  quickbooks: "QuickBooks Online is not set up yet. Ask Rococo Creative to add the app keys.",
};

function unconfigured(provider: SyncProvider): ProviderAdapter {
  return {
    provider,
    read: () => Promise.reject(new SyncError(NOT_SET_UP[provider])),
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
    google_sheets: google ? createGoogleSheetsAdapter({ ...google, tokens, fetch, now: () => new Date() }) : unconfigured("google_sheets"),
    quickbooks: qbo
      ? createQuickBooksAdapter({
          ...qbo,
          tokens,
          fetch,
          environment: Deno.env.get("QBO_ENVIRONMENT") === "production" ? "production" : "sandbox",
          now: () => new Date(),
        })
      : unconfigured("quickbooks"),
  };
}

async function runOne(
  service: SupabaseClient,
  keys: TokenKeys,
  source: SourceRow,
  connection: ConnectionRow,
  trigger: "schedule" | "manual",
  requestedBy: string | null,
): Promise<RunOutcome> {
  const outcome = await runSync({
    source,
    connection: { id: connection.id },
    trigger,
    requestedBy,
    store: createSyncStore(service),
    adapters: adaptersFor(createTokenStore(service, keys)),
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
  const { data: source, error: sourceError } = await admin.from("sync_sources").select(SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
  // A failed read (for example a column this database does not have yet) is not a missing source.
  if (sourceError) {
    console.error("source read failed", sourceId, sourceError.code ?? "unknown");
    throw new HttpError(500, "The source could not be read. Try again.");
  }
  if (!source) throw new HttpError(403, "That source was not found, or you cannot sync it.");
  const spec = source as unknown as SourceRow;
  const { data: company, error: companyError } = await admin.from("companies").select("modules").eq("id", spec.company_id).maybeSingle();
  if (companyError) throw new Error("The company could not be read.");
  if (!carriesSyncModule((company?.modules as string[] | null | undefined) ?? null)) {
    throw new HttpError(409, "Data sources are turned off for this company. A Rococo admin can turn them on.");
  }
  const { data: connection } = await admin.from("company_connections").select(CONNECTION_COLUMNS).eq("id", spec.connection_id).maybeSingle();
  // A disabled source may still be synced by hand, so an admin can test it before enabling it.
  if (!connection || connection.status !== "connected") throw new HttpError(409, `Connect ${SYNC_LABELS[spec.provider] ?? "the source"} in Settings first.`);

  const keys = await tokenKeys();
  const { data: profile } = await asUser.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  const requestedBy = (profile?.id as string | undefined) ?? null;

  const outcome = await runOne(admin, keys, spec, connection as ConnectionRow, "manual", requestedBy);
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
  // Pending connections nobody confirmed go first, keys or not: the rows always go, and each grant
  // is handed back when the keys and the provider's app keys allow. Best effort, so a failed sweep
  // never stops the syncs.
  try {
    const sweptCount = await sweepExpiredPending(service(), new Date());
    console.log("pending swept", sweptCount);
  } catch (err) {
    console.error("pending sweep failed", err instanceof Error ? err.name : "unknown");
  }
  const keys = await tokenKeys();

  const started = Date.now();
  const now = new Date();
  const admin = service();
  const { data: sourceData, error: sourceError } = await admin.from("sync_sources").select(SOURCE_COLUMNS).eq("enabled", true).or("sync_weekdays.not.is.null,sync_weekday.not.is.null");
  if (sourceError) throw new Error("The scheduled sources could not be read.");
  const scheduled = (sourceData ?? []) as unknown as SourceRow[];
  const connectionIds = [...new Set(scheduled.map((s) => s.connection_id))];
  const connections = new Map<string, ConnectionRow>();
  if (connectionIds.length > 0) {
    const { data: connectionData, error: connectionError } = await admin.from("company_connections").select(CONNECTION_COLUMNS).in("id", connectionIds);
    if (connectionError) throw new Error("The connections could not be read.");
    for (const row of (connectionData ?? []) as ConnectionRow[]) connections.set(row.id, row);
  }
  // Each company's modules, read as data: a source in a company without data sources stays put.
  const companyIds = [...new Set(scheduled.map((s) => s.company_id))];
  const modules = new Map<string, readonly string[]>();
  if (companyIds.length > 0) {
    const { data: companyData, error: companyError } = await admin.from("companies").select("id, modules").in("id", companyIds);
    if (companyError) throw new Error("The companies could not be read.");
    for (const row of (companyData ?? []) as Array<{ id: string; modules: string[] | null }>) modules.set(row.id, row.modules ?? []);
  }

  // Due, connected and in a company with data sources on; anything else is left alone, nothing
  // written. Every connection read is first swept of runs the platform cut off.
  const { due, byConnection, sweep } = planTick({
    sources: scheduled,
    connections,
    modules,
    now,
    onSkip: (id, reason) => console.error("scheduled sync skipped", id, reason),
  });
  const abandonedCount = await sweepStaleRuns(createSyncStore(admin), sweep, now, (id, reason) => console.error("stale sweep failed", id, reason));

  // One connection at a time and, within it, one source at a time, so sources sharing a
  // connection never meet on the lock and a refresh token never rotates twice at once.
  const ran: Array<{ source_id: string; status: RunOutcome["status"] }> = [];
  outer: for (const [connectionId, sources] of byConnection) {
    const connection = connections.get(connectionId)!;
    for (const source of sources) {
      if (Date.now() - started > TICK_BUDGET_MS) break outer;
      try {
        const outcome = await runOne(admin, keys, source, connection, "schedule", null);
        ran.push({ source_id: source.id, status: outcome.status });
      } catch (err) {
        console.error("scheduled sync failed", source.id, err instanceof Error ? err.name : "unknown");
        ran.push({ source_id: source.id, status: "failed" });
      }
    }
  }
  // Ids, counts and statuses only.
  const ranStatus = ran.map((r) => `${r.source_id} ${r.status}`).join(", ");
  console.log("sync tick", "due", due.length, "abandoned", abandonedCount, "ran", ranStatus);
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

  const google = googleKeys();
  if (!google) throw new HttpError(503, "Google Sheets is not set up yet. Ask Rococo Creative to add the app keys.");
  const keys = await tokenKeys();
  try {
    const description = await describeSheet(
      { ...google, tokens: createTokenStore(admin, keys), fetch, now: () => new Date() },
      { id: connection.id as string },
      body.spreadsheet_id,
      gid as number | null,
    );
    return json(200, description);
  } catch (err) {
    // Only a sync's own fixed line is shown; anything else reads as the plain line (errors.ts).
    throw new HttpError(502, syncMessage(err, SHEET_NOT_READ));
  }
}
