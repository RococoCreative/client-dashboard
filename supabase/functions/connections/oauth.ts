// The provider registry the connections function signs in with: how each outside tool is sent its
// sign-in, how its code becomes tokens, and how a grant is handed back. Providers are entries here,
// never a branch on the company. An exchange that does not give the hub what it needs throws a
// ConnectError naming one of the known keys in _shared/connectFlow.ts, so the callback only ever
// puts a key in the address and nothing a provider says is shown or logged. Logs carry a short
// message, the provider key and an HTTP status at most.
import type { ConnectErrorKey } from "../_shared/connectFlow.ts";
import { blankToNull } from "../_shared/connectFlow.ts";
import { PROVIDER_KEYS, type ProviderKey } from "../_shared/providers.ts";
import { PROVIDER_SECRETS } from "../_shared/providerSecrets.ts";
import { GOOGLE_SCOPES, emailFromIdToken, googleAuthorizeUrl, subjectFromIdToken } from "../_shared/sync/googleSheets.ts";
import { HttpError, SUPABASE_URL } from "./http.ts";

// A sign-in that did not finish, as one of the known keys. The callback maps it to its address.
export class ConnectError extends Error {
  key: ConnectErrorKey;
  constructor(key: ConnectErrorKey) {
    super(key);
    this.name = "ConnectError";
    this.key = key;
  }
}

export interface Exchanged {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  externalAccountId: string;
  externalAccountName: string | null;
  scopes: string | null;
}

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface ProviderDef {
  label: string;
  env: { id: string; secret: string };
  authorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string;
  exchange(args: Credentials & { code: string; redirectUri: string; query: URLSearchParams }): Promise<Exchanged>;
  // True only when the provider answered that the grant is revoked.
  revoke?(args: Credentials & { accessToken: string; refreshToken: string | null }): Promise<boolean>;
}

export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/connections/callback`;

// A revoke that does not answer in time reads as not revoked rather than holding a route open.
const REVOKE_TIMEOUT_MS = 10_000;

const secondsFromNow = (seconds: number | undefined): string | null =>
  typeof seconds === "number" && Number.isFinite(seconds) ? new Date(Date.now() + seconds * 1000).toISOString() : null;

// A token endpoint's answer: refused unless it is ok, JSON, and carries an access token. Only the
// status is logged, never the body, which may hold a code or a token.
async function tokenAnswer<T extends { access_token?: unknown }>(response: Response, provider: ProviderKey): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel();
    console.error("token exchange refused", provider, response.status);
    throw new ConnectError("refused");
  }
  let token: T;
  try {
    token = (await response.json()) as T;
  } catch {
    console.error("token exchange unreadable", provider);
    throw new ConnectError("refused");
  }
  if (typeof token !== "object" || token === null || typeof token.access_token !== "string" || !token.access_token) {
    console.error("token exchange without a token", provider);
    throw new ConnectError("refused");
  }
  return token;
}

// A revoke endpoint's answer, logged by status when it is not ok.
async function revokeAnswer(response: Response, provider: ProviderKey): Promise<boolean> {
  await response.body?.cancel();
  if (!response.ok) console.error("revoke failed", provider, response.status);
  return response.ok;
}

// GoHighLevel: a sub-account (location) install. The token answer names the location; the
// location's name is fetched for the confirm panel and is not required. HighLevel offers no revoke.
const GHL_SCOPES = "opportunities.readonly users.readonly locations.readonly";
const gohighlevel: ProviderDef = {
  label: "GoHighLevel",
  env: PROVIDER_SECRETS.gohighlevel,
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
    const token = await tokenAnswer<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; locationId?: string }>(response, "gohighlevel");
    const locationId = blankToNull(token.locationId);
    if (!locationId) throw new ConnectError("one_location");
    let name: string | null = null;
    try {
      const located = await fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Version: "2021-07-28", Accept: "application/json" },
      });
      if (located.ok) name = ((await located.json()) as { location?: { name?: string } }).location?.name ?? null;
      else await located.body?.cancel();
    } catch {
      name = null;
    }
    return {
      accessToken: token.access_token,
      refreshToken: blankToNull(token.refresh_token),
      accessExpiresAt: secondsFromNow(token.expires_in),
      refreshExpiresAt: null,
      externalAccountId: locationId,
      externalAccountName: blankToNull(name),
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
  env: PROVIDER_SECRETS.quickbooks,
  authorizeUrl: ({ clientId, redirectUri, state }) => {
    const q = new URLSearchParams({ client_id: clientId, response_type: "code", scope: QBO_SCOPES, redirect_uri: redirectUri, state });
    return `https://appcenter.intuit.com/connect/oauth2?${q.toString()}`;
  },
  exchange: async ({ clientId, clientSecret, code, redirectUri, query }) => {
    const realmId = blankToNull(query.get("realmId"));
    if (!realmId) throw new ConnectError("no_account");
    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: { Authorization: basic(clientId, clientSecret), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    const token = await tokenAnswer<{ access_token: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number }>(response, "quickbooks");
    let name: string | null = null;
    try {
      const realm = encodeURIComponent(realmId);
      const info = await fetch(`${qboApiBase()}/v3/company/${realm}/companyinfo/${realm}?minorversion=75`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      });
      if (info.ok) name = ((await info.json()) as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName ?? null;
      else await info.body?.cancel();
    } catch {
      name = null;
    }
    return {
      accessToken: token.access_token,
      refreshToken: blankToNull(token.refresh_token),
      accessExpiresAt: secondsFromNow(token.expires_in),
      refreshExpiresAt: secondsFromNow(token.x_refresh_token_expires_in),
      externalAccountId: realmId,
      externalAccountName: blankToNull(name),
      scopes: QBO_SCOPES,
    };
  },
  revoke: async ({ clientId, clientSecret, accessToken, refreshToken }) => {
    const response = await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
      method: "POST",
      headers: { Authorization: basic(clientId, clientSecret), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken ?? accessToken }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    return revokeAnswer(response, "quickbooks");
  },
};

