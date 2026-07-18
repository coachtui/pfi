import { describe, expect, it, vi } from "vitest";
import { paginateAll, paginateSelect } from "./paginate";

function pagedFetcher<T>(all: T[]) {
  return vi.fn(async (from: number, to: number) => all.slice(from, to + 1));
}

describe("paginateAll", () => {
  it("returns everything when the source fits in one page", async () => {
    const fetchPage = pagedFetcher([1, 2, 3]);
    expect(await paginateAll(10, fetchPage)).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0, 9);
  });

  it("returns an empty array when the source is empty", async () => {
    const fetchPage = pagedFetcher<number>([]);
    expect(await paginateAll(5, fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("follows multiple full pages plus a short final page", async () => {
    const all = Array.from({ length: 1042 }, (_, i) => i);
    const fetchPage = pagedFetcher(all);
    const result = await paginateAll(1000, fetchPage);
    expect(result).toEqual(all);
    expect(result).toHaveLength(1042);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("issues one extra empty-page request when the total is an exact multiple of pageSize", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => i);
    const fetchPage = pagedFetcher(all);
    const result = await paginateAll(1000, fetchPage);
    expect(result).toEqual(all);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 2000, 2999);
  });
});

describe("paginateSelect", () => {
  const all = Array.from({ length: 1042 }, (_, i) => ({ id: i }));

  it("collects every page from a Supabase-shaped query builder", async () => {
    const build = vi.fn(async (from: number, to: number) => ({
      data: all.slice(from, to + 1),
      error: null,
    }));
    const rows = await paginateSelect(1000, build);
    expect(rows).toEqual(all);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenNthCalledWith(1, 0, 999);
    expect(build).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("throws the PostgREST error message on a failed page", async () => {
    const build = vi.fn(async () => ({ data: null, error: { message: "permission denied" } }));
    await expect(paginateSelect(1000, build)).rejects.toThrow("permission denied");
  });

  it("treats a null data payload on success as an empty page", async () => {
    const build = vi.fn(async () => ({ data: null, error: null }));
    expect(await paginateSelect(1000, build)).toEqual([]);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
