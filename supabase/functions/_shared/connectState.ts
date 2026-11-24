// The signed state the connections function hands a provider at /start and reads back at
// /callback, kept pure so it is tested outside the function. It carries everything the callback
// needs without a session: which company and provider, who started it, where to send the browser,
// the single-use nonce and the expiry. The wire format is the one the function has always written,
// base64url(JSON(claims)) + "." + base64url(HMAC-SHA256(secret, payload)), so a state issued before
// a deploy still reads. Reading never throws: anything that does not verify and parse is invalid,
// and the signature is checked before the expiry, so an expired reading is still one we signed.
import { fromBase64Url, sameBytes, toBase64Url } from "./bytes.ts";
import { PROVIDER_KEYS, type ProviderKey } from "./providers.ts";

export interface StateClaims {
  c: string; // company id
  p: ProviderKey;
  u: string; // profile id of whoever started it
  r: string; // return address
  n: string; // nonce
  e: number; // expiry, unix seconds
}

export type StateReading = { kind: "valid"; claims: StateClaims } | { kind: "expired"; claims: StateClaims } | { kind: "invalid" };

const encoder = new TextEncoder();

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function signState(claims: StateClaims, secret: string): Promise<string> {
  if (!secret) throw new Error("The connect state secret is missing.");
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${toBase64Url(await hmac(payload, secret))}`;
}

// The six claims and nothing else, each of the type the function writes, or null.
function claimsFrom(value: unknown): StateClaims | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
  if (!text(v.c) || !text(v.u) || !text(v.r) || !text(v.n)) return null;
  if (typeof v.p !== "string" || !(PROVIDER_KEYS as readonly string[]).includes(v.p)) return null;
  if (typeof v.e !== "number" || !Number.isFinite(v.e)) return null;
  return { c: v.c, p: v.p as ProviderKey, u: v.u, r: v.r, n: v.n, e: v.e };
}

export async function readState(state: string | null, secret: string, nowSeconds: number): Promise<StateReading> {
  const invalid: StateReading = { kind: "invalid" };
  try {
    if (!state || !secret) return invalid;
    const parts = state.split(".");
    if (parts.length !== 2) return invalid;
    const [payload, signatureText] = parts;
    const signature = fromBase64Url(signatureText);
    const payloadBytes = fromBase64Url(payload);
    if (!payload || !signature || !payloadBytes) return invalid;
    if (!sameBytes(await hmac(payload, secret), signature)) return invalid;
    const claims = claimsFrom(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)));
    if (!claims) return invalid;
    return claims.e < nowSeconds ? { kind: "expired", claims } : { kind: "valid", claims };
  } catch {
    return invalid;
  }
}
