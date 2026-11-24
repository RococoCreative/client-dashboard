// Pins the connect flow's rules outside the function: the error keys and the only lines the app
// shows for them, who may finish a pending connection, the reader of the pending
// answer, and where the callback sends the browser when a sign-in does not finish.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StateClaims, StateReading } from "../../../supabase/functions/_shared/connectState.ts";
import {
  CONNECT_ERROR_TEXT,
  PENDING_GONE,
  PENDING_SOMEONE_ELSE,
  PENDING_TTL_SECONDS,
  allowedReturn,
  blankToNull,
  connectErrorText,
  failureLocation,
  fallbackReturn,
  isPendingId,
  localhostReturnAllowed,
  parsePendingAnswer,
  pendingExpiry,
  pendingVerdict,
  recheckReturn,
  shouldRevokePending,
  withQuery,
  type ConnectErrorKey,
} from "../../../supabase/functions/_shared/connectFlow.ts";

const now = 1_790_000_000;
const claims: StateClaims = { c: "co1", p: "quickbooks", u: "pr1", r: "https://app.example/settings/connections/co1", n: "n1", e: now + 600 };

describe("connectErrorText", () => {
  it("maps every key to its line", () => {
    expect(CONNECT_ERROR_TEXT).toEqual({
      cancelled: "The sign-in was cancelled or refused. Nothing changed.",
      expired: "This sign-in link was already used or has expired. Start the connection again.",
      not_set_up: "This tool is not set up yet. Ask Rococo Creative to finish the setup.",
      refused: "The tool refused the sign-in. Try again from Settings.",
      one_location: "Choose one sub-account when installing; an agency-wide install is not supported.",
      no_account: "The tool did not say which account was connected. Try again from Settings.",
      failed: "The connection could not be finished. Try again from Settings.",
      invalid: "The connection did not finish. Start again from Settings.",
    });
    for (const key of Object.keys(CONNECT_ERROR_TEXT) as ConnectErrorKey[]) {
      expect(connectErrorText(key)).toBe(CONNECT_ERROR_TEXT[key]);
    }
  });

  it("is null for null and the invalid line for anything it does not know", () => {
    expect(connectErrorText(null)).toBeNull();
    expect(connectErrorText("The sign-in was cancelled or refused. Nothing changed.")).toBe(CONNECT_ERROR_TEXT.invalid);
    expect(connectErrorText("unknown")).toBe(CONNECT_ERROR_TEXT.invalid);
    expect(connectErrorText("toString")).toBe(CONNECT_ERROR_TEXT.invalid);
  });

  it("has no em dash in any line", () => {
    const lines = [...Object.values(CONNECT_ERROR_TEXT), PENDING_GONE, PENDING_SOMEONE_ELSE];
    for (const line of lines) expect(line).not.toContain("\u2014");
  });
});

