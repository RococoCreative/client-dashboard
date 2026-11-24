// The connect flow's rules, kept pure so they are tested outside the function and shared with the
// app: the error keys a provider return may carry and the one line the app shows for each, who may
// finish a pending connection, the reader of the /pending answer, and where the
// callback sends the browser when a sign-in does not finish. The callback only ever puts a key in
// the address; the app turns it into words, so nothing a caller sends is ever shown as text.
import type { StateReading } from "./connectState.ts";
import { PROVIDER_KEYS, type ProviderKey } from "./providers.ts";

export const CONNECT_ERROR_TEXT = {
  cancelled: "The sign-in was cancelled or refused. Nothing changed.",
  expired: "This sign-in link was already used or has expired. Start the connection again.",
  not_set_up: "This tool is not set up yet. Ask Rococo Creative to finish the setup.",
  refused: "The tool refused the sign-in. Try again from Settings.",
  one_location: "Choose one sub-account when installing; an agency-wide install is not supported.",
  no_account: "The tool did not say which account was connected. Try again from Settings.",
  failed: "The connection could not be finished. Try again from Settings.",
  invalid: "The connection did not finish. Start again from Settings.",
} as const;

export type ConnectErrorKey = keyof typeof CONNECT_ERROR_TEXT;

// A known key's line; anything else, including an old full sentence, reads as the generic line.
export function connectErrorText(value: string | null): string | null {
  if (value === null) return null;
  return Object.hasOwn(CONNECT_ERROR_TEXT, value) ? CONNECT_ERROR_TEXT[value as ConnectErrorKey] : CONNECT_ERROR_TEXT.invalid;
}

// How long a pending connection waits for its starter to confirm it.
export const PENDING_TTL_SECONDS = 600;

export const PENDING_SOMEONE_ELSE = "This connection was started by someone else, so it can't be finished here. Ask them to finish it, or start again.";
export const PENDING_GONE = "This connection request has expired. Start the connection again.";

export type PendingVerdict = "ready" | "someone_else" | "gone";

// Expiry first, so an expired row tells nobody who started it. Whether the starter is still an
// owner or admin of the company is the function's check against the database, not this one.
export function pendingVerdict(row: { started_by: string; expires_at: string } | null, callerProfileId: string, now: Date): PendingVerdict {
  if (!row) return "gone";
  if (!(Date.parse(row.expires_at) > now.getTime())) return "gone";
  return row.started_by === callerProfileId ? "ready" : "someone_else";
}

export type PendingAnswer = { status: "ready"; provider: ProviderKey; account_name: string | null; company_name: string } | { status: "someone_else" } | { status: "gone" };

// The /pending answer as the app reads it, or null when it is not one of the three shapes.
export function parsePendingAnswer(value: unknown): PendingAnswer | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.status === "someone_else" || v.status === "gone") return { status: v.status };
  if (v.status !== "ready") return null;
  if (typeof v.provider !== "string" || !(PROVIDER_KEYS as readonly string[]).includes(v.provider)) return null;
  if (typeof v.company_name !== "string") return null;
  if (v.account_name !== null && typeof v.account_name !== "string") return null;
  return { status: "ready", provider: v.provider as ProviderKey, account_name: v.account_name, company_name: v.company_name };
}

// The id the callback mints for a pending connection: a uuid, in either case.
export function isPendingId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function withQuery(base: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

function webOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// Where a callback with no verified state sends the browser: the app's Connections page on
// APP_URL's origin, else on the first APP_ORIGINS entry, or null when neither is a web address.
export function fallbackReturn(appUrl: string | undefined, appOrigins: readonly string[]): string | null {
  const origin = webOrigin(appUrl) ?? webOrigin(appOrigins[0]);
  return origin ? `${origin}/settings/connections` : null;
}

// A verified state returns to its own address with the key; an expired one says so; anything else
// goes to the fallback with the generic key, or nowhere when there is no fallback.
export function failureLocation(reading: StateReading, fallback: string | null, key: ConnectErrorKey): string | null {
  if (reading.kind === "valid") return withQuery(reading.claims.r, { connect_error: key });
  if (reading.kind === "expired") return withQuery(reading.claims.r, { connect_error: "expired" });
  return fallback ? withQuery(fallback, { connect_error: "invalid" }) : null;
}
