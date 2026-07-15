import { describe, expect, it } from "vitest";
import { generateKoaHoldings } from "./koa-holdings";
import { availablePosition, buildIndexSeries } from "../financial-engine";

describe("generateKoaHoldings", () => {
  it("is deterministic: two runs produce identical datasets", () => {
    const a = generateKoaHoldings();
    const b = generateKoaHoldings();
    expect(a.snapshots).toEqual(b.snapshots);
    expect(a.events).toEqual(b.events);
  });

  it("produces enough history for 30D, 90D, and 1Y charts", () => {
    const { snapshots } = generateKoaHoldings();
    expect(snapshots.length).toBeGreaterThanOrEqual(395);
    expect(snapshots[snapshots.length - 1].date).toBe("2026-07-15");
  });

  it("dates are consecutive and ascending", () => {
    const { snapshots } = generateKoaHoldings();
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].date > snapshots[i - 1].date).toBe(true);
    }
  });

  it("stays financially plausible: solvent household above its waterline most days", () => {
    const { snapshots } = generateKoaHoldings();
    const aboveWaterline = snapshots.filter(
      (s) => availablePosition(s) > s.essentialObligations + s.safetyBuffer,
    );
    expect(aboveWaterline.length / snapshots.length).toBeGreaterThan(0.7);
  });

  it("indexes cleanly with a positive anchor (healthy demo narrative)", () => {
    const { snapshots } = generateKoaHoldings();
    const { points, anchor } = buildIndexSeries(snapshots);
    expect(anchor.anchorValue).toBeGreaterThan(0);
    const last = points[points.length - 1];
    // Improving-liquidity arc: ends above where it started.
    expect(last.actual).toBeGreaterThan(100);
    expect(last.baseline).not.toBeNull();
  });

  it("emits recurring events (paychecks, mortgage, investments)", () => {
    const { events } = generateKoaHoldings();
    const types = new Set(events.map((e) => e.type));
    for (const expected of [
      "paycheck",
      "bonus",
      "mortgage_payment",
      "insurance_payment",
      "investment_contribution",
      "debt_payment",
    ]) {
      expect(types.has(expected as never)).toBe(true);
    }
  });
});
