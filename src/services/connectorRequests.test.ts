// Pins the tool request service against a small fake database: asking is an insert that ignores a
// duplicate and then reads the stored row, so two admins asking at once, or a double click, both
// resolve with the one row; withdrawing a request that is already gone is not an error; and a
// database error is passed through. Nothing reaches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  answers: {} as Record<string, Answer[]>,
}));

vi.mock("./supabase.ts", () => {
  function builder(table: string) {
    let op = "select";
    const parts: string[] = [];
    const answer = (): Answer => {
      const key = `${table} ${op}`;
      fake.calls.push(parts.length ? `${key} ${parts.join(" ")}` : key);
      return fake.answers[key]?.shift() ?? { data: [], error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      upsert: (row: Record<string, unknown>, options: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = "upsert";
        parts.push(`${JSON.stringify(row)} on=${options.onConflict} ignore=${String(options.ignoreDuplicates)}`);
        return chain;
      },
      delete: () => ((op = "delete"), chain),
      eq: (column: string, value: unknown) => (parts.push(`${column}=${String(value)}`), chain),
      order: (column: string) => (parts.push(`order=${column}`), chain),
      maybeSingle: async () => answer(),
      then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
    };
    return chain;
  }
  return { db: () => ({ from: builder }) };
});

import {
  listAllConnectorRequests,
  listConnectorRequests,
  requestConnector,
  withdrawConnectorRequest,
} from "./connectorRequests.ts";

const ROW = { id: "req-1", company_id: "co-1", connector_key: "jobtread", requested_by: "p-1", requested_at: "2026-09-15T12:00:00.000Z" };

function answer(key: string, ...answers: Answer[]) {
  fake.answers[key] = [...(fake.answers[key] ?? []), ...answers];
}

beforeEach(() => {
  fake.calls = [];
  fake.answers = {};
});

describe("listing requests", () => {
  it("reads one company's requests by its id", async () => {
    answer("connector_requests select", { data: [ROW], error: null });
    await expect(listConnectorRequests("co-1")).resolves.toEqual([ROW]);
    expect(fake.calls).toEqual(["connector_requests select company_id=co-1 order=requested_at"]);
  });

  it("reads every company's requests for Rococo", async () => {
    answer("connector_requests select", { data: [ROW], error: null });
    await expect(listAllConnectorRequests()).resolves.toEqual([ROW]);
    expect(fake.calls).toEqual(["connector_requests select order=requested_at"]);
  });

  it("throws a database error", async () => {
    answer("connector_requests select", { data: null, error: { message: "boom" } });
    await expect(listConnectorRequests("co-1")).rejects.toEqual({ message: "boom" });
  });
});

describe("asking for a tool", () => {
  it("inserts ignoring a duplicate, then returns the stored row", async () => {
    answer("connector_requests select", { data: ROW, error: null });
    await expect(requestConnector("co-1", "jobtread")).resolves.toEqual(ROW);
    expect(fake.calls).toEqual([
      'connector_requests upsert {"company_id":"co-1","connector_key":"jobtread"} on=company_id,connector_key ignore=true',
      "connector_requests select company_id=co-1 connector_key=jobtread",
    ]);
  });

  it("resolves with the row someone else already made", async () => {
    const theirs = { ...ROW, requested_by: "p-2" };
    answer("connector_requests select", { data: theirs, error: null });
    await expect(requestConnector("co-1", "jobtread")).resolves.toEqual(theirs);
  });

  it("throws when no row comes back", async () => {
    answer("connector_requests select", { data: null, error: null });
    await expect(requestConnector("co-1", "jobtread")).rejects.toThrow(/not yours to change/);
  });

  it("throws the insert's error without reading", async () => {
    answer("connector_requests upsert", { data: null, error: { message: "new row violates row-level security policy" } });
    await expect(requestConnector("co-1", "jobtread")).rejects.toEqual({ message: "new row violates row-level security policy" });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("withdrawing a request", () => {
  it("deletes by company and tool", async () => {
    await expect(withdrawConnectorRequest("co-1", "jobtread")).resolves.toBeUndefined();
    expect(fake.calls).toEqual(["connector_requests delete company_id=co-1 connector_key=jobtread"]);
  });

  it("throws a database error", async () => {
    answer("connector_requests delete", { data: null, error: { message: "boom" } });
    await expect(withdrawConnectorRequest("co-1", "jobtread")).rejects.toEqual({ message: "boom" });
  });
});
