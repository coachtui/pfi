import { describe, expect, it } from "vitest";
import { MOMENTUM_THRESHOLD, computeScoreMomentum, momentumLabel } from "./momentum-overlay";

describe("computeScoreMomentum", () => {
  it.each([
    // [current, prior30, prior60, expected]
    [700, 680, 660, "strongly_improving"], // both segments +20 > 9
    [700, 685, 683, "improving"],          // recent +15, earlier +2 within threshold
    [700, 685, 700, "recovering"],         // recent +15 after a −15 decline
    [660, 680, 700, "deteriorating"],      // both segments −20
    [685, 700, 702, "weakening"],          // recent −15, earlier flat
    [700, 702, 699, "stable"],             // both inside ±9
    [709, 700, 700, "stable"],             // d1 = +9 exactly — 9 is NOT > 9
    [691, 700, 700, "stable"],             // d1 = −9 exactly — −9 is NOT < −9
    [718, 709, 700, "stable"],             // d1 = +9, d2 = +9 — both at threshold
  ])("(%s, %s, %s) → %s", (current, prior30, prior60, expected) => {
    expect(computeScoreMomentum({ current, prior30, prior60 })).toBe(expected);
  });

  it("returns insufficient_history when any point is missing", () => {
    expect(computeScoreMomentum({ current: 700, prior30: 690, prior60: null })).toBe("insufficient_history");
    expect(computeScoreMomentum({ current: null, prior30: 690, prior60: 680 })).toBe("insufficient_history");
    expect(computeScoreMomentum({ current: 700, prior30: null, prior60: 680 })).toBe("insufficient_history");
  });

  it("uses the documented threshold", () => {
    expect(MOMENTUM_THRESHOLD).toBe(9); // 1% of the 900 scale — spec value
  });

  it("labels every state with consumer copy", () => {
    expect(momentumLabel("insufficient_history")).toBe("Not enough history yet");
    expect(momentumLabel("strongly_improving")).toBe("Strongly improving");
  });
});
