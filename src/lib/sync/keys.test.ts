// Proves record keys: the key fields' values in record-key order, null when one is blank, and the
// row number when the source names no key.
import { describe, expect, it } from "vitest";
import { buildRecordKey } from "../../../supabase/functions/_shared/sync/keys.ts";

describe("buildRecordKey", () => {
  it("joins the key fields in record-key order", () => {
    expect(buildRecordKey({ job: "101" }, ["job"], 2)).toBe('["101"]');
    expect(buildRecordKey({ job: "101", phase: 2 }, ["job", "phase"], 2)).toBe('["101",2]');
    expect(buildRecordKey({ job: "101", phase: 2 }, ["phase", "job"], 2)).toBe('[2,"101"]');
  });

  it("is null when a key field is blank", () => {
    expect(buildRecordKey({ job: null }, ["job"], 2)).toBeNull();
    expect(buildRecordKey({ job: "" }, ["job"], 2)).toBeNull();
  });

  it("uses the row number when there is no record key", () => {
    expect(buildRecordKey({}, [], 7)).toBe("row:7");
  });
});
