// Reading every row of a list the API hands out a page at a time. PostgREST returns at most 1000
// rows a request unless told otherwise, and a list cut off there reads as complete with no sign it
// is not: a busy company's GSRs would undercount. One loop, so every service that must see every
// row pages the same way: ask for a page by its first and last index, keep going until a page
// comes back short. A failed page throws and nothing is returned. The caller's order must be
// total (end on a unique column such as id), or a row can be skipped or repeated between pages.
export const API_PAGE = 1000;

export async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = API_PAGE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
