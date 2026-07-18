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

/**
 * `paginateAll` specialized to Supabase/PostgREST's `{ data, error }` response
 * shape: throws on a page error, treats a null payload as an empty page. Any
 * select whose table can exceed PostgREST's row cap (1000 by default) must go
 * through this (or `paginateAll` directly) with a STABLE, UNIQUE `.order()` —
 * otherwise `.range()` pages can skip or duplicate rows. See DECISIONS #18–#21.
 */
export async function paginateSelect<T>(
  pageSize: number,
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  return paginateAll(pageSize, async (from, to) => {
    const res = await buildPage(from, to);
    if (res.error) throw new Error(res.error.message);
    return res.data ?? [];
  });
}
