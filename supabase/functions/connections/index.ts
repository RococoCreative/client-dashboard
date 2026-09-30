// The one place Company Hub talks to an outside system's sign-in. A company's admin connects
// that company's own GoHighLevel or QuickBooks account from Settings; the tokens land in
// connection_tokens, which only this function (holding the service role) can read. The browser
// never sees a provider secret or token, and nothing is shared between companies.
//
// Routes, all under /functions/v1/connections:
//   POST /start        { company_id, provider, return_to }   -> { url } to send the browser to
//   GET  /callback     ?code&state[&realmId]                 -> redirect back to return_to
//   POST /disconnect   { company_id, provider }              -> { ok: true }
//
// start and disconnect need the signed-in admin's JWT. The provider reaches callback with no
// JWT at all, so this function verifies its own signed state and the gateway's JWT check is
// off for it. Providers are entries in the registry below, never a branch on the company.
//
// Environment (Supabase secrets): CONNECTIONS_STATE_SECRET, APP_ORIGINS (comma separated
// origins the browser may be sent back to; localhost is always allowed), GHL_CLIENT_ID,
// GHL_CLIENT_SECRET, QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_ENVIRONMENT (sandbox or production).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Provider = "gohighlevel" | "quickbooks";

interface Exchanged {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  externalAccountId: string;
  externalAccountName: string | null;
  scopes: string | null;
}

interface Credentials {
  clientId: string;
  clientSecret: string;
}

interface ProviderDef {
  label: string;
  env: { id: string; secret: string };
  authorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string;
  exchange(args: Credentials & { code: string; redirectUri: string; query: URLSearchParams }): Promise<Exchanged>;
  revoke?(args: Credentials & { accessToken: string; refreshToken: string | null }): Promise<void>;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STATE_SECRET = Deno.env.get("CONNECTIONS_STATE_SECRET") ?? "";
const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/connections/callback`;
const STATE_TTL_SECONDS = 10 * 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const secondsFromNow = (seconds: number | undefined): string | null =>
  typeof seconds === "number" && Number.isFinite(seconds) ? new Date(Date.now() + seconds * 1000).toISOString() : null;

async function readJson<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    console.error(`${what} failed with ${response.status}`);
    throw new HttpError(502, `${what} was refused by the provider.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, `${what} returned something unexpected.`);
  }
}

