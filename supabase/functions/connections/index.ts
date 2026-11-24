// The one place Company Hub talks to an outside system's sign-in. A company's admin connects
// that company's own GoHighLevel, QuickBooks or Google account from Settings; the tokens land
// sealed in connection_tokens, which only this function (holding the service role) can read. The
// browser never sees a provider secret, token or account id, and nothing is shared between companies.
//
// Routes, all under /functions/v1/connections:
//   POST /start        { company_id, provider, return_to }   -> { url } to send the browser to
//   GET  /callback     ?code&state[&realmId]                 -> 302 to return_to with ?pending=<id>
//                                                                or ?connect_error=<key>
//   POST /pending      { pending_id }                        -> { status, provider?, account_name?, company_name? }
//   POST /finish       { pending_id }                        -> { ok: true, provider }
//   POST /discard      { pending_id }                        -> { ok: true, revoked }
//   POST /disconnect   { company_id, provider }              -> { ok: true, revoked }
//   POST /status       { company_id }                        -> { keys, secrets } which providers and secrets are set
//   POST /sync/run     { source_id }                         -> { status, message, rows_applied }
//   POST /sync/tick    (x-sync-secret header)                -> { due, ran }
//   POST /sync/describe { connection_id, spreadsheet_id, gid } -> { title, tabs, headers }
//
// A connection finishes only when the admin who started it confirms it in the hub. The callback
// does not connect anything: it exchanges the code, parks the sealed result in connection_pending
// (pending.ts) under an id it mints there, and sends the browser back with only that id. The app
// reads it with /pending and the starter confirms with /finish or drops it with /discard. Someone
// else who opens a forwarded link is told so and cannot finish it. /finish claims the pending row
// (deleting it) before it writes the connection, which deliberately reverses the design's "write,
// then delete" order: the claim is what stops two finishes applying one sign-in, and any failure
// after it hands the grant back to the provider. Expired pending rows are swept, and their grants
// revoked, at /start and by the sync tick.
//
// status needs the JWT of an active member of the company or a Rococo admin, and answers names of
// providers with their keys set and of the connect flow's secrets, never a value. start, finish,
// disconnect and sync/describe need the signed-in admin's JWT; pending and discard need a signed-in
// JWT, and only whoever started the connection learns what it is or may discard it; sync/run needs the JWT of someone allowed to sync the source,
// which row level security decides. A Rococo admin counts only as the database defines one, with
// a confirmed email (http.ts). The provider reaches callback with no JWT at all, so this function
// verifies its own signed state and the gateway's JWT check is off for it; every callback outcome
// is a bare redirect carrying a known key at most. The hourly cron reaches sync/tick with the
// shared secret instead. A state is good for one callback: start records its nonce in
// connection_states (0029) and callback takes it off that table as it redeems it. Providers are
// entries in the registry (oauth.ts), never a branch on the company. The sync routes (sync.ts) live
// in this function so it stays the only reader of connection_tokens.
//
// Environment (Supabase secrets): CONNECTIONS_STATE_SECRET, TOKEN_ENCRYPTION_KEY (32 random bytes,
// base64), TOKEN_ENCRYPTION_KEY_PREVIOUS (optional, during a rotation), APP_URL (the app's address,
// where a callback with no usable state is sent), APP_ORIGINS (comma separated origins the browser
// may be sent back to; localhost is always allowed), GHL_CLIENT_ID, GHL_CLIENT_SECRET,
// QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_ENVIRONMENT (sandbox or production), GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, SYNC_CRON_SECRET (the secret the hourly tick sends). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  PENDING_GONE,
  PENDING_SOMEONE_ELSE,
  allowedReturn,
  failureLocation,
  fallbackReturn,
  isPendingId,
  pendingVerdict,
  recheckReturn,
  withQuery,
} from "../_shared/connectFlow.ts";
import { readState, signState } from "../_shared/connectState.ts";
import { NO_STORE } from "../_shared/headers.ts";
import { flowSecretsReady, keysPresent } from "../_shared/providerSecrets.ts";
import { TOKENS_NOT_SET_UP, TokenKeyError, loadTokenKeys, openTokens, sealTokens, tokenKeyProblem, type TokenKeys } from "../_shared/tokenCrypto.ts";
import { CORS, HttpError, json, requireAdmin, requireMember, service, signedInProfileId } from "./http.ts";
import { ConnectError, REDIRECT_URI, credentialsFor, providerFor, readCredentials, revokeGrant } from "./oauth.ts";
import { claimPending, loadPending, parkPending, sweepExpiredPending } from "./pending.ts";
import { handleSyncDescribe, handleSyncRun, handleSyncTick } from "./sync.ts";

