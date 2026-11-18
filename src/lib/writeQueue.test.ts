// The per-row write queue: writes for one key run in order and build on each other, a failure
// leaves the next write to start from the row as shown, and a settled queue lets go of its key.
import { describe, expect, it } from "vitest";
import { enqueueWrite } from "./writeQueue.ts";

describe("enqueueWrite", () => {
  it("hands each write the row the one before it returned", async () => {
    const chains = new Map<string, Promise<number | undefined>>();
    const seen: Array<number | undefined> = [];
    const first = enqueueWrite(chains, "a", async (latest) => {
      seen.push(latest);
      return 1;
    });
    const second = enqueueWrite(chains, "a", async (latest) => {
      seen.push(latest);
      return (latest ?? 0) + 1;
    });
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(seen).toEqual([undefined, 1]);
  });

  it("starts after a failure from nothing, so the caller falls back to the row as shown", async () => {
    const chains = new Map<string, Promise<number | undefined>>();
    const failed = enqueueWrite(chains, "a", async () => {
      throw new Error("refused");
    });
    const next = enqueueWrite(chains, "a", async (latest) => latest ?? 42);
    await expect(failed).rejects.toThrow("refused");
    expect(await next).toBe(42);
  });

  it("drops the key once the last write in line settles, and keeps it while one is waiting", async () => {
    const chains = new Map<string, Promise<number | undefined>>();
    const first = enqueueWrite(chains, "a", async () => 1);
    const second = enqueueWrite(chains, "a", async () => 2);
    await first;
    await Promise.resolve();
    expect(chains.has("a")).toBe(true);
    await second;
    // The cleanup runs a tick after the write settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(chains.has("a")).toBe(false);
    // A later write starts fresh rather than from the 2 written above.
    expect(await enqueueWrite(chains, "a", async (latest) => latest ?? 0)).toBe(0);
  });
});
