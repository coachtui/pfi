import { describe, expect, it } from "vitest";
import { COMPANY_PRESETS, isKnownPresetId, resolveEmblem } from "./company-presets";

describe("COMPANY_PRESETS", () => {
  it("has unique, kebab-case ids and populated fields", () => {
    const ids = COMPANY_PRESETS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of COMPANY_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.Icon).toBeTruthy();
    }
  });
});

describe("resolveEmblem", () => {
  it("resolves a known preset id", () => {
    const first = COMPANY_PRESETS[0];
    expect(resolveEmblem(`preset:${first.id}`)).toEqual({ kind: "preset", preset: first });
  });
  it("falls back to default for null", () => {
    expect(resolveEmblem(null)).toEqual({ kind: "default" });
  });
  it("falls back to default for an unknown preset id", () => {
    expect(resolveEmblem("preset:does-not-exist")).toEqual({ kind: "default" });
  });
  it("falls back to default for malformed values", () => {
    expect(resolveEmblem("upload:whatever")).toEqual({ kind: "default" });
    expect(resolveEmblem("garbage")).toEqual({ kind: "default" });
  });
});

describe("isKnownPresetId", () => {
  it("is true for a registered id and false otherwise", () => {
    expect(isKnownPresetId(COMPANY_PRESETS[0].id)).toBe(true);
    expect(isKnownPresetId("nope")).toBe(false);
  });
});
