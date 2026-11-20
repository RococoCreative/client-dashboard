// The one paging loop: it asks for the rows after the last key seen until a page comes back short,
// never repeats or skips a row when rows are written or removed between requests, and throws on a
// failed page rather than handing back part of a list.
import { describe, expect, it } from "vitest";
import { readAllByKey } from "./paging.ts";

interface Row { id: string }
const key = (r: Row) => r.id;
const ids = (n: number, prefix = "b") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);

// A table served the way the API serves it: ordered by id, the rows after a key, up to a limit.
// `between` runs after each request, so a test can write or remove rows in the gap.
function table(initial: string[], { failOn, between }: { failOn?: number; between?: (rows: string[], request: number) => void } = {}) {
  const rows = [...initial];
  const asked: Array<string | null> = [];
  const readAfter = async (after: string | null, limit: number) => {
    asked.push(after);
    const request = asked.length;
    if (failOn === request) return { data: null, error: new Error("Failed to fetch") };
    const page = [...rows].sort().filter((id) => after === null || id > after).slice(0, limit).map((id) => ({ id }));
    between?.(rows, request);
    return { data: page, error: null };
  };
  return { rows, asked, readAfter };
}

describe("readAllByKey", () => {
  it("reads three pages and stops at the short last one", async () => {
    const t = table(ids(7));
    expect((await readAllByKey(t.readAfter, key, 3)).map(key)).toEqual(ids(7));
    expect(t.asked).toEqual([null, "b002", "b005"]);
  });

  it("asks once more after an exact multiple of the page size and stops on the empty page", async () => {
    const t = table(ids(6));
    expect((await readAllByKey(t.readAfter, key, 3)).map(key)).toEqual(ids(6));
    expect(t.asked).toEqual([null, "b002", "b005"]);
  });

  it("returns nothing for an empty first page", async () => {
    const t = table([]);
    expect(await readAllByKey(t.readAfter, key, 3)).toEqual([]);
    expect(t.asked).toEqual([null]);
  });

  it("throws on a failed page and returns nothing", async () => {
    const t = table(ids(7), { failOn: 2 });
    await expect(readAllByKey(t.readAfter, key, 3)).rejects.toThrow("Failed to fetch");
    expect(t.asked).toHaveLength(2);
  });

  it("neither repeats a row nor loses one when a row is written ahead of the first page between requests", async () => {
    // A row sorting before everything already read: an offset would push the third row onto the
    // second page and read it twice.
    const t = table(ids(7), { between: (rows, request) => request === 1 && rows.push("a000") });
    const read = (await readAllByKey(t.readAfter, key, 3)).map(key);
    expect(read).toEqual(ids(7));
    expect(new Set(read).size).toBe(read.length);
  });

  it("skips nothing when a row is removed between requests", async () => {
    // Removing a row already read: an offset would pull the fourth row into the first page's range
    // and never read it.
    const t = table(ids(7), { between: (rows, request) => request === 1 && rows.splice(rows.indexOf("b000"), 1) });
    expect((await readAllByKey(t.readAfter, key, 3)).map(key)).toEqual(ids(7));
  });

  it("never holds an id twice across many pages", async () => {
    const t = table(ids(250), { between: (rows, request) => rows.push(`a${String(request).padStart(3, "0")}`, `c${String(request).padStart(3, "0")}`) });
    const read = (await readAllByKey(t.readAfter, key, 100)).map(key);
    expect(new Set(read).size).toBe(read.length);
    expect(read.filter((id) => id.startsWith("b"))).toEqual(ids(250));
  });

  it("pages at the API's 1000 rows by default", async () => {
    const t = table(ids(1500).map((id) => id.replace("b", "b0")));
    expect(await readAllByKey(t.readAfter, key)).toHaveLength(1500);
    expect(t.asked).toHaveLength(2);
  });
});