// Google Sheets: the company's own Google account, read-only. The id token comes straight from
// Google's token endpoint over TLS (see emailFromIdToken). The display name is the account's email
// address, which the admin must see to confirm; the account id sealed beside the tokens is the
// token's sub, Google's stable id for the account, so no id is ever the name the browser reads.
const google_sheets: ProviderDef = {
  label: "Google Sheets",
  env: PROVIDER_SECRETS.google_sheets,
  authorizeUrl: ({ clientId, redirectUri, state }) => googleAuthorizeUrl({ clientId, redirectUri, state }),
  exchange: async ({ clientId, clientSecret, code, redirectUri }) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const token = await tokenAnswer<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string }>(response, "google_sheets");
    const email = typeof token.id_token === "string" ? emailFromIdToken(token.id_token) : null;
    if (!email) throw new ConnectError("no_account");
    return {
      accessToken: token.access_token,
      refreshToken: blankToNull(token.refresh_token),
      accessExpiresAt: secondsFromNow(token.expires_in),
      refreshExpiresAt: null,
      externalAccountId: (typeof token.id_token === "string" ? subjectFromIdToken(token.id_token) : null) ?? "",
      externalAccountName: email,
      scopes: token.scope ?? GOOGLE_SCOPES,
    };
  },
  revoke: async ({ accessToken, refreshToken }) => {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken ?? accessToken }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    return revokeAnswer(response, "google_sheets");
  },
};

const PROVIDERS: Record<ProviderKey, ProviderDef> = { gohighlevel, quickbooks, google_sheets };

export function providerFor(value: unknown): ProviderDef & { key: ProviderKey } {
  if (typeof value === "string" && (PROVIDER_KEYS as readonly string[]).includes(value)) {
    const key = value as ProviderKey;
    return { ...PROVIDERS[key], key };
  }
  throw new HttpError(400, "Unknown provider.");
}

// The provider's app keys, or null when either is unset.
export function readCredentials(def: ProviderDef): Credentials | null {
  const clientId = Deno.env.get(def.env.id);
  const clientSecret = Deno.env.get(def.env.secret);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function credentialsFor(def: ProviderDef): Credentials {
  const credentials = readCredentials(def);
  if (!credentials) throw new HttpError(503, `${def.label} is not set up yet. Ask Rococo Creative to add the app keys.`);
  return credentials;
}

// Hands a grant back to the provider, best effort. True only when the provider confirmed it; false
// for a provider with no revoke, missing app keys, no answer, or a refusal. Never throws.
export async function revokeGrant(def: ProviderDef & { key: ProviderKey }, tokens: { accessToken: string; refreshToken: string | null }): Promise<boolean> {
  if (!def.revoke) return false;
  const credentials = readCredentials(def);
  if (!credentials) {
    console.error("revoke failed", def.key, "not set up");
    return false;
  }
  try {
    return await def.revoke({ ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch {
    console.error("revoke failed", def.key, "no answer");
    return false;
  }
}
