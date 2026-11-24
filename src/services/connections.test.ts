// Pins how the connections service reads the connect flow's answers from the Edge Function: the
// pending confirm answer (one of three shapes, or a plain line when it is anything else), which
// provider a finish connected, and whether a discard or disconnect was let go at the provider (a
// missing answer reads as not). The function itself is faked; nothing reaches the network.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./invoke.ts", () => ({ invokeFunction: vi.fn() }));
vi.mock("./supabase.ts", () => ({ db: () => ({}), isSupabaseConfigured: true }));

import { invokeFunction } from "./invoke.ts";
import { disconnectConnection, discardConnection, finishConnection, readPendingConnection } from "./connections.ts";

const ID = "5f0c7a52-0000-4000-8000-000000000001";
const NO_ANSWER = "The connection service did not answer. Try again in a moment.";

afterEach(() => vi.clearAllMocks());

describe("readPendingConnection", () => {
  it("asks /pending with the id and returns a ready answer", async () => {
    const ready = { status: "ready", provider: "quickbooks", account_name: "Sample Books LLC", company_name: "Sample Co" };
    vi.mocked(invokeFunction).mockResolvedValue(ready);
    expect(await readPendingConnection(ID)).toEqual(ready);
    expect(invokeFunction).toHaveBeenCalledWith("connections/pending", { pending_id: ID });
  });

  it("returns the someone-else and gone answers as they are", async () => {
    vi.mocked(invokeFunction).mockResolvedValue({ status: "someone_else" });
    expect(await readPendingConnection(ID)).toEqual({ status: "someone_else" });
    vi.mocked(invokeFunction).mockResolvedValue({ status: "gone" });
    expect(await readPendingConnection(ID)).toEqual({ status: "gone" });
  });

  it("throws the no-answer line for anything it cannot read", async () => {
    for (const answer of [null, {}, { status: "ready", provider: "dropbox", account_name: null, company_name: "Sample Co" }, "ok"]) {
      vi.mocked(invokeFunction).mockResolvedValue(answer);
      await expect(readPendingConnection(ID)).rejects.toThrow(NO_ANSWER);
    }
  });
});

describe("finishConnection", () => {
  it("asks /finish with the id and returns the provider it connected", async () => {
    vi.mocked(invokeFunction).mockResolvedValue({ ok: true, provider: "gohighlevel" });
    expect(await finishConnection(ID)).toBe("gohighlevel");
    expect(invokeFunction).toHaveBeenCalledWith("connections/finish", { pending_id: ID });
  });

  it("throws the no-answer line when the answer names no known provider", async () => {
    vi.mocked(invokeFunction).mockResolvedValue({ ok: true });
    await expect(finishConnection(ID)).rejects.toThrow(NO_ANSWER);
  });
});

describe("discardConnection and disconnectConnection", () => {
  it("say whether the provider let go, and read a missing answer as not", async () => {
    vi.mocked(invokeFunction).mockResolvedValue({ ok: true, revoked: true });
    expect(await discardConnection(ID)).toEqual({ revoked: true });
    expect(invokeFunction).toHaveBeenLastCalledWith("connections/discard", { pending_id: ID });
    vi.mocked(invokeFunction).mockResolvedValue({ ok: true });
    expect(await discardConnection(ID)).toEqual({ revoked: false });

    vi.mocked(invokeFunction).mockResolvedValue({ ok: true, revoked: true });
    expect(await disconnectConnection("c1", "quickbooks")).toEqual({ revoked: true });
    expect(invokeFunction).toHaveBeenLastCalledWith("connections/disconnect", { company_id: "c1", provider: "quickbooks" });
    vi.mocked(invokeFunction).mockResolvedValue(null);
    expect(await disconnectConnection("c1", "quickbooks")).toEqual({ revoked: false });
  });
});
