import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { branding } from "@/lib/config/branding";

describe("web app manifest", () => {
  const m = manifest();

  it("derives all naming from branding.ts", () => {
    expect(m.name).toBe(branding.appTitle);
    expect(m.short_name).toBe(branding.productName);
    expect(m.description).toBe(branding.description);
  });

  it("is installable: standalone display, root start_url, matching theme colors", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.background_color).toBe("#0b0d0f");
    expect(m.theme_color).toBe("#0b0d0f");
  });

  it("declares 192/512 any-purpose icons plus a 512 maskable", () => {
    const entries = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(entries).toContain("192x192:any");
    expect(entries).toContain("512x512:any");
    expect(entries).toContain("512x512:maskable");
  });
});
