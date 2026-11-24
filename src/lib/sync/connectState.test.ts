// Pins the signed connect state the connections function hands a provider and reads back at the
// callback: a state it signed reads back whole, an old one reads as expired with its return
// address, and anything altered, unsigned, malformed or of the wrong shape reads as invalid
// without ever throwing.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toBase64Url } from "../../../supabase/functions/_shared/bytes.ts";
import { readState, signState, type StateClaims } from "../../../supabase/functions/_shared/connectState.ts";

const secret = "sample-state-secret";
const now = 1_790_000_000;
const claims: StateClaims = { c: "co1", p: "quickbooks", u: "pr1", r: "https://app.example/settings/connections/co1", n: "n1", e: now + 600 };

// Signs any payload text the way the function does, so a test can sign what signState never would.
async function signRaw(payloadText: string, key = secret): Promise<string> {
  const encoder = new TextEncoder();
  const payload = toBase64Url(encoder.encode(payloadText));
  const hmacKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

describe("connect state", () => {
  it("reads back a state it signed", async () => {
    const state = await signState(claims, secret);
    expect(await readState(state, secret, now)).toEqual({ kind: "valid", claims });
  });

  it("keeps today's wire format, so a state issued before a deploy still reads", async () => {
    const state = await signRaw(JSON.stringify(claims));
    expect(await signState(claims, secret)).toBe(state);
    expect(await readState(state, secret, now)).toEqual({ kind: "valid", claims });
  });

  it("reads a signed state past its expiry as expired, with its return address", async () => {
    const state = await signState({ ...claims, e: now - 1 }, secret);
    const reading = await readState(state, secret, now);
    expect(reading.kind).toBe("expired");
    expect(reading.kind === "expired" && reading.claims.r).toBe(claims.r);
  });

  it('reads a changed payload, a changed signature, another secret, an empty secret, null, "", "no-dot", "%%%.%%%" and a signed non-JSON payload as invalid, without throwing', async () => {
    const state = await signState(claims, secret);
    const [payload, signature] = state.split(".");
    const otherPayload = (await signState({ ...claims, c: "co2" }, secret)).split(".")[0];
    const flipped = signature[0] === "A" ? "B" : "A";
    const cases: Array<[string | null, string]> = [
      [`${otherPayload}.${signature}`, secret],
      [`${payload}.${flipped}${signature.slice(1)}`, secret],
      [state, "another-secret"],
      [state, ""],
      [null, secret],
      ["", secret],
      ["no-dot", secret],
      ["%%%.%%%", secret],
      [`${state}.extra`, secret],
      [await signRaw("not json"), secret],
      [await signRaw("null"), secret],
    ];
    for (const [value, key] of cases) {
      await expect(readState(value, key, now)).resolves.toEqual({ kind: "invalid" });
    }
  });

  it("reads signed claims of the wrong shape as invalid", async () => {
    const withoutU: Partial<StateClaims> = { ...claims };
    delete withoutU.u;
    const shapes = [{ ...claims, p: "xero" }, { ...claims, e: String(claims.e) }, withoutU];
    for (const shape of shapes) {
      const state = await signState(shape as unknown as StateClaims, secret);
      expect(await readState(state, secret, now)).toEqual({ kind: "invalid" });
    }
  });

  it("checks the signature before the expiry", async () => {
    const state = await signState({ ...claims, e: now - 1 }, "another-secret");
    expect(await readState(state, secret, now)).toEqual({ kind: "invalid" });
  });

  it("signState refuses an empty secret", async () => {
    await expect(signState(claims, "")).rejects.toThrow();
  });
});
