# Demo Profiles + Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two contrasting demo profiles (Blue Reef Partners — early-career under strain; North Shore Capital — pre-retirement debt-free) and a demo-profile switcher on `/accounts` plus the dashboard empty state, per `docs/superpowers/specs/2026-07-17-demo-profiles-design.md`.

**Architecture:** Approach C from the spec: per-profile hand-authored generators (Koa byte-identical), shared scaffolding extracted to `src/lib/demo-data/shared.ts`, a client-safe metadata registry (`profiles.ts`) split from a server-side generator map (`generators.ts`) so generator code stays out of client bundles. `loadDemoData` gains a validated `profileId` and both demo actions convert to the codebase's `{ error }` contract. Active profile is detected from seeded demo-account display names — no schema change.

**Tech Stack:** Next.js 16 App Router, strict TS, Vitest, Supabase (no migrations in this slice), Tailwind 4.

## Global Constraints

- `src/lib/demo-data/` and `src/lib/financial-engine/` stay framework-free: no React/Next imports (CLAUDE.md).
- **Koa Holdings output must stay byte-identical**: `koa-holdings.test.ts` passes unmodified; `generateKoaHoldings()` still uses `SEED = 20260715`, `END_DATE = "2026-07-15"`, `HISTORY_DAYS = 430`.
- Both new generators: fixed seed, `END_DATE = "2026-07-15"`, `HISTORY_DAYS = 430` (so 30D/90D/1Y ranges render), deterministic via `mulberry32`.
- Account records store interest rates as **percent** (e.g. `26.99`); the read boundary (`queries.ts`) converts to decimal for the engine. Tests that bypass queries must divide by 100 themselves.
- Server actions return `{ error: string }` (`""` on success) behind RLS-bound queries — the existing action contract.
- UI: mobile-first (~390px verified before desktop), no color-only state signaling (pair with glyph/text), no native browser dialogs (two-step in-app confirm for destructive actions), no shame-oriented copy in profile descriptions.
- `pnpm check` green before completion claims. Baseline entering this slice: 221 tests / 28 files; `pnpm test:rls` 19/19; lint 0 errors + 1 pre-existing `AccountSheet.tsx` warning.
- No schema changes; `pnpm test:rls` expected unchanged at 19/19.

---

### Task 1: Shared scaffolding + DemoAccount credit fields

**Files:**
- Create: `src/lib/demo-data/shared.ts`
- Modify: `src/lib/demo-data/koa-holdings.ts` (imports/re-exports only — generated output unchanged)
- Modify: `src/lib/data/mappers.ts:54-61` (`demoAccountToRow`)
- Test: `src/lib/demo-data/koa-holdings.test.ts` (must pass UNMODIFIED), `src/lib/data/mappers.test.ts`

**Interfaces:**
- Produces: `shared.ts` exporting `Day`, `enumerateDays(end: ISODate, count: number): Day[]`, `DemoProfileBase`, `DemoAccount`, `DemoTransaction`, `DemoDataset`. `DemoAccount` gains optional `creditLimit?: number | null` and `interestRate?: number | null` (interestRate in **percent**). `koa-holdings.ts` re-exports the moved types so existing importers (`mappers.ts`, `actions/demo.ts`) keep working unchanged.

- [ ] **Step 1: Write the failing test for the mapper threading**

In `src/lib/data/mappers.test.ts`, inside the existing `describe("mappers", ...)` block add:

```ts
  it("demoAccountToRow threads creditLimit and interestRate when present, null otherwise", () => {
    const base = {
      id: "a1", type: "credit_card" as const, currentBalance: 4300, includeInCalculations: true,
      provider: "demo" as const, displayName: "Card", institution: "Bank", subtype: null, mask: "1111",
    };
    const withCredit = demoAccountToRow("user-1", { ...base, creditLimit: 5000, interestRate: 26.99 });
    expect(withCredit.credit_limit).toBe(5000);
    expect(withCredit.interest_rate).toBe(26.99);
    const without = demoAccountToRow("user-1", base);
    expect(without.credit_limit).toBeNull();
    expect(without.interest_rate).toBeNull();
  });
```

Add `demoAccountToRow` to the file's existing import list from `./mappers`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — `credit_limit` is `undefined`, not `5000`/`null` (the mapper doesn't emit the keys yet).

- [ ] **Step 3: Create `src/lib/demo-data/shared.ts`**

Move (not copy) the following out of `koa-holdings.ts`, with the two new optional fields on `DemoAccount`:

```ts
import type { FinancialEvent, ISODate } from "../financial-engine/types";
import type {
  AccountInput,
  SnapshotBuilderConfig,
  TransactionInput,
} from "../financial-engine/snapshot-builder";

/** Decorative identity carried by a demo dataset; never written to user rows. */
export interface DemoProfileBase {
  companyName: string;
  ticker: string;
  username: string;
}

export interface Day {
  date: ISODate;
  y: number;
  m: number; // 1-based
  d: number;
}

export function enumerateDays(end: ISODate, count: number): Day[] {
  const [y, m, d] = end.split("-").map(Number);
  const endUtc = Date.UTC(y, m - 1, d);
  const days: Day[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = new Date(endUtc - i * 86_400_000);
    days.push({
      date: t.toISOString().slice(0, 10),
      y: t.getUTCFullYear(),
      m: t.getUTCMonth() + 1,
      d: t.getUTCDate(),
    });
  }
  return days;
}

export interface DemoAccount extends AccountInput {
  provider: "demo";
  displayName: string;
  institution: string;
  subtype: string | null;
  mask: string;
  /** Credit limit in dollars; only meaningful for credit_card accounts. */
  creditLimit?: number | null;
  /** APR in PERCENT (e.g. 26.99) to match the financial_accounts column; the read boundary converts to decimal. */
  interestRate?: number | null;
}

export interface DemoTransaction extends TransactionInput {
  description: string;
}

export interface DemoDataset {
  profile: DemoProfileBase;
  accounts: DemoAccount[];
  transactions: DemoTransaction[];
  events: FinancialEvent[];
  config: SnapshotBuilderConfig;
}
```

- [ ] **Step 4: Refactor `koa-holdings.ts` to use shared.ts**

Remove the moved `Day`/`enumerateDays`/`DemoAccount`/`DemoTransaction`/`DemoDataset` definitions from `koa-holdings.ts` and replace with:

