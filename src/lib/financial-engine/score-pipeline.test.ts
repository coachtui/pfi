import { describe, expect, it } from "vitest";
import type { DailySnapshot } from "./types";
import { buildMetricInputs, type ScoreAccountInput, type ScoreTransactionInput } from "./metric-inputs";
import { computeMetrics } from "./metrics";
import { computeConfidence } from "./confidence";
import { computeScore } from "./scoring";
import { computeScoreDelta } from "./score-delta";
import { computeScoreMomentum } from "./momentum-overlay";
import { addDays } from "./snapshot-builder";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 15000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 1500, creditLimit: 10000, interestRate: 0.22, includeInCalculations: true, provider: "manual" },
  { id: "brk", type: "brokerage", institution: "Vanguard", currentBalance: 25000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
];

/** 180 days: payroll every 30d, rent/groceries, monthly 600 contribution + 500 card payment. */
function fixture(): { snapshots: DailySnapshot[]; txns: ScoreTransactionInput[] } {
  const txns: ScoreTransactionInput[] = [];
  const snapshots: DailySnapshot[] = [];
  const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null, description: "" };
  for (let d = 179; d >= 0; d--) {
    const date = addDays(AS_OF, -d);
    snapshots.push({ date, liquidAssets: 20000 + (179 - d) * 25, revolvingBalances: 1500, nearTermObligations: 2600, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 45000 });
    if (d % 30 === 0) {
      txns.push({ ...base, id: `pay${d}`, postedDate: date, amount: 5500, direction: "inflow", category: "income", description: "Employer payroll" });
      txns.push({ ...base, id: `rent${d}`, postedDate: date, amount: 1700, direction: "outflow", category: "housing", essential: true });
      txns.push({ ...base, id: `gro${d}`, postedDate: date, amount: 600, direction: "outflow", category: "groceries", essential: true });
      txns.push({ ...base, id: `co${d}`, postedDate: date, amount: 600, direction: "outflow", isTransfer: true, transferPairId: `ci${d}` });
      txns.push({ ...base, id: `ci${d}`, postedDate: date, amount: 600, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: `co${d}` });
      txns.push({ ...base, id: `do${d}`, postedDate: date, amount: 500, direction: "outflow", isTransfer: true, transferPairId: `di${d}` });
      txns.push({ ...base, id: `di${d}`, postedDate: date, amount: 500, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: `do${d}` });
    }
  }
  return { snapshots, txns };
}

function breakdownAt(asOf: string) {
  const { snapshots, txns } = fixture();
  const inputs = buildMetricInputs(snapshots, txns, ACCOUNTS, asOf);
  const results = computeMetrics(inputs);
  const confidence = computeConfidence(inputs, results);
  return computeScore(results, confidence.byDimension, asOf);
}

describe("full score pipeline", () => {
  it("produces a full, versioned, explainable breakdown on healthy manual data", () => {
    const b = breakdownAt(AS_OF);
    expect(b.state).toBe("full");
    expect(b.version).toBe("1.0");
    expect(b.overall).toBeGreaterThanOrEqual(0);
    expect(b.overall).toBeLessThanOrEqual(900);
    expect(b.dimensions).toHaveLength(6);
    for (const d of b.dimensions) {
      expect(d.eligible, d.key).toBe(true);
      expect(d.score, d.key).not.toBeNull();
      // every scored+available metric is fully explainable
      for (const m of d.metrics.filter((m) => m.scored && m.availability === "available")) {
        expect(m.curveScore, m.id).not.toBeNull();
        expect(m.formatted, m.id).not.toBeNull();
      }
    }
    expect(b.protection.includedInScore).toBe(false);
  });

  it("is deterministic and stable across dates (steady fixture ⇒ stable momentum)", () => {
    const s0 = breakdownAt(AS_OF).overall!;
    const s30 = breakdownAt(addDays(AS_OF, -30)).overall!;
    const s60 = breakdownAt(addDays(AS_OF, -60)).overall!;
    expect(breakdownAt(AS_OF).overall).toBe(s0); // same inputs ⇒ same output
    expect(computeScoreMomentum({ current: s0, prior30: s30, prior60: s60 })).toBe("stable");
    const delta = computeScoreDelta(breakdownAt(AS_OF), breakdownAt(addDays(AS_OF, -30)));
    expect(delta.state).toBe("ok");
    expect(Math.abs(delta.change ?? 99)).toBeLessThan(10);
  });
});
