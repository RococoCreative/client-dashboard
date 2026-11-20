// The one paging loop: it keeps asking until a page comes back short, asks for each page by its
// first and last index, and throws on a failed page rather than handing back part of a list.
import { describe, expect, it } from "vitest";
import { readAllPages } from "./paging.ts";

// A list of n rows served a page at a time, recording each request.
function served(n: number, failOn?: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const asked: Array<[number, number]> = [];
  const readPage = async (from: number, to: number) => {
    asked.push([from, to]);
    if (failOn !== undefined && from === failOn) return { data: null, error: new Error("Failed to fetch") };
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, asked, readPage };
}

describe("readAllPages", () => {
  it("reads three pages and stops at the short last one", async () => {
    const list = served(7);
    expect(await readAllPages(list.readPage, 3)).toEqual(list.rows);
    expect(list.asked).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it("asks once more after an exact multiple of the page size and stops on the empty page", async () => {
    const list = served(6);
    expect(await readAllPages(list.readPage, 3)).toEqual(list.rows);
    expect(list.asked).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it("returns nothing for an empty first page", async () => {
    const list = served(0);
    expect(await readAllPages(list.readPage, 3)).toEqual([]);
    expect(list.asked).toEqual([[0, 2]]);
  });

  it("throws on a failed page and returns nothing", async () => {
    const list = served(7, 3);
    await expect(readAllPages(list.readPage, 3)).rejects.toThrow("Failed to fetch");
    expect(list.asked).toEqual([[0, 2], [3, 5]]);
  });

  it("pages at the API's 1000 rows by default", async () => {
    const list = served(1500);
    expect(await readAllPages(list.readPage)).toHaveLength(1500);
    expect(list.asked).toEqual([[0, 999], [1000, 1999]]);
  });
});
