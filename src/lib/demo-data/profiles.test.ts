import { describe, expect, it } from "vitest";
import {
  DEMO_PROFILE_METAS, DEFAULT_PROFILE_ID, isDemoProfileId, detectActiveProfile,
} from "./profiles";
import { DEMO_GENERATORS } from "./generators";

describe("demo profile registry", () => {
  it("has three profiles with koa-holdings as the default", () => {
    expect(DEMO_PROFILE_METAS.map((m) => m.id)).toEqual(["koa-holdings", "blue-reef", "north-shore"]);
    expect(DEFAULT_PROFILE_ID).toBe("koa-holdings");
  });

  it("metadata is complete and signature names are mutually unique", () => {
    const signatures = DEMO_PROFILE_METAS.map((m) => m.signatureAccountName);
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const m of DEMO_PROFILE_METAS) {
      expect(m.companyName.length).toBeGreaterThan(0);
      expect(m.ticker.startsWith("$")).toBe(true);
      expect(m.username.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("every signature account name actually appears in its generator's output", () => {
    for (const m of DEMO_PROFILE_METAS) {
      const names = DEMO_GENERATORS[m.id]().accounts.map((a) => a.displayName);
      expect(names).toContain(m.signatureAccountName);
    }
  });

  it("isDemoProfileId accepts known ids and rejects everything else", () => {
    expect(isDemoProfileId("koa-holdings")).toBe(true);
    expect(isDemoProfileId("blue-reef")).toBe(true);
    expect(isDemoProfileId("north-shore")).toBe(true);
    expect(isDemoProfileId("evil")).toBe(false);
    expect(isDemoProfileId(undefined)).toBe(false);
    expect(isDemoProfileId(42)).toBe(false);
  });

  it("detectActiveProfile round-trips each profile's account names and returns null otherwise", () => {
    for (const m of DEMO_PROFILE_METAS) {
      const names = DEMO_GENERATORS[m.id]().accounts.map((a) => a.displayName);
      expect(detectActiveProfile(names)).toBe(m.id);
    }
    expect(detectActiveProfile([])).toBeNull();
    expect(detectActiveProfile(["My Checking"])).toBeNull();
  });
});
