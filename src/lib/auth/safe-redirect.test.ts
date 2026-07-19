import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("accepts a same-site relative path", () => {
    expect(safeRedirectPath("/auth/reset/update")).toBe("/auth/reset/update");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
  });

  it("rejects backslash-containing values", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
  });

  it("falls back to / for null", () => {
    expect(safeRedirectPath(null)).toBe("/");
  });

  it("falls back to / for empty string", () => {
    expect(safeRedirectPath("")).toBe("/");
  });
});
