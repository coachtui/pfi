import { describe, expect, it } from "vitest";
import { percentToDecimal } from "./unit-conversions";

describe("percentToDecimal", () => {
  it("converts a stored percent to a decimal APR", () => {
    expect(percentToDecimal(22.99)).toBeCloseTo(0.2299);
  });

  it("keeps zero as zero", () => {
    expect(percentToDecimal(0)).toBe(0);
  });

  it("is null-safe", () => {
    expect(percentToDecimal(null)).toBeNull();
  });
});
