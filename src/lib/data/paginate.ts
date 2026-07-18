/**
 * Fetches all rows from a paged source, following PostgREST's convention of
 * returning a full page (`pageSize` rows) whenever more rows remain and a
 * short page only on the final one. Stops as soon as a page comes back
 * shorter than `pageSize`; when the total is an exact multiple of `pageSize`
 * this costs one extra request that returns an empty page, since there is no
 * way to know that in advance. `fetchPage(from, to)` receives an inclusive
 * `[from, to]` range, matching Supabase's `.range(from, to)`.
 */
export async function paginateAll<T>(
  pageSize: number,
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
