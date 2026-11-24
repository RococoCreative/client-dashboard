// Proves that only a sync's own fixed lines reach the screen: a SyncError's text passes, and any
// other error (a database's, a runtime's, a provider's) reads as the fallback line the caller names.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SHEET_NOT_READ, SyncError, syncMessage } from "../../../supabase/functions/_shared/sync/errors.ts";

describe("syncMessage", () => {
  it("passes a sync's own fixed line", () => {
    expect(syncMessage(new SyncError("That spreadsheet was not found. Check the link."), "Fallback.")).toBe("That spreadsheet was not found. Check the link.");
  });

  it("reads any other error as the fallback, never its text", () => {
    const raw = [
      new Error('duplicate key value violates unique constraint "sync_runs_pkey"'),
      new SyntaxError("Unexpected token < in JSON at position 0"),
      new TypeError("fetch failed: https://sheets.googleapis.com/v4/spreadsheets/sample-id"),
      new SyncError(""),
      "a bare string",
      null,
      undefined,
      { message: "an object that only looks like an error" },
    ];
    for (const err of raw) expect(syncMessage(err, SHEET_NOT_READ)).toBe(SHEET_NOT_READ);
  });

  it("names itself, so a log line can say what kind of error it was", () => {
    expect(new SyncError("x").name).toBe("SyncError");
    expect(new SyncError("x")).toBeInstanceOf(Error);
  });
});
