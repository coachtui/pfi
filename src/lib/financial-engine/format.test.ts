import { describe, expect, it } from "vitest";
import { formatSignedPoints } from "./format";

describe("formatSignedPoints", () => {
  it("formats a positive delta with a plus sign and one decimal", () => {
    expect(formatSignedPoints(1.3)).toBe("+1.3");
  });

  it("formats a negative delta with a true minus sign (U+2212)", () => {
    expect(formatSignedPoints(-0.4)).toBe("−0.4");
  });

  it("formats zero as +0.0", () => {
    expect(formatSignedPoints(0)).toBe("+0.0");
  });

  it("rounds to one decimal", () => {
    expect(formatSignedPoints(2.649)).toBe("+2.6");
    expect(formatSignedPoints(-2.66)).toBe("−2.7");
  });
});
