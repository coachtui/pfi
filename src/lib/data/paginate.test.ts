import { describe, expect, it, vi } from "vitest";
import { paginateAll } from "./paginate";

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