describe("pending connections", () => {
  const at = new Date(now * 1000);
  const later = new Date((now + PENDING_TTL_SECONDS) * 1000).toISOString();

  it("lasts ten minutes", () => {
    expect(PENDING_TTL_SECONDS).toBe(600);
  });

  it("reads the forwarded-link and expired lines verbatim", () => {
    expect(PENDING_SOMEONE_ELSE).toBe("This connection was started by someone else, so it can't be finished here. Ask them to finish it, or start again.");
    expect(PENDING_GONE).toBe("This connection request has expired. Start the connection again.");
  });

  it("pendingVerdict: gone when missing or expired, someone_else for another caller, ready for the starter", () => {
    expect(pendingVerdict(null, "pr1", at)).toBe("gone");
    expect(pendingVerdict({ started_by: "pr1", expires_at: new Date((now - 1) * 1000).toISOString() }, "pr1", at)).toBe("gone");
    expect(pendingVerdict({ started_by: "pr1", expires_at: later }, "pr2", at)).toBe("someone_else");
    expect(pendingVerdict({ started_by: "pr1", expires_at: later }, "pr1", at)).toBe("ready");
    expect(pendingVerdict({ started_by: "pr1", expires_at: new Date((now - 1) * 1000).toISOString() }, "pr2", at)).toBe("gone");
    expect(pendingVerdict({ started_by: "pr1", expires_at: "not a date" }, "pr1", at)).toBe("gone");
  });

  it("parsePendingAnswer accepts the three shapes", () => {
    expect(parsePendingAnswer({ status: "ready", provider: "quickbooks", account_name: "Sample Books", company_name: "Sample Co" })).toEqual({
      status: "ready",
      provider: "quickbooks",
      account_name: "Sample Books",
      company_name: "Sample Co",
    });
    expect(parsePendingAnswer({ status: "ready", provider: "gohighlevel", account_name: null, company_name: "Sample Co" })).toEqual({
      status: "ready",
      provider: "gohighlevel",
      account_name: null,
      company_name: "Sample Co",
    });
    expect(parsePendingAnswer({ status: "someone_else" })).toEqual({ status: "someone_else" });
    expect(parsePendingAnswer({ status: "gone" })).toEqual({ status: "gone" });
  });

  it("parsePendingAnswer is null for anything else", () => {
    const ready = { status: "ready", provider: "quickbooks", account_name: "Sample Books", company_name: "Sample Co" };
    expect(parsePendingAnswer({ ...ready, provider: "xero" })).toBeNull();
    expect(parsePendingAnswer({ ...ready, company_name: 7 })).toBeNull();
    expect(parsePendingAnswer({ ...ready, account_name: 7 })).toBeNull();
    expect(parsePendingAnswer({ status: "other" })).toBeNull();
    expect(parsePendingAnswer(null)).toBeNull();
    expect(parsePendingAnswer("ready")).toBeNull();
  });

  it("pendingExpiry is ten minutes after now, as the timestamp the table stores", () => {
    expect(pendingExpiry(at)).toBe(later);
  });

  it("blankToNull keeps text and turns a missing or blank value into null", () => {
    expect(blankToNull("realm-1")).toBe("realm-1");
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
  });

  it("isPendingId accepts a uuid and nothing else", () => {
    const id = crypto.randomUUID();
    expect(isPendingId(id)).toBe(true);
    expect(isPendingId(id.toUpperCase())).toBe(true);
    expect(isPendingId("abc")).toBe(false);
    expect(isPendingId("")).toBe(false);
    expect(isPendingId(42)).toBe(false);
    expect(isPendingId(`${id} `)).toBe(false);
  });
});

describe("where the callback sends the browser", () => {
  it("withQuery adds form-encoded params", () => {
    expect(withQuery("https://a.example/x", { pending: "p 1" })).toBe("https://a.example/x?pending=p+1");
  });

  it("fallbackReturn uses APP_URL's origin, else the first APP_ORIGINS entry, else null", () => {
    expect(fallbackReturn("https://hub.example/anything", [])).toBe("https://hub.example/settings/connections");
    expect(fallbackReturn(undefined, ["https://b.example"])).toBe("https://b.example/settings/connections");
    expect(fallbackReturn("not a url", [])).toBeNull();
    expect(fallbackReturn(undefined, [])).toBeNull();
  });

  it("failureLocation returns to the state's address when the state verified, else to the fallback", () => {
    const valid: StateReading = { kind: "valid", claims };
    const expired: StateReading = { kind: "expired", claims };
    const invalid: StateReading = { kind: "invalid" };
    const fallback = "https://hub.example/settings/connections";
    expect(failureLocation(valid, fallback, "refused")).toBe(`${claims.r}?connect_error=refused`);
    expect(failureLocation(expired, fallback, "refused")).toBe(`${claims.r}?connect_error=expired`);
    expect(failureLocation(invalid, fallback, "refused")).toBe(`${fallback}?connect_error=invalid`);
    expect(failureLocation(invalid, null, "refused")).toBeNull();
  });
});

