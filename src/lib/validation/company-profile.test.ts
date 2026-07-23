import { describe, expect, it } from "vitest";
import { companyProfileSchema } from "./company-profile";

const valid = { companyName: "Koa Holdings", ticker: "KOAH", username: "IslandBuilder", logoPath: null };

describe("companyProfileSchema", () => {
  it("accepts a valid payload with a null emblem", () => {
    expect(companyProfileSchema.parse(valid)).toMatchObject({ ticker: "KOAH", logoPath: null });
  });
  it("uppercases the ticker", () => {
    expect(companyProfileSchema.parse({ ...valid, ticker: "koah" }).ticker).toBe("KOAH");
  });
  it("accepts a preset emblem", () => {
    expect(companyProfileSchema.parse({ ...valid, logoPath: "preset:waves" }).logoPath).toBe("preset:waves");
  });
  it("rejects a too-long ticker", () => {
    expect(() => companyProfileSchema.parse({ ...valid, ticker: "TOOLONG1" })).toThrow();
  });
  it("rejects a username with spaces", () => {
    expect(() => companyProfileSchema.parse({ ...valid, username: "island builder" })).toThrow();
  });
  it("rejects a malformed logoPath (e.g. an upload path)", () => {
    expect(() => companyProfileSchema.parse({ ...valid, logoPath: "upload:abc/def.webp" })).toThrow();
  });
});
