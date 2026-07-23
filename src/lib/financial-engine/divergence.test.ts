import { describe, expect, it } from "vitest";
import { computeDivergence } from "./divergence";

describe("computeDivergence", () => {
  it("flags index down + score improving", () => {
    expect(computeDivergence(-12.3, "strongly_improving")).toEqual({
      direction: "index_down_score_up",
      scoreMomentum: "strongly_improving",
    });
  });

  it("flags index up + score deteriorating", () => {
    expect(computeDivergence(4.1, "deteriorating")).toEqual({
      direction: "index_up_score_down",
      scoreMomentum: "deteriorating",
    });
  });

  it("treats recovering as an up score", () => {
    expect(computeDivergence(-1, "recovering")?.direction).toBe("index_down_score_up");
  });

  it("returns null when both point up", () => {
    expect(computeDivergence(5, "improving")).toBeNull();
  });

  it("returns null when both point down", () => {
    expect(computeDivergence(-5, "weakening")).toBeNull();
  });

  it("returns null for neutral score momentum", () => {
    expect(computeDivergence(-5, "stable")).toBeNull();
    expect(computeDivergence(-5, "insufficient_history")).toBeNull();
  });

  it("returns null when the index delta is zero or unknown", () => {
    expect(computeDivergence(0, "improving")).toBeNull();
    expect(computeDivergence(null, "weakening")).toBeNull();
  });
});