describe("return addresses", () => {
  const origins = ["https://app.example"];
  const fallback = "https://hub.example/settings/connections";

  it("allowedReturn admits the app's own origins, as origin and path only", () => {
    expect(allowedReturn("https://app.example/settings/connections/co1?x=1#y", origins, false)).toBe("https://app.example/settings/connections/co1");
  });

  it("allowedReturn admits localhost only when localhost returns are switched on", () => {
    expect(allowedReturn("http://localhost:5173/settings/connections", origins, true)).toBe("http://localhost:5173/settings/connections");
    expect(allowedReturn("http://127.0.0.1:5173/x", origins, true)).toBe("http://127.0.0.1:5173/x");
    expect(allowedReturn("http://localhost:5173/settings/connections", origins, false)).toBeNull();
    expect(allowedReturn("http://127.0.0.1:5173/x", origins, false)).toBeNull();
    expect(allowedReturn("http://localhost:5173/settings/connections", origins)).toBeNull();
  });

  it("localhostReturnAllowed is on only when ALLOW_LOCALHOST_RETURN is exactly true", () => {
    const reader = (value: string | undefined) => (name: string) => (name === "ALLOW_LOCALHOST_RETURN" ? value : undefined);
    expect(localhostReturnAllowed(reader("true"))).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "True", " true", "true ", "1", "yes"]) {
      expect(localhostReturnAllowed(reader(value)), String(value)).toBe(false);
    }
  });

  it("allowedReturn refuses another origin, a non-web scheme, a non-URL and a non-string", () => {
    expect(allowedReturn("https://evil.example/settings", origins)).toBeNull();
    expect(allowedReturn("https://app.example.evil.example/x", origins)).toBeNull();
    expect(allowedReturn("javascript:alert(1)", origins)).toBeNull();
    expect(allowedReturn("ftp://localhost/x", origins, true)).toBeNull();
    expect(allowedReturn("not a url", origins)).toBeNull();
    expect(allowedReturn(7, origins)).toBeNull();
    expect(allowedReturn(undefined, origins)).toBeNull();
  });

  it("recheckReturn keeps a state whose address the app still owns", () => {
    expect(recheckReturn({ kind: "valid", claims }, origins, fallback)).toEqual({ kind: "valid", claims });
    expect(recheckReturn({ kind: "expired", claims }, origins, fallback)).toEqual({ kind: "expired", claims });
    expect(recheckReturn({ kind: "invalid" }, origins, fallback)).toEqual({ kind: "invalid" });
  });

  it("recheckReturn sends a state whose origin has left APP_ORIGINS to the fallback, or reads it as invalid without one", () => {
    expect(recheckReturn({ kind: "valid", claims }, [], fallback)).toEqual({ kind: "valid", claims: { ...claims, r: fallback } });
    expect(recheckReturn({ kind: "expired", claims }, ["https://other.example"], fallback)).toEqual({ kind: "expired", claims: { ...claims, r: fallback } });
    expect(recheckReturn({ kind: "valid", claims }, [], null)).toEqual({ kind: "invalid" });
    expect(failureLocation(recheckReturn({ kind: "valid", claims }, [], null), null, "refused")).toBeNull();
  });

  it("recheckReturn keeps a localhost address only while localhost returns are switched on", () => {
    const local = { ...claims, r: "http://localhost:5173/settings/connections/co1" };
    expect(recheckReturn({ kind: "valid", claims: local }, origins, fallback, true)).toEqual({ kind: "valid", claims: local });
    expect(recheckReturn({ kind: "valid", claims: local }, origins, fallback, false)).toEqual({ kind: "valid", claims: { ...local, r: fallback } });
    expect(recheckReturn({ kind: "valid", claims: local }, origins, fallback)).toEqual({ kind: "valid", claims: { ...local, r: fallback } });
  });
});

describe("handing back a pending grant", () => {
  it("revokes when the pending account is known and no live connection uses it", () => {
    expect(shouldRevokePending("acct-1", [])).toBe(true);
    expect(shouldRevokePending("acct-1", ["acct-2", "acct-3"])).toBe(true);
  });

  it("keeps the grant when a live connection, in any company, holds the same account", () => {
    expect(shouldRevokePending("acct-1", ["acct-1"])).toBe(false);
    expect(shouldRevokePending("acct-1", ["acct-2", "acct-1"])).toBe(false);
  });

  it("keeps the grant when the pending account is unknown", () => {
    expect(shouldRevokePending(null, [])).toBe(false);
    expect(shouldRevokePending(null, ["acct-1"])).toBe(false);
    expect(shouldRevokePending("", [])).toBe(false);
    expect(shouldRevokePending("   ", ["acct-2"])).toBe(false);
  });

  it("keeps the grant when any live connection's account is unknown, since it could be the same one", () => {
    expect(shouldRevokePending("acct-1", [null])).toBe(false);
    expect(shouldRevokePending("acct-1", ["acct-2", null])).toBe(false);
    expect(shouldRevokePending("acct-1", ["  "])).toBe(false);
  });
});