const STATE_SECRET = Deno.env.get("CONNECTIONS_STATE_SECRET") ?? "";
const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const STATE_TTL_SECONDS = 10 * 60;
const NOT_SAVED = "The connection could not be saved.";

const readEnv = (name: string) => Deno.env.get(name);

// A bare redirect: no body, never cached, and no Referer carrying the address onward. Location is
// left off only when there is nowhere to send the browser (neither APP_URL nor APP_ORIGINS is set).
const redirect = (location: string | null) =>
  new Response(null, { status: 302, headers: { ...NO_STORE, "Referrer-Policy": "no-referrer", ...(location ? { Location: location } : {}) } });

// Where the browser may be sent back to: the app's own origins, and localhost for development.
function checkReturnTo(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Missing return address.");
  const returnTo = allowedReturn(value, APP_ORIGINS);
  if (!returnTo) throw new HttpError(400, "The return address is not one of the app's own.");
  return returnTo;
}

// The token keys for a route a signed-in admin called: unusable keys answer 503 with the setup line.
async function tokenKeysOr503(): Promise<TokenKeys> {
  try {
    return await loadTokenKeys(readEnv);
  } catch (err) {
    if (err instanceof TokenKeyError) throw new HttpError(503, TOKENS_NOT_SET_UP);
    throw err;
  }
}

async function readPendingId(req: Request): Promise<unknown> {
  const body = (await req.json().catch(() => ({}))) as { pending_id?: unknown } | null;
  return body?.pending_id;
}

async function handleStatus(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown };
  if (typeof body.company_id !== "string" || !body.company_id) throw new HttpError(400, "Say which company.");
  await requireMember(req, body.company_id);
  // Booleans only. A bad TOKEN_ENCRYPTION_KEY_PREVIOUS is reported under its own name.
  return json(200, { keys: keysPresent(readEnv), secrets: flowSecretsReady(readEnv) });
}

async function handleStart(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; provider?: unknown; return_to?: unknown };
  if (typeof body.company_id !== "string" || !body.company_id) throw new HttpError(400, "Missing company.");
  const def = providerFor(body.provider);
  const returnTo = checkReturnTo(body.return_to);
  const profileId = await requireAdmin(req, body.company_id);
  // Without the state secret or usable token keys a sign-in could start but never finish.
  if (Object.values(flowSecretsReady(readEnv)).includes(false)) throw new HttpError(503, TOKENS_NOT_SET_UP);
  const { clientId } = credentialsFor(def);
  const nonce = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const state = await signState({ c: body.company_id, p: def.key, u: profileId, r: returnTo, n: nonce, e: expires }, STATE_SECRET);
  const admin = service();
  // States nobody came back with are swept here, while we are at the table anyway. Best effort: a
  // failed sweep leaves rows that are already useless, and must not stop a connection starting.
  const { error: sweepError } = await admin.from("connection_states").delete().lt("expires_at", new Date().toISOString());
  if (sweepError) console.error("expired state sweep failed", sweepError.code ?? "unknown");
  // Pending connections nobody confirmed go too, each grant handed back. Best effort as well.
  try {
    await sweepExpiredPending(admin, new Date());
  } catch (err) {
    console.error("pending sweep failed", err instanceof Error ? err.name : "unknown");
  }
  // The nonce the callback must find, good until the state itself expires.
  const { error: nonceError } = await admin.from("connection_states").insert({ nonce, company_id: body.company_id, expires_at: new Date(expires * 1000).toISOString() });
  if (nonceError) throw new HttpError(500, "The connection could not be started. Try again.");
  return json(200, { url: def.authorizeUrl({ clientId, redirectUri: REDIRECT_URI, state }) });
}