```ts
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";

export type { DemoAccount, DemoTransaction, DemoDataset } from "./shared";
```

(The re-export keeps `mappers.ts` and `actions/demo.ts` imports working unchanged.) Delete the now-unused `AccountInput`/`TransactionInput`/`SnapshotBuilderConfig` type imports from `koa-holdings.ts` if nothing else in the file references them (`SnapshotBuilderConfig` is only used via `DemoDataset`; `ISODate` is still used by `END_DATE` — keep it). `DemoDataset.profile` is now typed `DemoProfileBase`; `koaProfile` has extra fields (ageCohort etc.) which is fine structurally. Do not change any generator constant, loop, or account literal.

- [ ] **Step 5: Thread credit fields through `demoAccountToRow`**

In `src/lib/data/mappers.ts` change `demoAccountToRow` to:

```ts
export function demoAccountToRow(userId: string, a: DemoAccount): Record<string, unknown> {
  return {
    user_id: userId, provider: a.provider, institution: a.institution, type: a.type,
    subtype: a.subtype, display_name: a.displayName, mask: a.mask,
    current_balance: a.currentBalance, include_in_calculations: a.includeInCalculations,
    credit_limit: a.creditLimit ?? null, interest_rate: a.interestRate ?? null,
    connection_status: "ok", last_synced_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/lib/data/mappers.test.ts src/lib/demo-data/koa-holdings.test.ts && pnpm typecheck`
Expected: PASS, including the untouched koa test (proves output unchanged). Typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/demo-data/shared.ts src/lib/demo-data/koa-holdings.ts src/lib/data/mappers.ts src/lib/data/mappers.test.ts
git commit -m "refactor(demo): extract shared demo-data scaffolding; thread credit fields through demoAccountToRow"
```

---

### Task 2: Blue Reef Partners generator

**Files:**
- Create: `src/lib/demo-data/blue-reef.ts`
- Test: `src/lib/demo-data/blue-reef.test.ts`

**Interfaces:**
- Consumes: `shared.ts` (Task 1), `mulberry32` from `./prng`, engine exports `buildDailySnapshots`, `availablePosition`, `buildMetricInputs`, `computeMetrics`, `computeConfidence`, `computeScore` (see the import lines in the test below — they mirror `score-pipeline.test.ts`).
- Produces: `blueReefProfile` const and `generateBlueReef(): DemoDataset`. Account display names include the signature `"Reef Checking"` (Task 4 depends on this exact string).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo-data/blue-reef.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateBlueReef } from "./blue-reef";
import { buildDailySnapshots, availablePosition } from "../financial-engine";
import { buildMetricInputs, type ScoreAccountInput } from "../financial-engine/metric-inputs";
import { computeMetrics } from "../financial-engine/metrics";
import { computeConfidence } from "../financial-engine/confidence";
import { computeScore } from "../financial-engine/scoring";

const AS_OF = "2026-07-15";

function toScoreAccounts(dataset: ReturnType<typeof generateBlueReef>): ScoreAccountInput[] {
  return dataset.accounts.map((a) => ({
    id: a.id, type: a.type, institution: a.institution, currentBalance: a.currentBalance,
    creditLimit: a.creditLimit ?? null,
    // account records store percent; the read boundary divides by 100
    interestRate: a.interestRate == null ? null : a.interestRate / 100,
    includeInCalculations: a.includeInCalculations, provider: a.provider,
  }));
}

describe("generateBlueReef", () => {
  const dataset = generateBlueReef();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);

  it("is deterministic across runs", () => {
    const again = generateBlueReef();
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

  it("dips below the waterline on at least some days (persona: under strain)", () => {
    const below = snapshots.filter(
      (s) => availablePosition(s) < s.essentialObligations + s.safetyBuffer,
    );
    expect(below.length).toBeGreaterThan(0);
  });

  it("carries a credit limit and APRs so debt metrics are scorable", () => {
    const card = dataset.accounts.find((a) => a.type === "credit_card")!;
    expect(card.creditLimit).toBeGreaterThan(0);
    expect(card.currentBalance / card.creditLimit!).toBeGreaterThanOrEqual(0.75);
    expect(card.interestRate).toBeGreaterThan(20); // percent
  });

  it("scores in a low band with Growth eligible-but-low (persona invariants)", () => {
    const inputs = buildMetricInputs(snapshots, dataset.transactions, toScoreAccounts(dataset), AS_OF);
    const results = computeMetrics(inputs);
    const confidence = computeConfidence(inputs, results);
    const breakdown = computeScore(results, confidence.byDimension, AS_OF);

    expect(breakdown.overall).not.toBeNull();
    expect(breakdown.overall!).toBeLessThan(500); // Building or Needs attention

    const util = results.find((m) => m.id === "revolving_utilization")!;
    expect(util.availability).toBe("available");
    expect(util.value!).toBeGreaterThanOrEqual(0.75);

    const growth = breakdown.dimensions.find((d) => d.key === "growth")!;
    expect(growth.eligible).toBe(true);
    expect(growth.score!).toBeLessThanOrEqual(40);
  });
});
```

