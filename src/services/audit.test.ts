// Guards the Load more cursor the audit service sends. Paging on created_at alone skips the rest of
// a burst of changes that share one timestamp, so the cursor is (created_at, id) and the order
// matches it, with the timestamp quoted so PostgREST does not read its dots and colons as syntax.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAuditEvents } from "./audit.ts";

const recorded = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]> }));
vi.mock("./supabase.ts", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "lt", "or", "order", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      recorded.calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { db: () => ({ from: () => builder }) };
});

describe("audit service cursor", () => {
  beforeEach(() => {
    recorded.calls.length = 0;
  });

  it("orders newest first, then by id", async () => {
    await listAuditEvents({ limit: 100 });
    expect(recorded.calls.filter(([m]) => m === "order")).toEqual([
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
    ]);
    expect(recorded.calls.some(([m]) => m === "or" || m === "lt")).toBe(false);
  });

  it("pages back from an event by its timestamp and id together", async () => {
    await listAuditEvents({ companyId: "co-kingdom", before: { created_at: "2026-09-02T15:00:00.123456+00:00", id: "0b6c5e1e-1f7e-4a8e-9a43-2f1d8c3b7a10" }, limit: 100 });
    const at = '"2026-09-02T15:00:00.123456+00:00"';
    expect(recorded.calls.filter(([m]) => m === "or")).toEqual([
      ["or", [`created_at.lt.${at},and(created_at.eq.${at},id.lt."0b6c5e1e-1f7e-4a8e-9a43-2f1d8c3b7a10")`]],
    ]);
    expect(recorded.calls.some(([m]) => m === "lt")).toBe(false);
    expect(recorded.calls).toContainEqual(["eq", ["company_id", "co-kingdom"]]);
  });
});
