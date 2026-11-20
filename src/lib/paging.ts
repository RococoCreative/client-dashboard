// Reading every row of a list the API hands out a page at a time. PostgREST returns at most 1000
// rows a request unless told otherwise, and a list cut off there reads as complete with no sign it
// is not: a busy company's GSRs would undercount. One loop, so every service that must see every
// row pages the same way.
//
// It pages by key, not by offset. An offset counts rows from the top, so a row written or removed
// between two requests shifts every row after it: one is read twice, or one is never read. Each
// request here asks for the rows after the last key seen, ordered by that key ascending, so with a
// key that never changes (a row's id) no row can be repeated or skipped whatever is written in
// between. The caller orders the finished list however its callers expect.
//
// The loop stops on a short page. That assumes the API returns at least a full page of API_PAGE
// rows when that many are there (PostgREST's default maximum is 1000); a smaller server cap would
// end the list early, so lower API_PAGE with it rather than stopping only on an empty page. A
// failed page throws and nothing is returned.
export const API_PAGE = 1000;

export async function readAllByKey<T, K>(
  readAfter: (after: K | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  keyOf: (row: T) => K,
  pageSize = API_PAGE,
): Promise<T[]> {
  const rows: T[] = [];
  let after: K | null = null;
  for (;;) {
    const { data, error } = await readAfter(after, pageSize);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    after = keyOf(page[page.length - 1]);
  }
}