// Every outcome is a bare 302. A state that does not verify goes to the app's fallback address
// with the generic key; once a state verifies, every outcome but success is a ConnectError thrown
// inside the one try, and the catch turns it into its key on the state's own return address. The
// return address is checked again against APP_ORIGINS as they are now. Success sends the browser
// back with the fresh pending id and nothing else.
async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fallback = fallbackReturn(readEnv("APP_URL"), APP_ORIGINS);
  const reading = recheckReturn(await readState(url.searchParams.get("state"), STATE_SECRET, Math.floor(Date.now() / 1000)), APP_ORIGINS, fallback);
  if (reading.kind !== "valid") return redirect(failureLocation(reading, fallback, "invalid"));
  const claims = reading.claims;
  try {
    // Single use. The signature proves this function wrote the state, not that this is the first
    // time it has come back: a state read out of browser history or a request log within its ten
    // minutes would otherwise park a sign-in from whatever account the code came from. Deleting
    // the nonce as it is redeemed means a second callback with the same state finds nothing.
    const admin = service();
    const { data: redeemed, error: redeemError } = await admin
      .from("connection_states")
      .delete()
      .eq("nonce", claims.n)
      .eq("company_id", claims.c)
      .select("nonce")
      .maybeSingle();
    if (redeemError) {
      console.error("state redeem failed", redeemError.code ?? "unknown");
      throw new ConnectError("failed");
    }
    if (!redeemed) throw new ConnectError("expired");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("error")) throw new ConnectError("cancelled");
    // The provider comes from the signed state, never from the request.
    const def = providerFor(claims.p);
    const creds = readCredentials(def);
    if (tokenKeyProblem(readEnv) !== null || !creds) throw new ConnectError("not_set_up");
    const keys = await loadTokenKeys(readEnv);
    const exchanged = await def.exchange({ ...creds, code, redirectUri: REDIRECT_URI, query: url.searchParams });
    let pendingId: string;
    try {
      pendingId = await parkPending(admin, { companyId: claims.c, provider: def.key, startedBy: claims.u, exchanged }, keys, new Date());
    } catch {
      // Nothing can finish a sign-in that was not parked, so hand the grant straight back.
      await revokeGrant(def, { accessToken: exchanged.accessToken, refreshToken: exchanged.refreshToken });
      throw new ConnectError("failed");
    }
    return redirect(withQuery(claims.r, { pending: pendingId }));
  } catch (err) {
    if (err instanceof ConnectError) return redirect(failureLocation(reading, fallback, err.key));
    console.error("callback failed", err instanceof Error ? err.name : "unknown");
    return redirect(failureLocation(reading, fallback, "failed"));
  }
}

// What the app shows on the confirm panel. Only the starter sees the tool, the account name and
// the company; anyone else learns only that it is someone else's, and an expired or unknown id
// reads as gone.
async function handlePending(req: Request): Promise<Response> {
  const profileId = await signedInProfileId(req);
  const pendingId = await readPendingId(req);
  if (!isPendingId(pendingId)) return json(200, { status: "gone" });
  const admin = service();
  const row = await loadPending(admin, pendingId);
  const verdict = pendingVerdict(row, profileId, new Date());
  if (verdict !== "ready" || !row) return json(200, { status: verdict === "someone_else" ? "someone_else" : "gone" });
  const { data: company, error } = await admin.from("companies").select("name").eq("id", row.company_id).maybeSingle();
  if (error || !company) throw new HttpError(500, "The connection could not be read.");
  return json(200, { status: "ready", provider: row.provider, account_name: row.account_name, company_name: company.name as string });
}

