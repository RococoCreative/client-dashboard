// Pins the connect flow's rules outside the function: the error keys and the only lines the app
// shows for them, who may finish a pending connection, the confirm copy, the reader of the pending
// answer, and where the callback sends the browser when a sign-in does not finish.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StateClaims, StateReading } from "../../../supabase/functions/_shared/connectState.ts";
import {
  CONNECT_ERROR_TEXT,
  PENDING_GONE,
  PENDING_SOMEONE_ELSE,
  PENDING_TTL_SECONDS,
  confirmText,
  connectErrorText,
  failureLocation,
  fallbackReturn,
  isPendingId,
  parsePendingAnswer,
  pendingVerdict,
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
    const lines = [...Object.values(CONNECT_ERROR_TEXT), PENDING_GONE, PENDING_SOMEONE_ELSE, confirmText("QuickBooks", "Sample Books", "Sample Co"), confirmText("QuickBooks", null, "Sample Co")];
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

  it("confirmText names the account when the tool gave one, and warns when it did not", () => {
    expect(confirmText("QuickBooks", "Sample Books", "Sample Co")).toBe("Connect QuickBooks account Sample Books to Sample Co?");
    expect(confirmText("QuickBooks", null, "Sample Co")).toBe(
      "Connect QuickBooks to Sample Co? QuickBooks did not give this account's name. Only continue if you just approved access in QuickBooks.",
    );
    expect(confirmText("QuickBooks", "  ", "Sample Co")).toBe(confirmText("QuickBooks", null, "Sample Co"));
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
