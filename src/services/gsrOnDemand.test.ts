// Guards the two GSR lists that feed every GSR figure: each reads every row, a page at a time by
// id, with the company, the no-cycle filter and (for the log) the window's filter on every request,
// and hands callers the whole list newest first. A busy company past the API's 1000-row page is
// never undercounted, and no row is read twice or missed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listGsrsForLog, listPersonGsrs } from "./gsrOnDemand.ts";

interface Request {
  filters: string[];
  after: string | null;
  orders: string[];
  limit: number | null;
}

const served = vi.hoisted(() => ({ requests: [] as Request[], rows: [] as Array<{ id: string; started_on: string; created_at: string }> }));
vi.mock("./supabase.ts", () => {
  const start = () => {
    const req: Request = { filters: [], after: null, orders: [], limit: null };
    served.requests.push(req);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: string) => (req.filters.push(`eq ${column} ${value}`), builder);
    builder.is = (column: string, value: null) => (req.filters.push(`is ${column} ${value}`), builder);
    builder.or = (filter: string) => (req.filters.push(`or ${filter}`), builder);
    builder.gt = (_column: string, value: string) => ((req.after = value), builder);
    builder.order = (column: string, opts: { ascending: boolean }) => (req.orders.push(`${column} ${opts.ascending ? "asc" : "desc"}`), builder);
    builder.limit = (count: number) => ((req.limit = count), builder);
    builder.then = (resolve: (v: unknown) => unknown) => {
      const page = [...served.rows]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((r) => req.after === null || r.id > req.after)
        .slice(0, req.limit ?? Infinity);
      return Promise.resolve(resolve({ data: page, error: null }));
    };
    return builder;
  };
  return { db: () => ({ from: () => ({ select: () => start() }) }) };
});

// n GSRs whose ids do not follow their dates, so newest first is the service's own sort.
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = String((i * 7) % 28 + 1).padStart(2, "0");
    return { id: `gsr-${String((i * 7919) % n).padStart(5, "0")}`, started_on: `2026-09-${day}`, created_at: `2026-09-${day}T${String(i % 24).padStart(2, "0")}:00:00.000Z` };
  });
}

function newestFirst(list: Array<{ id: string; started_on: string; created_at: string }>): boolean {
  return list.every((r, i) => i === 0 || list[i - 1].started_on > r.started_on || (list[i - 1].started_on === r.started_on && (list[i - 1].created_at > r.created_at || (list[i - 1].created_at === r.created_at && list[i - 1].id > r.id))));
}

beforeEach(() => {
  served.requests.length = 0;
});

describe("GSR lists read every row", () => {
  it("reads the log past one page by id, with every filter on every request, newest first", async () => {
    served.rows = rows(1500);
    const read = await listGsrsForLog("co-rba", { from: "2026-09-01", to: "2026-09-30" });
    expect(read).toHaveLength(1500);
    expect(new Set(read.map((r) => r.id)).size).toBe(1500);
    expect(newestFirst(read)).toBe(true);
    expect(served.requests).toHaveLength(2);
    const filters = ["eq company_id co-rba", "is cycle_id null", "or and(done_on.gte.2026-09-01,done_on.lte.2026-09-30),status.neq.complete"];
    for (const req of served.requests) {
      expect(req.filters).toEqual(filters);
      expect(req.orders).toEqual(["id asc"]);
      expect(req.limit).toBe(1000);
    }
    expect(served.requests.map((r) => r.after)).toEqual([null, [...served.rows].map((r) => r.id).sort()[999]]);
  });

  it("reads a person's GSRs past one page by id, newest first", async () => {
    served.rows = rows(1000);
    const read = await listPersonGsrs("co-rba", "p-1");
    expect(read).toHaveLength(1000);
    expect(newestFirst(read)).toBe(true);
    expect(served.requests).toHaveLength(2);
    for (const req of served.requests) expect(req.filters).toEqual(["eq company_id co-rba", "eq employee_id p-1", "is cycle_id null"]);
  });
});
