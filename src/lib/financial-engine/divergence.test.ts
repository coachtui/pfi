import { describe, expect, it } from "vitest";
import { computeDivergence, divergenceTemplate } from "./divergence";

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

describe("divergenceTemplate", () => {
  it("phrases index-down / score-up", () => {
    const s = divergenceTemplate(
      { direction: "index_down_score_up", scoreMomentum: "improving" },
      "Koa Holdings",
    );
    expect(s).toBe(
      "Koa Holdings's PFI dipped on recent cash movement, but its 90-day fundamentals kept improving — the two track different time horizons.",
    );
  });

  it("phrases index-up / score-down", () => {
    const s = divergenceTemplate(
      { direction: "index_up_score_down", scoreMomentum: "weakening" },
      "Koa Holdings",
    );
    expect(s).toBe(
      "Koa Holdings's PFI rose on recent cash inflow, but its 90-day fundamentals softened — the two track different time horizons.",
    );
  });
});
