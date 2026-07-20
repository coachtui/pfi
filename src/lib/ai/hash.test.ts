import { describe, expect, it } from "vitest";
import { narrationInputHash } from "./hash";
import { BRIEF_SURFACE, briefInputSchema, type BriefInput } from "./schemas";

function makeInput(overrides: Partial<BriefInput> = {}): BriefInput {
  return briefInputSchema.parse({
    surface: BRIEF_SURFACE,
    companyName: "Test Co",
    periodDays: 30,
    availableCapital: 100,
    cushion: 50,
    vsBaseline: "above",
    vsWaterline: "above",
    momentum: { direction: "stable", delta: 0, windowDays: 7 },
    drivers: [],
    score: null,
    ...overrides,
  });
}

describe("narrationInputHash", () => {
  it("is stable across object key order", () => {
    const a = makeInput();
    const reordered = JSON.parse(
      // @ts-expect-error - intentionally reordering keys to test independence
      JSON.stringify({ score: a.score, drivers: a.drivers, ...a }),
    ) as BriefInput;
    expect(narrationInputHash(a)).toBe(narrationInputHash(reordered));
    expect(narrationInputHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any value changes", () => {
    expect(narrationInputHash(makeInput())).not.toBe(
      narrationInputHash(makeInput({ availableCapital: 101 })),
    );
  });
});