(Property names are verified against the real types: `DimensionResult.key/eligible/score`, `MetricResult.id/availability/value`, `ScoreBreakdown.overall`, dimension keys `"growth"`/`"debt"`/`"concentration"` per `scoring.ts` `DIMENSIONS`. `DemoTransaction` satisfies `ScoreTransactionInput` structurally — it carries `description`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/demo-data/blue-reef.test.ts`
Expected: FAIL — cannot resolve `./blue-reef`.

- [ ] **Step 3: Write the generator**

Create `src/lib/demo-data/blue-reef.ts`:

```ts
import type { FinancialEvent, ISODate } from "../financial-engine/types";
import { mulberry32 } from "./prng";
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";

/**
 * Blue Reef Partners — deterministic demo profile.
 *
 * 20–29 cohort, early-career renter under strain in a high-cost region.
 * Irregular income (small part-time paycheck + gig deposits), high-utilization
 * credit card, student loan, near-zero investment contributions, thin savings.
 * Exists to exercise the product's low-band / below-waterline / high-utilization
 * states honestly. Fixed seed + fixed end date ⇒ identical dataset every run.
 */

export const blueReefProfile = {
  companyName: "Blue Reef Partners",
  ticker: "$BRFP",
  username: "CoralTrader",
  ageCohort: "20–29",
  objective: "reduce_debt",
} as const;

const SEED = 84121347;
const END_DATE: ISODate = "2026-07-15";
const HISTORY_DAYS = 430;

const PAYCHECK = 980; // part-time, 7th & 21st; +140 raise from 2026
const RENT = 1150; // 1st
const UTILITIES = 145; // 6th
const PHONE = 68; // 18th
const STREAMING = 32; // 11th
const LOAN_PAYMENT = 180; // 5th (student loan)
const CARD_PAYMENT = 500; // 15th
const ESSENTIAL_DAILY = 26;
const SAFETY_BUFFER = 800;

const CHK = "brf-checking";
const SAV = "brf-savings";
const CARD = "brf-card";
const LOAN = "brf-student-loan";

export function generateBlueReef(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 1_400;
  let savings = 850;
  let card = 4_300;
  let loan = 17_600;

  const transactions: DemoTransaction[] = [];
  const events: FinancialEvent[] = [];
  let tSeq = 0;
  let eSeq = 0;
  let gigSeq = 100;

  const pushTxn = (
    day: Day,
    accountId: string,
    amount: number,
    direction: "inflow" | "outflow",
    description: string,
    opts: { category?: string; essential?: boolean; isTransfer?: boolean; transferPairId?: string | null } = {},
  ): string => {
    const id = `brf-t-${tSeq++}`;
    transactions.push({
      id, accountId, postedDate: day.date, amount: Math.round(amount * 100) / 100, direction,
      description, category: opts.category ?? null, essential: opts.essential ?? null,
      isTransfer: opts.isTransfer ?? false, transferPairId: opts.transferPairId ?? null,
    });
    return id;
  };

  const pushEvent = (
    day: Day, type: FinancialEvent["type"], label: string, amount: number,
    direction: FinancialEvent["direction"],
  ) => {
    events.push({ id: `brf-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `brf-t-${tSeq}`;
    const inId = `brf-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? PAYCHECK + 140 : PAYCHECK;
    if (day.d === 7 || day.d === 21) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    // Irregular gig income: distinct descriptions so each deposit reads as a
    // one-off source (Stability's irregular-income metrics must see it).
    if (rand() < 0.18) {
      const amount = Math.round(45 + rand() * 230);
      checking += amount;
      pushTxn(day, CHK, amount, "inflow", `Gig payout #${gigSeq++}`, { category: "income" });
    }
    if (day.d === 1) {
      checking -= RENT;
      pushTxn(day, CHK, RENT, "outflow", "Rent", { category: "housing", essential: true });
    }
    if (day.d === 6) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 18) {
      checking -= PHONE;
      pushTxn(day, CHK, PHONE, "outflow", "Phone plan", { category: "utilities", essential: true });
    }
    if (day.d === 11) {
      checking -= STREAMING;
      pushTxn(day, CHK, STREAMING, "outflow", "Streaming subscriptions", { category: "discretionary", essential: false });
    }
    if (day.d === 5) {
      checking -= LOAN_PAYMENT;
      loan -= LOAN_PAYMENT;
      transfer(day, CHK, LOAN, LOAN_PAYMENT, "Student loan payment");
      pushEvent(day, "debt_payment", "Student Loan", LOAN_PAYMENT, "outflow");
    }
    if (day.d === 15) {
      const payment = Math.min(CARD_PAYMENT, card);
      if (payment > 0) {
        checking -= payment;
        card -= payment;
        transfer(day, CHK, CARD, payment, "Credit card payment");
        pushEvent(day, "debt_payment", "Credit Card", payment, "outflow");
      }
    }

    const essentials = Math.max(6, ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 14));
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    // Card spend averages ~$19/day (~$580/mo), slightly above the $500 payment,
    // so utilization stays high and drifts upward — the persona's core strain.
    const cardSpend = Math.round(6 + rand() * 26);
    card += cardSpend;
    pushTxn(day, CARD, cardSpend, "outflow", "Card purchases", { category: "discretionary", essential: false });

    if (rand() < 0.04) {
      const amount = Math.round(120 + rand() * 260);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Unexpected expense", { category: "shopping", essential: false });
      pushEvent(day, "unexpected_expense", "Unexpected Expense", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Reef Checking", institution: "Harbor Community Bank", subtype: null, mask: "3308" },
    { id: SAV, type: "savings", currentBalance: Math.round(savings), includeInCalculations: true, provider: "demo", displayName: "Rainy Day Savings", institution: "Harbor Community Bank", subtype: null, mask: "3316" },
    { id: CARD, type: "credit_card", currentBalance: Math.round(card), includeInCalculations: true, provider: "demo", displayName: "Reef Rewards Card", institution: "Harbor Community Bank", subtype: null, mask: "9012", creditLimit: 5_000, interestRate: 26.99 },
    { id: LOAN, type: "student_loan", currentBalance: Math.round(loan), includeInCalculations: true, provider: "demo", displayName: "Student Loan", institution: "EduServe", subtype: null, mask: "7745", interestRate: 5.5 },
  ];

  return {
    profile: blueReefProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
```

Note on final balances: the snapshot builder replays **backward** from `currentBalance`, so the literals above are the *ending* balances; history is derived. `card` mutates during the loop, so its account literal uses the post-loop value — the loop's net card drift (+~$80/month) means the historical start sits lower, which is the intended worsening-utilization arc. Same pattern the Koa generator uses.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/demo-data/blue-reef.test.ts`
Expected: PASS. **If a persona-invariant assertion fails** (band, utilization, waterline): tune the profile's constants (PAYCHECK, RENT, CARD_PAYMENT, gig probability, end balances) — never the assertions — re-run until green, and note the final constants in your report. Determinism/structure tests must pass without tuning.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `pnpm test`
Expected: all pass; count grows from the baseline by this file's tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demo-data/blue-reef.ts src/lib/demo-data/blue-reef.test.ts
git commit -m "feat(demo): Blue Reef Partners profile - early-career under-strain persona"
```

---

### Task 3: North Shore Capital generator

**Files:**
- Create: `src/lib/demo-data/north-shore.ts`
- Test: `src/lib/demo-data/north-shore.test.ts`

**Interfaces:**
- Consumes: same as Task 2.
- Produces: `northShoreProfile` const and `generateNorthShore(): DemoDataset`. Account display names include the signature `"Harbor Checking"` (Task 4 depends on this exact string).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo-data/north-shore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateNorthShore } from "./north-shore";
import { buildDailySnapshots } from "../financial-engine";
import { buildMetricInputs, type ScoreAccountInput } from "../financial-engine/metric-inputs";
import { computeMetrics } from "../financial-engine/metrics";
import { computeConfidence } from "../financial-engine/confidence";
import { computeScore } from "../financial-engine/scoring";

const AS_OF = "2026-07-15";

function toScoreAccounts(dataset: ReturnType<typeof generateNorthShore>): ScoreAccountInput[] {
  return dataset.accounts.map((a) => ({
    id: a.id, type: a.type, institution: a.institution, currentBalance: a.currentBalance,
    creditLimit: a.creditLimit ?? null,
    interestRate: a.interestRate == null ? null : a.interestRate / 100,
    includeInCalculations: a.includeInCalculations, provider: a.provider,
  }));
}

describe("generateNorthShore", () => {
  const dataset = generateNorthShore();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);

  it("is deterministic across runs", () => {
    const again = generateNorthShore();
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

  it("is debt-free: no liability accounts, no debt payments", () => {
    const liabilityTypes = new Set(["credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability"]);
    expect(dataset.accounts.some((a) => liabilityTypes.has(a.type))).toBe(false);
    expect(dataset.events.some((e) => e.type === "debt_payment" || e.type === "debt_payoff")).toBe(false);
  });

  it("hits the persona invariants: debt-free rule, concentration penalty, long runway, high band", () => {
    const inputs = buildMetricInputs(snapshots, dataset.transactions, toScoreAccounts(dataset), AS_OF);
    const results = computeMetrics(inputs);
    const confidence = computeConfidence(inputs, results);
    const breakdown = computeScore(results, confidence.byDimension, AS_OF);

    const debt = breakdown.dimensions.find((d) => d.key === "debt")!;
    expect(debt.eligible).toBe(true);
    expect(debt.score).toBe(100); // debt-free rule

    expect(inputs.institutionShares[0]).toBeGreaterThanOrEqual(0.75);
    const concentration = breakdown.dimensions.find((d) => d.key === "concentration")!;
    expect(concentration.eligible).toBe(true);

    const runway = results.find((m) => m.id === "liquid_runway_months")!;
    expect(runway.availability).toBe("available");
    expect(runway.value!).toBeGreaterThanOrEqual(12);

    expect(breakdown.overall).not.toBeNull();
    expect(breakdown.overall!).toBeGreaterThanOrEqual(640); // Strong or Excellent
  });
});
```

(Property names verified against the real types, same as Task 2; the Debt dimension's key is `"debt"` and Concentration's is `"concentration"` per `scoring.ts` `DIMENSIONS`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/demo-data/north-shore.test.ts`
Expected: FAIL — cannot resolve `./north-shore`.

- [ ] **Step 3: Write the generator**

Create `src/lib/demo-data/north-shore.ts`:

```ts
import type { FinancialEvent, ISODate } from "../financial-engine/types";
import { mulberry32 } from "./prng";
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";

/**
 * North Shore Capital — deterministic demo profile.
 *
 * 50–59 cohort, pre-retirement, debt-free household with a long emergency
 * runway and steady contributions — but ~85%+ of custodial assets held at a
 * single institution. Exists to exercise the debt-free rule, the
 * institution-concentration penalty, and the product's high-band states.
 * Fixed seed + fixed end date ⇒ identical dataset every run.
 */

export const northShoreProfile = {
  companyName: "North Shore Capital",
  ticker: "$NSHC",
  username: "WaveRider",
  ageCohort: "50–59",
  objective: "financial_independence",
} as const;

const SEED = 51900233;
const END_DATE: ISODate = "2026-07-15";
const HISTORY_DAYS = 430;

const SALARY = 6200; // 1st & 15th; +200 from 2026
const BRK_CONTRIB = 2000; // 3rd
const RET_CONTRIB = 1500; // 16th
const HOUSING = 820; // 1st — property tax + HOA (home owned outright)
const UTILITIES = 310; // 8th
const INSURANCE = 290; // 12th
const ESSENTIAL_DAILY = 95;
const SAFETY_BUFFER = 5000;

const CHK = "nsh-checking";
const MM = "nsh-money-market";
const BRK = "nsh-brokerage";
const RET = "nsh-retirement";

export function generateNorthShore(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 26_000;
  let moneyMarket = 92_000;
  let brokerage = 540_000;
  let retirement = 410_000;

  const transactions: DemoTransaction[] = [];
  const events: FinancialEvent[] = [];
  let tSeq = 0;
  let eSeq = 0;

  const pushTxn = (
    day: Day,
    accountId: string,
    amount: number,
    direction: "inflow" | "outflow",
    description: string,
    opts: { category?: string; essential?: boolean; isTransfer?: boolean; transferPairId?: string | null } = {},
  ): string => {
    const id = `nsh-t-${tSeq++}`;
    transactions.push({
      id, accountId, postedDate: day.date, amount: Math.round(amount * 100) / 100, direction,
      description, category: opts.category ?? null, essential: opts.essential ?? null,
      isTransfer: opts.isTransfer ?? false, transferPairId: opts.transferPairId ?? null,
    });
    return id;
  };

  const pushEvent = (
    day: Day, type: FinancialEvent["type"], label: string, amount: number,
    direction: FinancialEvent["direction"],
  ) => {
    events.push({ id: `nsh-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `nsh-t-${tSeq}`;
    const inId = `nsh-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? SALARY + 200 : SALARY;
    if (day.d === 1 || day.d === 15) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    if (day.d === 1) {
      checking -= HOUSING;
      pushTxn(day, CHK, HOUSING, "outflow", "Property tax & HOA", { category: "housing", essential: true });
    }
    if (day.d === 3) {
      checking -= BRK_CONTRIB;
      brokerage += BRK_CONTRIB;
      transfer(day, CHK, BRK, BRK_CONTRIB, "Brokerage contribution");
      pushEvent(day, "investment_contribution", "Investment", BRK_CONTRIB, "outflow");
    }
    if (day.d === 8) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 12) {
      checking -= INSURANCE;
      pushTxn(day, CHK, INSURANCE, "outflow", "Home & auto insurance", { category: "insurance", essential: true });
      pushEvent(day, "insurance_payment", "Insurance", INSURANCE, "outflow");
    }
    if (day.d === 16) {
      checking -= RET_CONTRIB;
      retirement += RET_CONTRIB;
      transfer(day, CHK, RET, RET_CONTRIB, "Retirement contribution");
      pushEvent(day, "investment_contribution", "Retirement", RET_CONTRIB, "outflow");
    }

    const essentials = Math.max(30, ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 40));
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    if (rand() < 0.28) {
      const amount = Math.round(60 + rand() * 190);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Dining & leisure", { category: "discretionary", essential: false });
    }
    if (rand() < 0.03) {
      const amount = Math.round(400 + rand() * 600);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Travel booking", { category: "shopping", essential: false });
      pushEvent(day, "large_purchase", "Large Purchase", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Harbor Checking", institution: "North Bay Bank", subtype: null, mask: "6120" },
    { id: MM, type: "money_market", currentBalance: Math.round(moneyMarket), includeInCalculations: true, provider: "demo", displayName: "Cash Reserve", institution: "North Bay Bank", subtype: null, mask: "6138" },
    { id: BRK, type: "brokerage", currentBalance: Math.round(brokerage), includeInCalculations: true, provider: "demo", displayName: "Brokerage", institution: "Harborview Wealth", subtype: null, mask: "2204" },
    { id: RET, type: "retirement", currentBalance: Math.round(retirement), includeInCalculations: true, provider: "demo", displayName: "Retirement 401(k)", institution: "Harborview Wealth", subtype: "401k", mask: "2212" },
  ];

  return {
    profile: northShoreProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/demo-data/north-shore.test.ts`
Expected: PASS. Same tuning rule as Task 2: if a persona-invariant assertion fails, tune constants/balances, never assertions, and report the final values.

- [ ] **Step 5: Full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demo-data/north-shore.ts src/lib/demo-data/north-shore.test.ts
git commit -m "feat(demo): North Shore Capital profile - debt-free concentrated pre-retirement persona"
```

---

### Task 4: Profile registry + generator map

**Files:**
- Create: `src/lib/demo-data/profiles.ts` (client-safe: metadata only, NO generator imports)
- Create: `src/lib/demo-data/generators.ts` (server-side map, imports all three generators)
- Test: `src/lib/demo-data/profiles.test.ts`

**Interfaces:**
- Consumes: the three generators (generators.ts only) and their signature display names: `"Everyday Checking"` (Koa), `"Reef Checking"` (Blue Reef), `"Harbor Checking"` (North Shore).
- Produces (used by Tasks 5–7):
  - `type DemoProfileId = "koa-holdings" | "blue-reef" | "north-shore"`
  - `DEMO_PROFILE_METAS: DemoProfileMeta[]` (ordered koa, blue-reef, north-shore)
  - `DEFAULT_PROFILE_ID: DemoProfileId` (= `"koa-holdings"`)
  - `isDemoProfileId(v: unknown): v is DemoProfileId`
  - `detectActiveProfile(demoAccountNames: string[]): DemoProfileId | null`
  - `DEMO_GENERATORS: Record<DemoProfileId, () => DemoDataset>` (from generators.ts)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo-data/profiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEMO_PROFILE_METAS, DEFAULT_PROFILE_ID, isDemoProfileId, detectActiveProfile,
} from "./profiles";
import { DEMO_GENERATORS } from "./generators";

describe("demo profile registry", () => {
  it("has three profiles with koa-holdings as the default", () => {
    expect(DEMO_PROFILE_METAS.map((m) => m.id)).toEqual(["koa-holdings", "blue-reef", "north-shore"]);
    expect(DEFAULT_PROFILE_ID).toBe("koa-holdings");
  });

  it("metadata is complete and signature names are mutually unique", () => {
    const signatures = DEMO_PROFILE_METAS.map((m) => m.signatureAccountName);
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const m of DEMO_PROFILE_METAS) {
      expect(m.companyName.length).toBeGreaterThan(0);
      expect(m.ticker.startsWith("$")).toBe(true);
      expect(m.username.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("every signature account name actually appears in its generator's output", () => {
    for (const m of DEMO_PROFILE_METAS) {
      const names = DEMO_GENERATORS[m.id]().accounts.map((a) => a.displayName);
      expect(names).toContain(m.signatureAccountName);
    }
  });

  it("isDemoProfileId accepts known ids and rejects everything else", () => {
    expect(isDemoProfileId("koa-holdings")).toBe(true);
    expect(isDemoProfileId("blue-reef")).toBe(true);
    expect(isDemoProfileId("north-shore")).toBe(true);
    expect(isDemoProfileId("evil")).toBe(false);
    expect(isDemoProfileId(undefined)).toBe(false);
    expect(isDemoProfileId(42)).toBe(false);
  });

  it("detectActiveProfile round-trips each profile's account names and returns null otherwise", () => {
    for (const m of DEMO_PROFILE_METAS) {
      const names = DEMO_GENERATORS[m.id]().accounts.map((a) => a.displayName);
      expect(detectActiveProfile(names)).toBe(m.id);
    }
    expect(detectActiveProfile([])).toBeNull();
    expect(detectActiveProfile(["My Checking"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/demo-data/profiles.test.ts`
Expected: FAIL — cannot resolve `./profiles`.

- [ ] **Step 3: Write `profiles.ts` and `generators.ts`**

Create `src/lib/demo-data/profiles.ts`:

```ts
/**
 * Client-safe demo-profile metadata registry. Deliberately imports NO
 * generator code so UI components can use it without pulling generators
 * into the client bundle. Generator wiring lives in ./generators.ts.
 */

export type DemoProfileId = "koa-holdings" | "blue-reef" | "north-shore";

export interface DemoProfileMeta {
  id: DemoProfileId;
  companyName: string;
  ticker: string;
  username: string;
  /** One-line persona summary for demo-data UI. Fictional; no shame language. */
  description: string;
  /** A displayName unique to this profile's seeded accounts; used for active-profile detection. */
  signatureAccountName: string;
}

export const DEMO_PROFILE_METAS: DemoProfileMeta[] = [
  {
    id: "koa-holdings",
    companyName: "Koa Holdings",
    ticker: "$KOAH",
    username: "IslandBuilder",
    description: "Mid-career household: steady paychecks, investing regularly, improving liquidity.",
    signatureAccountName: "Everyday Checking",
  },
  {
    id: "blue-reef",
    companyName: "Blue Reef Partners",
    ticker: "$BRFP",
    username: "CoralTrader",
    description: "Early-career renter: irregular income, tight margins, working on debt.",
    signatureAccountName: "Reef Checking",
  },
  {
    id: "north-shore",
    companyName: "North Shore Capital",
    ticker: "$NSHC",
    username: "WaveRider",
    description: "Pre-retirement household: debt-free, long runway, assets concentrated at one firm.",
    signatureAccountName: "Harbor Checking",
  },
];

export const DEFAULT_PROFILE_ID: DemoProfileId = "koa-holdings";

const IDS = new Set<string>(DEMO_PROFILE_METAS.map((m) => m.id));

export function isDemoProfileId(v: unknown): v is DemoProfileId {
  return typeof v === "string" && IDS.has(v);
}

/** Match seeded demo-account display names against profile signatures. */
export function detectActiveProfile(demoAccountNames: string[]): DemoProfileId | null {
  const names = new Set(demoAccountNames);
  for (const m of DEMO_PROFILE_METAS) {
    if (names.has(m.signatureAccountName)) return m.id;
  }
  return null;
}
```

Create `src/lib/demo-data/generators.ts`:

```ts
import type { DemoDataset } from "./shared";
import type { DemoProfileId } from "./profiles";
import { generateKoaHoldings } from "./koa-holdings";
import { generateBlueReef } from "./blue-reef";
import { generateNorthShore } from "./north-shore";

/** Server-side wiring: profile id → generator. Kept out of profiles.ts so client code never bundles generators. */
export const DEMO_GENERATORS: Record<DemoProfileId, () => DemoDataset> = {
  "koa-holdings": generateKoaHoldings,
  "blue-reef": generateBlueReef,
  "north-shore": generateNorthShore,
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/demo-data/profiles.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo-data/profiles.ts src/lib/demo-data/generators.ts src/lib/demo-data/profiles.test.ts
git commit -m "feat(demo): profile registry with signature-based active-profile detection"
```

---

### Task 5: Parameterized loadDemoData + { error } contract

**Files:**
- Modify: `src/app/actions/demo.ts` (full rewrite below)
- Modify: `src/app/actions/onboarding.ts:53` (error-contract handling)

**Interfaces:**
- Consumes: `DEMO_GENERATORS` (Task 4), `isDemoProfileId`/`DEFAULT_PROFILE_ID` (Task 4).
- Produces: `loadDemoData(profileId?: unknown): Promise<{ error: string }>` and `clearDemoData(): Promise<{ error: string }>` — both return `""` on success. Form usage `action={loadDemoData.bind(null, "blue-reef")}` works because React appends FormData after bound args and `isDemoProfileId` rejects non-strings.

- [ ] **Step 1: Rewrite `src/app/actions/demo.ts`**

Replace the file's two exported actions (keep the header imports style; `generateKoaHoldings` import is replaced by the generator map):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { DEMO_GENERATORS } from "@/lib/demo-data/generators";
import { DEFAULT_PROFILE_ID, isDemoProfileId } from "@/lib/demo-data/profiles";
import { demoAccountToRow, demoTransactionToRow, eventToRow, snapshotToRow } from "@/lib/data/mappers";
import { buildDailySnapshots } from "@/lib/financial-engine";
import { insertChunked } from "@/lib/data/insert-chunked";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";

export async function loadDemoData(profileId?: unknown): Promise<{ error: string }> {
  const id = isDemoProfileId(profileId) ? profileId : DEFAULT_PROFILE_ID;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    // Idempotent: clear any prior demo rows so a re-seed (or a profile
    // switch) can't violate the daily_snapshots PK or duplicate accounts.
    await clearDemoRows(supabase, user.id);

    const { accounts, transactions, events, config } = DEMO_GENERATORS[id]();

    // Accounts first (need their DB ids for transactions).
    const accountRows = accounts.map((a) => demoAccountToRow(user.id, a));
    const { data: insertedAccounts, error: accErr } = await supabase
      .from("financial_accounts").insert(accountRows).select("id, display_name");
    if (accErr) return { error: `insert accounts failed: ${accErr.message}` };

    const accountIdMap = new Map<string, string>();
    for (const a of accounts) {
      const match = (insertedAccounts ?? []).find((r) => r.display_name === a.displayName);
      if (!match) return { error: `demo seed: no inserted account matching "${a.displayName}"` };
      accountIdMap.set(a.id, match.id);
    }

    // Pre-allocate txn uuids so transfer pairs stay linked.
    const txnIdMap = new Map(transactions.map((t) => [t.id, randomUUID()]));
    await insertChunked(
      supabase, "transactions",
      transactions.map((t) => demoTransactionToRow(user.id, accountIdMap, txnIdMap, t)),
    );
    await insertChunked(supabase, "financial_events", events.map((e) => eventToRow(user.id, e)));

    const snapshots = buildDailySnapshots(accounts, transactions, config);
    await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));

    // A user may have manual accounts alongside demo data; the demo-built
    // snapshots above only cover demo accounts. Rebuilding from the DB folds
    // every active account in (identical output when only demo data exists).
    const { error: rebuildErr } = await rebuildSnapshots(supabase);
    if (rebuildErr) return { error: rebuildErr };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Loading demo data failed" };
  }

  revalidatePath("/");
  return { error: "" };
}

async function clearDemoRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  // Transactions cascade from accounts. Events are demo-only today (no source
  // column yet — see KNOWN_LIMITATIONS); snapshots are derived and rebuilt.
  const del1 = await supabase.from("financial_accounts").delete().eq("provider", "demo").eq("user_id", userId);
  if (del1.error) throw new Error(del1.error.message);
  const del2 = await supabase.from("financial_events").delete().eq("user_id", userId);
  if (del2.error) throw new Error(del2.error.message);
  const del3 = await supabase.from("daily_snapshots").delete().eq("user_id", userId);
  if (del3.error) throw new Error(del3.error.message);
}

export async function clearDemoData(): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    await clearDemoRows(supabase, user.id);
    const { error: rebuildErr } = await rebuildSnapshots(supabase);
    if (rebuildErr) return { error: rebuildErr };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Clearing demo data failed" };
  }

  revalidatePath("/");
  return { error: "" };
}
```

- [ ] **Step 2: Update onboarding to check the new contract**

In `src/app/actions/onboarding.ts`, replace `if (v.loadDemo) await loadDemoData();` with:

```ts
  if (v.loadDemo) {
    const demo = await loadDemoData();
    if (demo.error) return { error: demo.error };
  }
```

- [ ] **Step 3: Typecheck + full suite + build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all green. (`EmptyDashboard`'s `<form action={loadDemoData}>` still typechecks: a form action receiving FormData as `profileId` is rejected by `isDemoProfileId` and falls back to the default profile — behavior unchanged. Task 7 replaces that form anyway.)

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/demo.ts src/app/actions/onboarding.ts
git commit -m "feat(demo): parameterized loadDemoData with profile registry and { error } contract"
```

---

### Task 6: /accounts Demo data card

**Files:**
- Create: `src/app/accounts/DemoDataCard.tsx`
- Modify: `src/app/accounts/AccountsView.tsx` (render the card)

**Interfaces:**
- Consumes: `DEMO_PROFILE_METAS`, `detectActiveProfile` from `@/lib/demo-data/profiles` (client-safe); `loadDemoData`, `clearDemoData` actions (Task 5); `AccountSummary` (has `provider`, `displayName`, `archivedAt`).
- Produces: `<DemoDataCard accounts={accounts} />` — self-contained; derives the active profile from the accounts prop.

- [ ] **Step 1: Create `src/app/accounts/DemoDataCard.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Database } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoData, clearDemoData } from "@/app/actions/demo";
import { DEMO_PROFILE_METAS, detectActiveProfile } from "@/lib/demo-data/profiles";
import type { AccountSummary } from "@/lib/data/mappers";

export function DemoDataCard({ accounts }: { accounts: AccountSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demoNames = accounts
    .filter((a) => a.provider === "demo" && !a.archivedAt)
    .map((a) => a.displayName);
  const activeId = detectActiveProfile(demoNames);
  const hasDemo = demoNames.length > 0;

  const run = (fn: () => Promise<{ error: string }>) => {
    setError(null);
    setConfirmingClear(false);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Database size={16} aria-hidden className="text-secondary" />
        <h2 className="text-sm font-semibold text-primary">Demo data</h2>
      </div>
      <p className="text-xs text-secondary">
        {hasDemo
          ? "A fictional sample dataset is loaded alongside any accounts you add yourself. Switching replaces only the demo data — your own accounts and imports are untouched."
          : "No demo data loaded. Load a fictional sample profile to explore the app."}
      </p>
      <ul className="flex flex-col gap-2">
        {DEMO_PROFILE_METAS.map((m) => {
          const active = m.id === activeId;
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  {m.companyName} <span className="text-tertiary">{m.ticker}</span>
                  {active && (
                    <span className="flex items-center gap-0.5 rounded-full bg-neutral-muted px-1.5 py-0.5 text-[10px] text-secondary">
                      <Check size={10} aria-hidden /> Active
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-secondary">{m.description}</p>
              </div>
              {!active && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => loadDemoData(m.id))}
                  className="shrink-0 rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60"
                >
                  {hasDemo ? "Switch" : "Load"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hasDemo && (
        <div className="flex items-center gap-2">
          {confirmingClear ? (
            <>
              <span className="text-xs text-secondary">Remove all demo data? Your own accounts stay.</span>
              <button type="button" disabled={pending} onClick={() => run(clearDemoData)}
                className="rounded-lg border border-negative px-2.5 py-1 text-xs font-medium text-negative disabled:opacity-60">
                Yes, clear it
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirmingClear(false)}
                className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary disabled:opacity-60">
                Keep it
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmingClear(true)}
              className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60">
              Clear demo data
            </button>
          )}
        </div>
      )}
      {pending && <p className="text-xs text-secondary" aria-live="polite">Updating demo data…</p>}
      {error && <p className="text-xs text-negative" role="alert">{error}</p>}
    </Card>
  );
}
```

Style note: reuse existing token classes exactly as written elsewhere in `AccountsView.tsx`/`RecentImports.tsx` — if a class above doesn't exist in the design tokens (e.g. `text-negative` / `border-negative`), check how `TransactionSheet.tsx`'s delete confirm styles its destructive buttons and use those classes instead.

- [ ] **Step 2: Render it in `AccountsView.tsx`**

Import `DemoDataCard` and render it after the account groups and before (or after — match the visual rhythm of) `<RecentImports …/>`, passing the existing `accounts` prop: `<DemoDataCard accounts={accounts} />`. Keep the component order stable at both mobile and desktop widths.

- [ ] **Step 3: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 errors (1 pre-existing warning), build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/accounts/DemoDataCard.tsx src/app/accounts/AccountsView.tsx
git commit -m "feat(demo): demo-data card on /accounts - profile switcher and clear with two-step confirm"
```

---

### Task 7: EmptyDashboard profile choice

**Files:**
- Modify: `src/components/dashboard/EmptyDashboard.tsx`
- Modify: `src/components/dashboard/LoadDemoButton.tsx` (label props)

**Interfaces:**
- Consumes: `DEMO_PROFILE_METAS` (client-safe), `loadDemoData` (Task 5 — bind pattern).
- Produces: no new exports; EmptyDashboard renders one form per profile.

- [ ] **Step 1: Add label props to `LoadDemoButton.tsx`**

```tsx
"use client";

import { useFormStatus } from "react-dom";

export function LoadDemoButton({
  label = "Load demo data",
  pendingLabel = "Loading demo data…",
}: {
  label?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
```

- [ ] **Step 2: Replace the single form in `EmptyDashboard.tsx` with three profile choices**

Replace the `<form action={loadDemoData}>…</form>` block with:

```tsx
        <div className="flex w-full max-w-sm flex-col gap-2">
          {DEMO_PROFILE_METAS.map((m) => (
            <form key={m.id} action={loadDemoData.bind(null, m.id)} className="flex flex-col items-center gap-1">
              <LoadDemoButton label={`Load ${m.companyName}`} pendingLabel="Loading demo data…" />
              <p className="text-xs text-secondary">{m.description}</p>
            </form>
          ))}
        </div>
```

Add the import: `import { DEMO_PROFILE_METAS } from "@/lib/demo-data/profiles";`. Keep the existing `loadDemoData` import and the CSV-import link unchanged.

- [ ] **Step 3: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 errors (1 pre-existing warning), build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/EmptyDashboard.tsx src/components/dashboard/LoadDemoButton.tsx
git commit -m "feat(demo): three-profile choice on the dashboard empty state"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/DECISIONS.md` (append #17)
- Modify: `docs/ROADMAP.md:16` (check off the demo-profiles item)
- Modify: `docs/KNOWN_LIMITATIONS.md` (two additions)

**Interfaces:** none — documentation only. Match each file's existing formatting exactly (DECISIONS entries put Decision/Alternatives/Reasoning/Consequences on four consecutive lines with NO blank line between them).

- [ ] **Step 1: DECISIONS #17**

Append to `docs/DECISIONS.md` (blank line before the heading, then the four consecutive lines):

```markdown
## 17. 2026-07-17 — Demo profile registry with data-only switching

**Decision:** three hand-authored deterministic demo profiles (Koa Holdings unchanged; Blue Reef Partners — early-career under strain; North Shore Capital — debt-free, concentrated) behind a metadata registry (`src/lib/demo-data/profiles.ts`, client-safe) and a server-side generator map (`generators.ts`); `loadDemoData(profileId)` validates against the registry and defaults to Koa; switching replaces demo rows only (provider-scoped clear → seed → rebuild) and never touches the user's company identity or cohorts; the active profile is detected at read time by matching seeded demo-account display names against per-profile signature names — no schema change.
**Alternatives:** one parameterized generator (rejected — rewrites the tuned, test-pinned Koa generator for no user-visible gain); full persona switch overwriting `personal_companies`/`user_profiles` (rejected — destructive to the user's own onboarding identity, needs save/restore bookkeeping); onboarding-only profile choice (rejected — reviewers couldn't flip personas in one session); persisting the active profile id in a column (rejected — a schema change for derivable demo-only state).
**Reasoning:** the two new personas exist to exercise states Koa can't (below-waterline, low bands, high utilization, irregular income; debt-free rule, concentration penalty, high bands), and per-profile persona-invariant tests prove they actually do; splitting metadata from generators keeps generator code out of client bundles; signature-name detection is an accepted heuristic for demo-only state (KNOWN_LIMITATIONS).
**Consequences:** demo-data UI copy must keep the profiles clearly fictional; renaming a signature account in a generator without updating its registry meta breaks detection (guarded by a registry test); the switcher gives `clearDemoData` its first UI entry point.
```

- [ ] **Step 2: ROADMAP checkbox**

In `docs/ROADMAP.md` change:

```markdown
- ⬜ Blue Reef Partners + North Shore Capital demo profiles
```

to:

```markdown
- ✅ Blue Reef Partners + North Shore Capital demo profiles — landed 2026-07-17 with a demo-profile switcher (DECISIONS #17)
```

- [ ] **Step 3: KNOWN_LIMITATIONS additions**

Add a new section after the "CSV import v1 (2026-07-17)" section:

```markdown
## Demo profiles (2026-07-17)

- **Active-profile detection is a display-name heuristic.** The demo-data card infers which profile is loaded by matching seeded demo-account display names against each profile's registered signature name (`src/lib/demo-data/profiles.ts`). It only inspects `provider = "demo"` accounts, so user-created accounts can't collide, but renaming a generator's signature account without updating the registry breaks detection — a registry test asserts the pairing to guard drift.
- **Demo profiles are labels, not identities.** Switching profiles never changes the user's company name, ticker, or cohort fields (DECISIONS #17); the Rankings/Data screens continue to reflect the user's own onboarding cohorts regardless of which demo profile is loaded, and the demo-data UI must keep profile copy clearly fictional.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md docs/KNOWN_LIMITATIONS.md
git commit -m "docs(demo): DECISIONS #17, roadmap checkbox, demo-profile limitations"
```

---

### Task 9: Verification + phase doc

**Files:**
- Modify: `docs/CURRENT_PHASE.md`

**Interfaces:** none — verification and docs.

- [ ] **Step 1: Full check + RLS**

Run: `pnpm check`
Expected: lint 0 errors + 1 pre-existing `AccountSheet.tsx` warning; typecheck clean; all tests green (baseline 221 plus this slice's new test files); build succeeds, all 12 routes.

Run: `pnpm test:rls`
Expected: 19/19 (no schema change).

- [ ] **Step 2: Live browser QA (gstack `browse`)**

Start `pnpm dev` from this worktree on a free port (a server for the main checkout may already occupy :3000). Bootstrap auth via the documented GoTrue `verifyOtp` + hand-written `sb-<ref>-auth-token` cookie workaround (see `docs/CURRENT_PHASE.md` prior QA notes). At **390×844** and **1280×900**:

1. Fresh user, onboarding with "Load sample data" → dashboard shows Koa data (default unchanged).
2. `/accounts` → Demo data card shows Koa Holdings as Active with check-glyph + text (not color alone).
3. Switch to Blue Reef Partners → dashboard chart shows the strained persona (index near/below waterline somewhere in view); `/score` shows a low band, high utilization visible under Debt Health, no shame language; confidence capped at Moderate ("demo dataset").
4. Add a manual account with a balance → switch to North Shore Capital → manual account still present on `/accounts` (survival check); `/score` shows Debt Health 100 with "not applicable" metrics and a concentration explanation; band Strong/Excellent.
5. Clear demo data via the two-step confirm (no native dialog) → demo accounts gone, manual account remains, dashboard reflects remaining data or empty state honestly.
6. Dashboard empty state (fresh user, no data): three labeled profile buttons render; load North Shore directly from there.
7. Console: zero errors/warnings on `/`, `/accounts`, `/score` throughout, both viewports.

- [ ] **Step 3: Update `docs/CURRENT_PHASE.md`**

New "Completed (this phase — demo profiles + switcher)" section summarizing Tasks 1–8 (registry architecture, both personas with their test-pinned invariants, actions contract change, both UI surfaces, docs), previous phase section retitled, "In progress" cleared, "Next three priorities" updated (PWA manifest + Playwright smoke test moves to #1), test-status paragraph refreshed with the real post-slice numbers.

- [ ] **Step 4: Commit**

```bash
git add docs/CURRENT_PHASE.md
git commit -m "docs(demo): record demo-profiles slice completion in CURRENT_PHASE"
```