async function handleFinish(req: Request): Promise<Response> {
  const profileId = await signedInProfileId(req);
  const pendingId = await readPendingId(req);
  if (!isPendingId(pendingId)) throw new HttpError(410, PENDING_GONE);
  const admin = service();
  const row = await loadPending(admin, pendingId);
  const verdict = pendingVerdict(row, profileId, new Date());
  if (verdict === "someone_else") throw new HttpError(403, PENDING_SOMEONE_ELSE);
  if (verdict !== "ready" || !row) throw new HttpError(410, PENDING_GONE);
  // The starter must still be an active owner or admin of the company, or a Rococo admin.
  await requireAdmin(req, row.company_id);
  const keys = await tokenKeysOr503();
  const def = providerFor(row.provider);
  // Claim first, then write: this deliberately reverses the design's "write, then delete" order,
  // because the claim is what stops two finishes applying one sign-in.
  const claimed = await claimPending(admin, row.id);
  if (!claimed) throw new HttpError(410, PENDING_GONE);
  // The row is ours and gone from the table, so from here any failure hands the grant back:
  // nothing else could ever find it to revoke.
  let opened: Awaited<ReturnType<typeof openTokens>> | null = null;
  let connectionId: string | null = null;
  try {
    opened = await openTokens({ pendingId: claimed.id }, claimed, keys);
    // It may have expired between the read and the claim; an expired sign-in is never applied.
    if (pendingVerdict(claimed, profileId, new Date()) !== "ready") {
      await revokeGrant(def, opened);
      return json(410, { error: PENDING_GONE });
    }
    const connectedAt = new Date().toISOString();
    const { data: connection, error: connectionError } = await admin
      .from("company_connections")
      .upsert(
        {
          company_id: claimed.company_id,
          provider: def.key,
          status: "connected",
          external_account_name: claimed.account_name,
          scopes: claimed.scopes,
          connected_by: claimed.started_by,
          connected_at: connectedAt,
          last_error: null,
        },
        { onConflict: "company_id,provider" },
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw new Error("The connection row could not be written.");
    connectionId = connection.id as string;
    const sealed = await sealTokens({ connectionId }, { accessToken: opened.accessToken, refreshToken: opened.refreshToken, accountId: opened.accountId }, keys);
    const { error: tokenError } = await admin.from("connection_tokens").upsert(
      {
        connection_id: connectionId,
        ...sealed,
        access_expires_at: claimed.access_expires_at,
        refresh_expires_at: claimed.refresh_expires_at,
        updated_at: connectedAt,
      },
      { onConflict: "connection_id" },
    );
    if (tokenError) throw new Error("The tokens could not be written.");
    return json(200, { ok: true, provider: def.key });
  } catch (err) {
    console.error("finish failed", err instanceof Error ? err.name : "unknown");
    if (connectionId) {
      // A row must never read Connected without its own tokens. Put it back to not connected,
      // which also fires clear_connection_tokens for any earlier account's tokens.
      const { error: undoError } = await admin
        .from("company_connections")
        .update({ status: "not_connected", external_account_name: null, scopes: null, connected_at: null, last_error: null })
        .eq("id", connectionId);
      if (undoError) console.error("undo after failed token save", undoError.code ?? "unknown");
    }
    if (opened) await revokeGrant(def, opened);
    throw new HttpError(500, NOT_SAVED);
  }
}

// The starter drops a pending connection: the row goes and the grant is handed back, best effort.
async function handleDiscard(req: Request): Promise<Response> {
  const profileId = await signedInProfileId(req);
  const pendingId = await readPendingId(req);
  if (!isPendingId(pendingId)) throw new HttpError(410, PENDING_GONE);
  const admin = service();
  const row = await loadPending(admin, pendingId);
  const verdict = pendingVerdict(row, profileId, new Date());
  if (verdict === "someone_else") throw new HttpError(403, PENDING_SOMEONE_ELSE);
  if (verdict !== "ready" || !row) throw new HttpError(410, PENDING_GONE);
  const claimed = await claimPending(admin, row.id);
  if (!claimed) throw new HttpError(410, PENDING_GONE);
  let revoked = false;
  try {
    const keys = await loadTokenKeys(readEnv);
    revoked = await revokeGrant(providerFor(claimed.provider), await openTokens({ pendingId: claimed.id }, claimed, keys));
  } catch (err) {
    console.error("discard revoke skipped", claimed.provider, err instanceof Error ? err.name : "unknown");
  }
  return json(200, { ok: true, revoked });
}

// Our side goes either way; revoked says whether the provider confirmed it let go too. No row
// means nothing is attached anywhere, so that reads as revoked.
async function handleDisconnect(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; provider?: unknown };
  if (typeof body.company_id !== "string" || !body.company_id) throw new HttpError(400, "Missing company.");
  const def = providerFor(body.provider);
  await requireAdmin(req, body.company_id);
  const admin = service();
  // A failed read is not "nothing to disconnect": answering ok then would leave the grant and the
  // tokens in place while the panel reloads and still reads Connected, with nothing said.
  const { data: row, error: lookupError } = await admin.from("company_connections").select("id").eq("company_id", body.company_id).eq("provider", def.key).maybeSingle();
  if (lookupError) throw new HttpError(500, "The connection could not be removed.");
  if (!row) return json(200, { ok: true, revoked: true });
  const { data: tokens, error: tokensError } = await admin.from("connection_tokens").select("access_token, refresh_token, account_id").eq("connection_id", row.id).maybeSingle();
  if (tokensError) throw new HttpError(500, "The connection could not be removed.");
  let revoked = false;
  if (tokens) {
    // Best effort: missing keys or tokens that no longer open only mean the provider is not asked.
    try {
      const keys = await loadTokenKeys(readEnv);
      const opened = await openTokens({ connectionId: row.id as string }, tokens as { access_token: string; refresh_token: string | null; account_id: string | null }, keys);
      revoked = await revokeGrant(def, opened);
    } catch (err) {
      console.error("disconnect revoke skipped", def.key, err instanceof Error ? err.name : "unknown");
    }
  }
  await admin.from("connection_tokens").delete().eq("connection_id", row.id);
  const { error } = await admin
    .from("company_connections")
    .update({ status: "not_connected", external_account_name: null, scopes: null, connected_at: null, last_error: null })
    .eq("id", row.id);
  if (error) throw new HttpError(500, "The connection could not be removed.");
  return json(200, { ok: true, revoked });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "POST" && path.endsWith("/sync/run")) return await handleSyncRun(req);
    if (req.method === "POST" && path.endsWith("/sync/tick")) return await handleSyncTick(req);
    if (req.method === "POST" && path.endsWith("/sync/describe")) return await handleSyncDescribe(req);
    if (req.method === "POST" && path.endsWith("/status")) return await handleStatus(req);
    if (req.method === "POST" && path.endsWith("/start")) return await handleStart(req);
    if (req.method === "GET" && path.endsWith("/callback")) return await handleCallback(req);
    if (req.method === "POST" && path.endsWith("/pending")) return await handlePending(req);
    if (req.method === "POST" && path.endsWith("/finish")) return await handleFinish(req);
    if (req.method === "POST" && path.endsWith("/discard")) return await handleDiscard(req);
    if (req.method === "POST" && path.endsWith("/disconnect")) return await handleDisconnect(req);
    return json(404, { error: "No such route." });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("connections failed", err instanceof Error ? err.name : "unknown");
    return json(500, { error: "Something went wrong on our side." });
  }
});
