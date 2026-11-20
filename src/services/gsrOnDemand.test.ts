// Guards the two GSR lists that feed every GSR figure: each reads every row, a page at a time, in
// a total order (newest start, then newest created, then id), so a busy company past the API's
// 1000-row page is never undercounted and no row is skipped or repeated between pages.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listGsrsForLog, listPersonGsrs } from "./gsrOnDemand.ts";

const recorded = vi.hoisted(() => ({ orders: [] as string[], ranges: [] as Array<[number, number]>, total: 0 }));
vi.mock("./supabase.ts", () => {
  const builder: Record<string, unknown> = {};
  let range: [number, number] = [0, 0];
  for (const m of ["select", "eq", "is", "or"]) builder[m] = () => builder;
  builder.order = (column: string, opts: { ascending: boolean }) => {
    recorded.orders.push(`${column} ${opts.ascending ? "asc" : "desc"}`);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    range = [from, to];
    recorded.ranges.push(range);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => {
    const [from, to] = range;
    const rows = Array.from({ length: Math.max(0, Math.min(to + 1, recorded.total) - from) }, (_, i) => ({ id: `gsr-${from + i}` }));
    return Promise.resolve(resolve({ data: rows, error: null }));
  };
  return { db: () => ({ from: () => builder }) };
});

const ORDER = ["started_on desc", "created_at desc", "id desc"];

beforeEach(() => {
  recorded.orders.length = 0;
  recorded.ranges.length = 0;
});

describe("GSR lists read every row", () => {
  it("reads the log past one page, in a total order", async () => {
    recorded.total = 1500;
    const rows = await listGsrsForLog("co-rba", { from: "2026-09-01", to: "2026-09-30" });
    expect(rows).toHaveLength(1500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1500);
    expect(recorded.ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(recorded.orders).toEqual([...ORDER, ...ORDER]);
  });

  it("reads a person's GSRs past one page, in the same order", async () => {
    recorded.total = 1000;
    expect(await listPersonGsrs("co-rba", "p-1")).toHaveLength(1000);
    expect(recorded.ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(recorded.orders.slice(0, 3)).toEqual(ORDER);
  });
});
