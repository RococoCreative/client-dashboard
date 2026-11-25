// Creating an SOP is two writes, the document and its first version, and PostgREST cannot make
// them one. These pin what happens when the second one fails: the document is taken back, so
// the library never keeps a copy with no text that a retry would file a second copy beside.
// Deletes are pinned too: one that removed no row is a refusal, not a success.
// The database is a small fake that records what was asked of it; nothing reaches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  versionError: null as unknown,
  deleteError: null as unknown,
  // Whether a delete finds its row; RLS filtering it out reads as no rows and no error.
  deleteMatches: true,
}));

vi.mock("./supabase.ts", () => ({
  db: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            fake.calls.push(`insert ${table}`);
            if (table === "sop_versions" && fake.versionError) return { data: null, error: fake.versionError };
            const data =
              table === "sops"
                ? { id: "sop-1", current_version: 0, ...row }
                : { id: "version-1", version: 1, ...row };
            return { data, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (_column: string, value: string) => ({
          select: async () => {
            fake.calls.push(`delete ${table} ${value}`);
            if (fake.deleteError) return { data: null, error: fake.deleteError };
            return { data: fake.deleteMatches ? [{ id: value }] : [], error: null };
          },
        }),
      }),
    }),
  }),
}));

import { createSop, deleteSop, removeSopAttachment } from "./sops.ts";

const input = { company_id: "co-1", title: "Site cleanup", category_id: null, body: { md: "## Steps" }, change_note: null };

beforeEach(() => {
  fake.calls = [];
  fake.versionError = null;
  fake.deleteError = null;
  fake.deleteMatches = true;
});

describe("createSop", () => {
  it("files the document and its first version", async () => {
    const sop = await createSop(input);
    expect(sop.current_version).toBe(1);
    expect(fake.calls).toEqual(["insert sops", "insert sop_versions"]);
  });

  it("takes the document back when its first version does not save", async () => {
    const versionError = { message: "new row violates row-level security policy", code: "42501" };
    fake.versionError = versionError;
    await expect(createSop(input)).rejects.toBe(versionError);
    expect(fake.calls).toEqual(["insert sops", "insert sop_versions", "delete sops sop-1"]);
  });

  it("reports the version's failure even when taking the document back fails too", async () => {
    const versionError = { message: "TypeError: Failed to fetch", code: "" };
    fake.versionError = versionError;
    fake.deleteError = { message: "TypeError: Failed to fetch", code: "" };
    await expect(createSop(input)).rejects.toBe(versionError);
    expect(fake.calls).toContain("delete sops sop-1");
  });
});

describe("deleting", () => {
  it("removes a document that is there", async () => {
    await expect(deleteSop("sop-1")).resolves.toBeUndefined();
    expect(fake.calls).toEqual(["delete sops sop-1"]);
  });

  it("reports a delete that removed nothing as a refusal", async () => {
    fake.deleteMatches = false;
    await expect(deleteSop("sop-1")).rejects.toThrow(/not yours to change/);
    await expect(removeSopAttachment("attachment-1")).rejects.toThrow(/not yours to change/);
  });

  it("keeps the version's failure when taking back a document finds nothing to remove", async () => {
    const versionError = { message: "new row violates row-level security policy", code: "42501" };
    fake.versionError = versionError;
    fake.deleteMatches = false;
    await expect(createSop(input)).rejects.toBe(versionError);
  });
});
