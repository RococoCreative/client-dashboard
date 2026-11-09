// A company's own QuickBooks Online books, read and never written. The client has one method,
// query, and it is a GET; every entity is projected through the source's field map before it
// leaves this file, so only mapped fields can ever reach sync_records. QuickBooks rotates refresh
// tokens, so a new one is saved before any data call, and the runner holds the connection's lock
// while this runs, so two syncs never spend the same refresh token. fetch is injected, so all of
// it is unit-tested without the network, and no token or response body reaches an error message.
import type { CellValue, FieldMapEntry, ProviderAdapter, ProviderTokens, RawTable, TokenStore } from "./types.ts";

export const QBO_PAGE_SIZE = 1000;
export const QBO_MAX_PAGES = 50;
export const QBO_MINOR_VERSION = 75;

type QboEntity = "Invoice" | "Payment";
type QboEnvironment = "sandbox" | "production";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REFRESH_MARGIN_MS = 5 * 60000;

const RECONNECT = "Connect QuickBooks again in Settings.";
const EXPIRED = `QuickBooks sign-in has expired. ${RECONNECT}`;
const NO_ANSWER = "QuickBooks did not answer. Try again later.";

export function qboApiBase(environment: QboEnvironment): string {
  return environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

// One leaf of an entity by a dotted path: CustomerRef.name, or Line.0.Amount through an array. A
// missing step, or a path that ends on an object or array, reads as null, so a field map can only
// ever pick out single values.
export function getPath(obj: unknown, path: string): CellValue {
  if (!path.trim()) return null;
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return null;
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return null;
      current = current[segment];
    } else {
      return null;
    }
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean" ? current : null;
}

// Each entity cut down to the field map's own headers, in its order. Nothing else is kept.
export function projectEntities(entities: Record<string, unknown>[], fieldMap: FieldMapEntry[], realmId: string, entity: QboEntity, sandbox: boolean): RawTable {
  return {
    headers: fieldMap.map((f) => f.header),
    rows: entities.map((e) => ({
      cells: fieldMap.map((f) => getPath(e, f.header)),
      ref: { entity, Id: String(e.Id ?? ""), realmId, sandbox },
    })),
  };
}

export interface QboClientDeps { fetch: typeof fetch; environment: QboEnvironment; realmId: string; accessToken: string }

// The only call this file makes to the accounting API.
export function createQboClient(deps: QboClientDeps): { query(sql: string, start: number, max: number): Promise<Record<string, unknown>[]> } {
  return {
    async query(sql, start, max) {
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(max) || max < 1 || max > QBO_PAGE_SIZE) {
        throw new Error("The QuickBooks page is out of range.");
      }
      const q = encodeURIComponent(`${sql} startposition ${start} maxresults ${max}`);
      const url = `${qboApiBase(deps.environment)}/v3/company/${encodeURIComponent(deps.realmId)}/query?query=${q}&minorversion=${QBO_MINOR_VERSION}`;
      const response = await deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${deps.accessToken}`, Accept: "application/json" } });
      if (response.status === 401) throw new Error(`QuickBooks refused the sign-in. ${RECONNECT}`);
      if (response.status === 403) throw new Error("QuickBooks refused access to these records.");
      if (response.status === 429) throw new Error("QuickBooks asked us to slow down. Try again in a few minutes.");
      if (!response.ok) throw new Error(NO_ANSWER);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(NO_ANSWER);
      }
      if (!isRecord(body)) throw new Error(NO_ANSWER);
      if ("Fault" in body) throw new Error("QuickBooks could not run the query.");
      // An answer with no QueryResponse at all is not an empty page: reading it as one would
      // replace the company's last good data with nothing.
      if (!isRecord(body.QueryResponse)) throw new Error(NO_ANSWER);
      const rows = Object.values(body.QueryResponse).find(Array.isArray);
      return (rows ?? []) as Record<string, unknown>[];
    },
  };
}

export interface QuickBooksDeps { clientId: string; clientSecret: string; tokens: TokenStore; fetch: typeof fetch; environment: QboEnvironment; now: () => Date }

function entityOf(config: unknown): QboEntity | null {
  if (!isRecord(config)) return null;
  return config.entity === "Invoice" || config.entity === "Payment" ? config.entity : null;
}

// A usable access token. One within five minutes of expiry, or with none on file, is refreshed and
// the new pair saved before anything reads: QuickBooks retires the old refresh token as soon as it
// issues a new one, so a pair that is not saved is a sign-in lost.
async function accessToken(deps: QuickBooksDeps, connectionId: string): Promise<string> {
  const old = await deps.tokens.load(connectionId);
  const now = deps.now().getTime();
  if (old.accessExpiresAt !== null && Date.parse(old.accessExpiresAt) - now > REFRESH_MARGIN_MS) return old.accessToken;
  if (!old.refreshToken || (old.refreshExpiresAt !== null && !(Date.parse(old.refreshExpiresAt) > now))) throw new Error(EXPIRED);
  const response = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${deps.clientId}:${deps.clientSecret}`)}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: old.refreshToken }).toString(),
  });
  if (!response.ok) throw new Error(EXPIRED);
  let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; x_refresh_token_expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error(EXPIRED);
  }
  if (!isRecord(body) || typeof body.access_token !== "string" || !body.access_token) throw new Error(EXPIRED);
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  const refreshIn = typeof body.x_refresh_token_expires_in === "number" && body.x_refresh_token_expires_in > 0 ? body.x_refresh_token_expires_in : null;
  const next: ProviderTokens = {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : old.refreshToken,
    accessExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: refreshIn !== null ? new Date(now + refreshIn * 1000).toISOString() : old.refreshExpiresAt,
  };
  try {
    await deps.tokens.save(connectionId, next);
  } catch {
    throw new Error(`The new QuickBooks sign-in could not be saved. ${RECONNECT}`);
  }
  return next.accessToken;
}

export function createQuickBooksAdapter(deps: QuickBooksDeps): ProviderAdapter {
  return {
    provider: "quickbooks",
    async read(source, connection) {
      const entity = entityOf(source.config);
      if (!entity) throw new Error("This source is not set up for QuickBooks.");
      const realmId = connection.external_account_id;
      if (typeof realmId !== "string" || !realmId.trim()) throw new Error(`QuickBooks did not say which company is connected. ${RECONNECT}`);
      const token = await accessToken(deps, connection.id);
      const client = createQboClient({ fetch: deps.fetch, environment: deps.environment, realmId, accessToken: token });
      // The entity is one of two literals, never text from a person.
      const sql = `select * from ${entity} orderby Id`;
      const all: Record<string, unknown>[] = [];
      for (let page = 0; page < QBO_MAX_PAGES; page++) {
        const rows = await client.query(sql, 1 + page * QBO_PAGE_SIZE, QBO_PAGE_SIZE);
        all.push(...rows);
        if (rows.length < QBO_PAGE_SIZE) return projectEntities(all, source.field_map, realmId, entity, deps.environment === "sandbox");
      }
      throw new Error("QuickBooks returned more records than one sync reads (50,000).");
    },
  };
}