// GoHighLevel: a sub-account (location) install. The token answer names the location; the
// location's name is fetched for the card and is not required.
const GHL_SCOPES = "opportunities.readonly users.readonly locations.readonly";
const gohighlevel: ProviderDef = {
  label: "GoHighLevel",
  env: { id: "GHL_CLIENT_ID", secret: "GHL_CLIENT_SECRET" },
  authorizeUrl: ({ clientId, redirectUri, state }) => {
    const q = new URLSearchParams({ response_type: "code", redirect_uri: redirectUri, client_id: clientId, scope: GHL_SCOPES, state });
    return `https://marketplace.gohighlevel.com/oauth/chooselocation?${q.toString()}`;
  },
  exchange: async ({ clientId, clientSecret, code, redirectUri }) => {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, user_type: "Location", redirect_uri: redirectUri });
    const response = await fetch("https://services.leadconnectorhq.com/oauth/token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = await readJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; locationId?: string; userType?: string }>(response, "The GoHighLevel sign-in");
    if (!token.locationId) throw new HttpError(400, "Choose one sub-account when installing; an agency-wide install is not supported.");
    let name: string | null = null;
    try {
      const located = await fetch(`https://services.leadconnectorhq.com/locations/${token.locationId}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Version: "2021-07-28", Accept: "application/json" },
      });
      if (located.ok) name = ((await located.json()) as { location?: { name?: string } }).location?.name ?? null;
    } catch {
      name = null;
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      accessExpiresAt: secondsFromNow(token.expires_in),
      refreshExpiresAt: null,
      externalAccountId: token.locationId,
      externalAccountName: name,
      scopes: token.scope ?? GHL_SCOPES,
    };
  },
};

// QuickBooks Online: the callback carries the realm (company) id; the token endpoint takes the
// client keys as basic auth. Sandbox and production differ only in the API base for the name.
const QBO_SCOPES = "com.intuit.quickbooks.accounting";
const qboApiBase = () => (Deno.env.get("QBO_ENVIRONMENT") === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");
const basic = (clientId: string, clientSecret: string) => `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
const quickbooks: ProviderDef = {
  label: "QuickBooks Online",
  env: { id: "QBO_CLIENT_ID", secret: "QBO_CLIENT_SECRET" },
  authorizeUrl: ({ clientId, redirectUri, state }) => {
    const q = new URLSearchParams({ client_id: clientId, response_type: "code", scope: QBO_SCOPES, redirect_uri: redirectUri, state });
    return `https://appcenter.intuit.com/connect/oauth2?${q.toString()}`;
  },
  exchange: async ({ clientId, clientSecret, code, redirectUri, query }) => {
    const realmId = query.get("realmId");
    if (!realmId) throw new HttpError(400, "QuickBooks did not say which company was connected.");
    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: { Authorization: basic(clientId, clientSecret), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    const token = await readJson<{ access_token: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number }>(response, "The QuickBooks sign-in");
    let name: string | null = null;
    try {
      const info = await fetch(`${qboApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      });
      if (info.ok) name = ((await info.json()) as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName ?? null;
    } catch {
      name = null;
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      accessExpiresAt: secondsFromNow(token.expires_in),
      refreshExpiresAt: secondsFromNow(token.x_refresh_token_expires_in),
      externalAccountId: realmId,
      externalAccountName: name,
      scopes: QBO_SCOPES,
    };
  },
  revoke: async ({ clientId, clientSecret, accessToken, refreshToken }) => {
    await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
      method: "POST",
      headers: { Authorization: basic(clientId, clientSecret), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken ?? accessToken }),
    });
  },
};

const PROVIDERS: Record<Provider, ProviderDef> = { gohighlevel, quickbooks };

function providerFor(value: unknown): ProviderDef & { key: Provider } {
  if (value === "gohighlevel" || value === "quickbooks") return { ...PROVIDERS[value], key: value };
  throw new HttpError(400, "Unknown provider.");
}

function credentialsFor(def: ProviderDef): Credentials {
  const clientId = Deno.env.get(def.env.id);
  const clientSecret = Deno.env.get(def.env.secret);
  if (!clientId || !clientSecret) throw new HttpError(503, `${def.label} is not set up yet. Ask Rococo Creative to add the app keys.`);
  return { clientId, clientSecret };
}

// The signed state carries everything the callback needs to finish without a session: which
// company and provider, who started it, and where to send the browser afterwards.
interface StateClaims {
  c: string; // company id
  p: Provider;
  u: string; // profile id of the admin who started it
  r: string; // return_to
  n: string; // nonce
  e: number; // expiry, unix seconds
}

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function hmac(payload: string): Promise<Uint8Array> {
  if (!STATE_SECRET) throw new HttpError(503, "Connections are not set up yet: the state secret is missing.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(STATE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signState(claims: StateClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${toBase64Url(await hmac(payload))}`;
}

async function verifyState(state: string): Promise<StateClaims> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new HttpError(400, "The sign-in link is not valid.");
  if (!sameBytes(await hmac(payload), fromBase64Url(signature))) throw new HttpError(400, "The sign-in link is not valid.");
  const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as StateClaims;
  if (typeof claims.e !== "number" || claims.e < Math.floor(Date.now() / 1000)) throw new HttpError(400, "The sign-in link has expired. Start again from Settings.");
  return claims;
}

// Where the browser may be sent back to: the app's own origins, and localhost for development.
function checkReturnTo(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Missing return address.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "The return address is not a URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local && !APP_ORIGINS.includes(url.origin)) throw new HttpError(400, "The return address is not one of the app's own.");
  return `${url.origin}${url.pathname}`;
}

// The signed-in person, checked as an admin of the company through their own JWT and the same
// row level security the app lives under. Returns their profile id.
async function requireAdmin(req: Request, companyId: string): Promise<string> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first.");
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, "Sign in first.");
  const { data: profile } = await asUser.from("profiles").select("id, role, company_id, is_rococo_admin").eq("user_id", userData.user.id).maybeSingle();
  const allowed = Boolean(profile) && (profile!.is_rococo_admin || (profile!.role === "admin" && profile!.company_id === companyId));
  if (!allowed) throw new HttpError(403, "Only a company admin can manage connections.");
  return profile!.id as string;
}

const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
const backTo = (returnTo: string, params: Record<string, string>) => redirect(`${returnTo}?${new URLSearchParams(params).toString()}`);

async function handleStart(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; provider?: unknown; return_to?: unknown };
  if (typeof body.company_id !== "string" || !body.company_id) throw new HttpError(400, "Missing company.");
  const def = providerFor(body.provider);
  const returnTo = checkReturnTo(body.return_to);
  const profileId = await requireAdmin(req, body.company_id);
  const { clientId } = credentialsFor(def);
  const state = await signState({ c: body.company_id, p: def.key, u: profileId, r: returnTo, n: crypto.randomUUID(), e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS });
  return json(200, { url: def.authorizeUrl({ clientId, redirectUri: REDIRECT_URI, state }) });
}

async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  if (!state) return json(400, { error: "Missing state." });
  const claims = await verifyState(state);
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return backTo(claims.r, { connect_error: "The sign-in was cancelled or refused. Nothing changed." });
  const def = providerFor(claims.p);
  try {
    const creds = credentialsFor(def);
    const exchanged = await def.exchange({ ...creds, code, redirectUri: REDIRECT_URI, query: url.searchParams });
    const admin = service();
    const now = new Date().toISOString();
    const { data: row, error: rowError } = await admin
      .from("company_connections")
      .upsert(
        {
          company_id: claims.c,
          provider: claims.p,
          status: "connected",
          external_account_id: exchanged.externalAccountId,
          external_account_name: exchanged.externalAccountName,
          scopes: exchanged.scopes,
          connected_by: claims.u,
          connected_at: now,
          last_error: null,
        },
        { onConflict: "company_id,provider" },
      )
      .select("id")
      .single();
    if (rowError || !row) throw new HttpError(500, "The connection could not be saved.");
    const { error: tokenError } = await admin.from("connection_tokens").upsert(
      {
        connection_id: row.id,
        access_token: exchanged.accessToken,
        refresh_token: exchanged.refreshToken,
        access_expires_at: exchanged.accessExpiresAt,
        refresh_expires_at: exchanged.refreshExpiresAt,
        updated_at: now,
      },
      { onConflict: "connection_id" },
    );
    if (tokenError) throw new HttpError(500, "The connection could not be saved.");
    return backTo(claims.r, { connected: claims.p });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "The connection could not be finished. Try again from Settings.";
    if (!(err instanceof HttpError)) console.error("callback failed", err);
    return backTo(claims.r, { connect_error: message });
  }
}

async function handleDisconnect(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; provider?: unknown };
  if (typeof body.company_id !== "string" || !body.company_id) throw new HttpError(400, "Missing company.");
  const def = providerFor(body.provider);
  await requireAdmin(req, body.company_id);
  const admin = service();
  const { data: row } = await admin.from("company_connections").select("id").eq("company_id", body.company_id).eq("provider", def.key).maybeSingle();
  if (!row) return json(200, { ok: true });
  const { data: tokens } = await admin.from("connection_tokens").select("access_token, refresh_token").eq("connection_id", row.id).maybeSingle();
  if (tokens && def.revoke) {
    // Best effort: the provider may already have dropped the grant. Ours goes either way.
    try {
      await def.revoke({ ...credentialsFor(def), accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
    } catch (err) {
      console.error("revoke failed", err instanceof Error ? err.message : err);
    }
  }
  await admin.from("connection_tokens").delete().eq("connection_id", row.id);
  const { error } = await admin
    .from("company_connections")
    .update({ status: "not_connected", external_account_id: null, external_account_name: null, scopes: null, connected_at: null, last_error: null })
    .eq("id", row.id);
  if (error) throw new HttpError(500, "The connection could not be removed.");
  return json(200, { ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "POST" && path.endsWith("/start")) return await handleStart(req);
    if (req.method === "GET" && path.endsWith("/callback")) return await handleCallback(req);
    if (req.method === "POST" && path.endsWith("/disconnect")) return await handleDisconnect(req);
    return json(404, { error: "No such route." });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("connections failed", err);
    return json(500, { error: "Something went wrong on our side." });
  }
});
