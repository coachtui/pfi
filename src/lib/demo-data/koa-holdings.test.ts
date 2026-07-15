import { describe, expect, it } from "vitest";
import { generateKoaHoldings } from "./koa-holdings";
import { buildDailySnapshots, buildIndexSeries, availablePosition } from "../financial-engine";

describe("generateKoaHoldings", () => {
  const dataset = generateKoaHoldings();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);

  it("is deterministic across runs", () => {
    const again = generateKoaHoldings();
    expect(again.accounts).toEqual(dataset.accounts);
    expect(again.transactions).toEqual(dataset.transactions);
    expect(again.events).toEqual(dataset.events);
  });

  it("produces 430 days of snapshots ending 2026-07-15, ascending", () => {
    expect(snapshots).toHaveLength(430);
    expect(snapshots[snapshots.length - 1].date).toBe("2026-07-15");
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].date > snapshots[i - 1].date).toBe(true);
    }
  });

  it("transfer pairs are symmetric and self-consistent", () => {
    const byId = new Map(dataset.transactions.map((t) => [t.id, t]));
    const transfers = dataset.transactions.filter((t) => t.isTransfer);
    expect(transfers.length).toBeGreaterThan(0);
    for (const t of transfers) {
      const pair = byId.get(t.transferPairId!);
      expect(pair).toBeDefined();
      expect(pair!.transferPairId).toBe(t.id);
      expect(pair!.amount).toBe(t.amount);
      expect(pair!.direction).not.toBe(t.direction);
    }
  });

  it("stays financially plausible: above waterline most days", () => {
    const above = snapshots.filter(
      (s) => availablePosition(s) > s.essentialObligations + s.safetyBuffer,
    );
    expect(above.length / snapshots.length).toBeGreaterThan(0.7);
  });

  it("indexes with a positive anchor and an improving arc", () => {
    const { points, anchor } = buildIndexSeries(snapshots);
    expect(anchor.anchorValue).toBeGreaterThan(0);
    expect(points[points.length - 1].actual).toBeGreaterThan(100);
    expect(points[points.length - 1].baseline).not.toBeNull();
  });

  it("emits the expected recurring event types", () => {
    const types = new Set(dataset.events.map((e) => e.type));
    for (const expected of ["paycheck", "bonus", "mortgage_payment", "insurance_payment", "investment_contribution", "debt_payment"]) {
      expect(types.has(expected as never)).toBe(true);
    }
  });
});
