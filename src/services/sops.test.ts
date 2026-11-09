// Creating an SOP is two writes, the document and its first version, and PostgREST cannot make
// them one. These pin what happens when the second one fails: the document is taken back, so
// the library never keeps a copy with no text that a retry would file a second copy beside.
// The database is a small fake that records what was asked of it; nothing reaches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  versionError: null as unknown,
  deleteError: null as unknown,
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
        eq: async (_column: string, value: string) => {
          fake.calls.push(`delete ${table} ${value}`);
          return { error: fake.deleteError };
        },
      }),
    }),
  }),
}));

import { createSop } from "./sops.ts";

const input = { company_id: "co-1", title: "Site cleanup", category: "process" as const, body_md: "## Steps", change_note: null };

beforeEach(() => {
  fake.calls = [];
  fake.versionError = null;
  fake.deleteError = null;
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
