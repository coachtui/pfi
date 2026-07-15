# Report Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Report screen — a monthly/quarterly shareholder-style financial statement computed deterministically from the user's demo data via the financial engine, with a period index chart and a deterministic management-commentary block.

**Architecture:** New pure engine module `src/lib/financial-engine/report.ts` (period enumeration, statement computation, commentary) consumed client-side by `ReportView`. A new RLS-scoped `getReportData` query adds transactions to the page payload (via a new `rowToTransactionInput` mapper). The screen is a server page + client view, matching the `/rankings` and `/data` patterns.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4 tokens, Recharts (via existing `FinancialChart`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-report-screen-design.md` (approved)

## Global Constraints

- Strict TS; `pnpm check` (lint + typecheck + test + build) green at every commit; lint zero warnings.
- No financial math or data literals in components — all calculation in `src/lib/financial-engine/report.ts`; engine/demo-data stay free of React/Next imports.
- The reconciling waterfall: operating expenses = ALL non-transfer outflows; `freeCashFlow = revenue − operatingExpenses`; `ownerCreatedEquity = savings + investments + debtReduction`; the identity `FCF === ownerCreatedEquity` holds exactly for demo data (asserted in tests).
- Market appreciation is `0`, displayed as "n/a — no market data yet".
- Commentary is deterministic template text tagged **"Calculated · AI narration in Phase 4"**, plus the educational-not-advice disclaimer; every figure traces to the statement — no fabrication.
- Share/Download is a placeholder button: `title="Coming soon"`, no `onClick`, no `cursor-pointer`.
- Default the period picker to the latest **complete** period.
- Period chart is NOT re-anchored to the window (index anchored on full history, consistent with Home).
- Mobile-first at 390px; design tokens only; reuse `Card`, `Segmented`, `FinancialChart`, and existing formatters (`formatDollars`, `formatSignedDollars`, `formatSignedPercent`).
- Auth + onboarding guards on the page identical to `/rankings`/`/data`; keep the `ComingSoon` component file (harmless if now unused).

---

### Task 1: Transaction mapper + getReportData query

**Files:**
- Modify: `src/lib/data/mappers.ts` (add `TransactionRow`, `rowToTransactionInput`)
- Modify: `src/lib/data/queries.ts` (add `getReportData`)
- Test: `src/lib/data/mappers.test.ts` (append)

**Interfaces:**
- Consumes: `TransactionInput` from `@/lib/financial-engine/snapshot-builder` — exact shape:
  `{ id: string; accountId: string; postedDate: string; amount: number; direction: "inflow"|"outflow"; category: string|null; essential: boolean|null; isTransfer: boolean; transferPairId: string|null }`.
- Produces (Tasks 3 & 5 depend on these):

```ts
// mappers.ts
export interface TransactionRow {
  id: string; account_id: string; posted_date: string; amount: number;
  direction: string; category: string | null; essential: boolean | null;
  is_transfer: boolean; transfer_pair_id: string | null;
}
export function rowToTransactionInput(row: TransactionRow): TransactionInput;

// queries.ts
export async function getReportData(supabase: SupabaseClient): Promise<{
  snapshots: DailySnapshot[]; transactions: TransactionInput[]; events: FinancialEvent[];
}>;
```

- [ ] **Step 1: Write the failing test**

Append to `src/lib/data/mappers.test.ts`:

```ts
import { rowToTransactionInput, type TransactionRow } from "./mappers";

describe("rowToTransactionInput", () => {
  it("maps a transaction row to the engine TransactionInput shape", () => {
    const row: TransactionRow = {
      id: "t1", account_id: "acc1", posted_date: "2026-06-15", amount: 3450,
      direction: "inflow", category: "income", essential: null,
      is_transfer: false, transfer_pair_id: null,
    };
    expect(rowToTransactionInput(row)).toEqual({
      id: "t1", accountId: "acc1", postedDate: "2026-06-15", amount: 3450,
      direction: "inflow", category: "income", essential: null,
      isTransfer: false, transferPairId: null,
    });
  });

  it("coerces a numeric-string amount and preserves nulls", () => {
    const row: TransactionRow = {
      id: "t2", account_id: "acc1", posted_date: "2026-06-12", amount: "500" as unknown as number,
      direction: "outflow", category: null, essential: false,
      is_transfer: true, transfer_pair_id: "t3",
    };
    const out = rowToTransactionInput(row);
    expect(out.amount).toBe(500);
    expect(out.category).toBeNull();
    expect(out.isTransfer).toBe(true);
    expect(out.transferPairId).toBe("t3");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — `rowToTransactionInput` not exported.

- [ ] **Step 3: Implement the mapper**

In `src/lib/data/mappers.ts`, add the `TransactionInput` import to the existing top import block:

```ts
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
```

and append:

```ts
export interface TransactionRow {
  id: string; account_id: string; posted_date: string; amount: number;
  direction: string; category: string | null; essential: boolean | null;
  is_transfer: boolean; transfer_pair_id: string | null;
}

export function rowToTransactionInput(row: TransactionRow): TransactionInput {
  return {
    id: row.id,
    accountId: row.account_id,
    postedDate: row.posted_date,
    amount: Number(row.amount),
    direction: row.direction as TransactionInput["direction"],
    category: row.category,
    essential: row.essential,
    isTransfer: row.is_transfer,
    transferPairId: row.transfer_pair_id,
  };
}
```

- [ ] **Step 4: Add the query**

In `src/lib/data/queries.ts`, extend the mapper import to include the new symbols:

```ts
import { rowToSnapshot, rowToEvent, rowToTransactionInput, type SnapshotRow, type EventRow, type TransactionRow } from "./mappers";
```

and add the import for the engine type at the top type-import line:

```ts
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
```

Append the query:

```ts
export async function getReportData(supabase: SupabaseClient): Promise<{
  snapshots: DailySnapshot[]; transactions: TransactionInput[]; events: FinancialEvent[];
}> {
  const [snapRes, txnRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, account_id, posted_date, amount, direction, category, essential, is_transfer, transfer_pair_id")
      .order("posted_date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (txnRes.error) throw txnRes.error;
  if (eventRes.error) throw eventRes.error;
  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    transactions: (txnRes.data as TransactionRow[]).map(rowToTransactionInput),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/lib/data && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

```bash
git add src/lib/data/mappers.ts src/lib/data/mappers.test.ts src/lib/data/queries.ts
git commit -m "feat: transaction mapper and getReportData query"
```

---

### Task 2: Period enumeration

**Files:**
- Create: `src/lib/financial-engine/report.ts`
- Test: `src/lib/financial-engine/report.test.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./report";`)

**Interfaces:**
- Consumes: `DailySnapshot`, `ISODate` from `./types`.
- Produces (Tasks 3, 5 depend on):

```ts
export type ReportGranularity = "monthly" | "quarterly";
export interface ReportPeriod { key: string; label: string; start: ISODate; end: ISODate; complete: boolean; }
export function enumeratePeriods(snapshots: DailySnapshot[], granularity: ReportGranularity): ReportPeriod[];
export function latestCompletePeriod(periods: ReportPeriod[]): ReportPeriod | null;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/financial-engine/report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enumeratePeriods, latestCompletePeriod } from "./report";
import type { DailySnapshot } from "./types";

const snap = (date: string): DailySnapshot => ({
  date, liquidAssets: 0, revolvingBalances: 0, nearTermObligations: 0,
  essentialObligations: 0, safetyBuffer: 0, netWorth: 0,
});

// Daily snapshots from 2026-05-10 through 2026-07-15.
function dailySnapshots(start: string, end: string): DailySnapshot[] {
  const out: DailySnapshot[] = [];
  for (let d = start; d <= end; ) {
    out.push(snap(d));
    const [y, m, dd] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
  }
  return out;
}

describe("enumeratePeriods — monthly", () => {
  const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "monthly");

  it("buckets each calendar month spanned by the data", () => {
    expect(periods.map((p) => p.label)).toEqual(["May 2026", "June 2026", "July 2026"]);
    expect(periods.map((p) => p.key)).toEqual(["2026-M05", "2026-M06", "2026-M07"]);
  });

  it("marks a month complete only when its full span is within the data", () => {
    // May starts 05-01 but data starts 05-10 → incomplete; July ends 07-31 but data ends 07-15 → incomplete.
    expect(periods.find((p) => p.key === "2026-M05")!.complete).toBe(false);
    expect(periods.find((p) => p.key === "2026-M06")!.complete).toBe(true);
    expect(periods.find((p) => p.key === "2026-M07")!.complete).toBe(false);
  });

  it("uses correct month bounds", () => {
    const june = periods.find((p) => p.key === "2026-M06")!;
    expect(june.start).toBe("2026-06-01");
    expect(june.end).toBe("2026-06-30");
  });
});

describe("enumeratePeriods — quarterly", () => {
  const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "quarterly");

  it("buckets each quarter spanned by the data", () => {
    expect(periods.map((p) => p.label)).toEqual(["Q2 2026", "Q3 2026"]);
    expect(periods.map((p) => [p.start, p.end])).toEqual([
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-09-30"],
    ]);
  });

  it("marks both quarters incomplete (data starts mid-Q2, ends mid-Q3)", () => {
    expect(periods.every((p) => !p.complete)).toBe(true);
  });
});

describe("latestCompletePeriod", () => {
  it("returns the last complete period", () => {
    const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "monthly");
    expect(latestCompletePeriod(periods)!.key).toBe("2026-M06");
  });

  it("falls back to the last period when none are complete", () => {
    const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "quarterly");
    expect(latestCompletePeriod(periods)!.key).toBe("2026-Q3");
  });

  it("returns null for empty input", () => {
    expect(latestCompletePeriod([])).toBeNull();
    expect(enumeratePeriods([], "monthly")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/financial-engine/report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/financial-engine/report.ts`:

```ts
import type { DailySnapshot, ISODate } from "./types";

export type ReportGranularity = "monthly" | "quarterly";

export interface ReportPeriod {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  complete: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m1: number, d: number): ISODate {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Last calendar day of month m1 (1-based) in year y. */
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

export function enumeratePeriods(
  snapshots: DailySnapshot[],
  granularity: ReportGranularity,
): ReportPeriod[] {
  if (snapshots.length === 0) return [];
  const first = snapshots[0].date;
  const last = snapshots[snapshots.length - 1].date;
  const { y: fy, m: fm } = ymd(first);
  const { y: ly, m: lm } = ymd(last);
  const periods: ReportPeriod[] = [];

  if (granularity === "monthly") {
    let y = fy;
    let m = fm;
    while (y < ly || (y === ly && m <= lm)) {
      const start = iso(y, m, 1);
      const end = iso(y, m, lastDayOfMonth(y, m));
      periods.push({
        key: `${y}-M${String(m).padStart(2, "0")}`,
        label: `${MONTHS[m - 1]} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else {
    const lastQ = Math.floor((lm - 1) / 3);
    let y = fy;
    let q = Math.floor((fm - 1) / 3);
    while (y < ly || (y === ly && q <= lastQ)) {
      const startM = q * 3 + 1;
      const endM = q * 3 + 3;
      const start = iso(y, startM, 1);
      const end = iso(y, endM, lastDayOfMonth(y, endM));
      periods.push({
        key: `${y}-Q${q + 1}`,
        label: `Q${q + 1} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      q += 1;
      if (q > 3) { q = 0; y += 1; }
    }
  }
  return periods;
}

export function latestCompletePeriod(periods: ReportPeriod[]): ReportPeriod | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].complete) return periods[i];
  }
  return periods[periods.length - 1] ?? null;
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./report";
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run src/lib/financial-engine/report.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/report.ts src/lib/financial-engine/report.test.ts src/lib/financial-engine/index.ts
git commit -m "feat: report period enumeration (monthly/quarterly)"
```

---

### Task 3: Period statement computation

**Files:**
- Modify: `src/lib/financial-engine/report.ts` (add `PeriodStatement`, `computePeriodStatement`)
- Test: `src/lib/financial-engine/report.test.ts` (append)

**Interfaces:**
- Consumes: `DailySnapshot`, `FinancialEvent`, `IndexPoint`, `ISODate` from `./types`; `TransactionInput` from `./snapshot-builder`; `ReportPeriod` from Task 2.
- Produces (Task 4, 5 depend on):

```ts
export interface PeriodStatement {
  period: ReportPeriod;
  revenue: number; operatingExpenses: number; freeCashFlow: number;
  savings: number; investments: number; debtReduction: number;
  ownerCreatedEquity: number; marketAppreciation: number;
  indexStart: number; indexEnd: number; indexChange: number;
  savingsRatePct: number;
}
export function computePeriodStatement(
  snapshots: DailySnapshot[], transactions: TransactionInput[], events: FinancialEvent[],
  indexPoints: IndexPoint[], period: ReportPeriod,
): PeriodStatement;
```

Data sourcing (verbatim): `revenue` = Σ non-transfer inflow transactions with `category === "income"` in `[start,end]`; `operatingExpenses` = Σ non-transfer outflow transactions in `[start,end]`; `investments` = Σ `investment_contribution` events in `[start,end]` (the reliable signal in the current data model — a documented refinement of the spec's "investment-contribution transactions", numerically identical); `savings` = `endSnap.liquid − prevSnap.liquid`; `debtReduction` = `prevSnap.revolving − endSnap.revolving`; where `prevSnap` = last snapshot with `date < start` (position entering the period) falling back to the first snapshot, and `endSnap` = last snapshot with `date <= end` falling back to the last snapshot. `ownerCreatedEquity = savings + investments + debtReduction`; `marketAppreciation = 0`. Index from `indexPoints` (parallel to snapshots) at `prevSnap.date`/`endSnap.date`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/financial-engine/report.test.ts`:

```ts
import { computePeriodStatement } from "./report";
import type { FinancialEvent, IndexPoint } from "./types";
import type { TransactionInput } from "./snapshot-builder";

const txn = (
  postedDate: string, amount: number, direction: "inflow" | "outflow",
  opts: Partial<TransactionInput> = {},
): TransactionInput => ({
  id: `${postedDate}-${amount}-${direction}`, accountId: "chk", postedDate, amount, direction,
  category: null, essential: null, isTransfer: false, transferPairId: null, ...opts,
});

// A tiny hand-computed June with a May-31 prev snapshot for exact deltas.
const stmtSnapshots: DailySnapshot[] = [
  { date: "2026-05-31", liquidAssets: 10000, revolvingBalances: 2000, nearTermObligations: 0, essentialObligations: 0, safetyBuffer: 0, netWorth: 100000 },
  { date: "2026-06-30", liquidAssets: 11200, revolvingBalances: 1800, nearTermObligations: 0, essentialObligations: 0, safetyBuffer: 0, netWorth: 101900 },
];
// Flows in June: income 6400 (two paychecks), spending 4500 (non-transfer outflows),
// an investment transfer 500 (isTransfer, excluded from opex), a card payment transfer 300 (excluded).
const stmtTxns: TransactionInput[] = [
  txn("2026-06-01", 3200, "inflow", { category: "income" }),
  txn("2026-06-15", 3200, "inflow", { category: "income" }),
  txn("2026-06-05", 2850, "outflow", { category: "housing", essential: true }),
  txn("2026-06-20", 1650, "outflow", { category: "discretionary" }),
  txn("2026-06-12", 500, "outflow", { isTransfer: true, transferPairId: "p1" }),
  txn("2026-06-13", 300, "outflow", { isTransfer: true, transferPairId: "p2" }),
  txn("2026-05-20", 9999, "inflow", { category: "income" }), // out of range
];
const stmtEvents: FinancialEvent[] = [
  { id: "e1", date: "2026-06-12", type: "investment_contribution", label: "Investment", amount: 500, direction: "outflow" },
  { id: "e2", date: "2026-05-12", type: "investment_contribution", label: "Investment", amount: 500, direction: "outflow" },
];
const stmtIndex: IndexPoint[] = [
  { date: "2026-05-31", actual: 110, baseline: 108, waterline: 90 },
  { date: "2026-06-30", actual: 118.4, baseline: 112, waterline: 91 },
];
const junePeriod = { key: "2026-M06", label: "June 2026", start: "2026-06-01", end: "2026-06-30", complete: true };

describe("computePeriodStatement", () => {
  const s = computePeriodStatement(stmtSnapshots, stmtTxns, stmtEvents, stmtIndex, junePeriod);

  it("sums revenue from in-range income inflows only", () => {
    expect(s.revenue).toBe(6400);
  });

  it("sums operating expenses from in-range non-transfer outflows only", () => {
    expect(s.operatingExpenses).toBe(4500); // 2850 + 1650; transfers excluded
  });

  it("computes free cash flow", () => {
    expect(s.freeCashFlow).toBe(1900);
  });

  it("reads savings and debt reduction from snapshot deltas", () => {
    expect(s.savings).toBe(1200); // 11200 - 10000
    expect(s.debtReduction).toBe(200); // 2000 - 1800
  });

  it("reads investments from in-range investment_contribution events", () => {
    expect(s.investments).toBe(500);
  });

  it("owner-created equity is savings + investments + debt reduction", () => {
    expect(s.ownerCreatedEquity).toBe(1900);
    expect(s.marketAppreciation).toBe(0);
  });

  it("reconciles: free cash flow equals owner-created equity (demo identity)", () => {
    expect(s.ownerCreatedEquity).toBeCloseTo(s.freeCashFlow, 2);
  });

  it("computes index movement over the period", () => {
    expect(s.indexStart).toBe(110);
    expect(s.indexEnd).toBe(118.4);
    expect(s.indexChange).toBeCloseTo(8.4, 2);
  });

  it("computes savings rate as a percent of revenue", () => {
    expect(s.savingsRatePct).toBeCloseTo(18.75, 2); // 1200 / 6400
  });

  it("returns zeroes without NaN for a period with no data", () => {
    const empty = computePeriodStatement(
      stmtSnapshots, [], [], stmtIndex,
      { key: "2026-M01", label: "January 2026", start: "2026-01-01", end: "2026-01-31", complete: false },
    );
    expect(empty.revenue).toBe(0);
    expect(empty.savingsRatePct).toBe(0);
    expect(Number.isNaN(empty.ownerCreatedEquity)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/financial-engine/report.test.ts`
Expected: FAIL — `computePeriodStatement` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/financial-engine/report.ts` (add the imports to the existing top import line):

```ts
import type { DailySnapshot, FinancialEvent, IndexPoint, ISODate } from "./types";
import type { TransactionInput } from "./snapshot-builder";
```

and the body:

```ts
export interface PeriodStatement {
  period: ReportPeriod;
  revenue: number;
  operatingExpenses: number;
  freeCashFlow: number;
  savings: number;
  investments: number;
  debtReduction: number;
  ownerCreatedEquity: number;
  marketAppreciation: number;
  indexStart: number;
  indexEnd: number;
  indexChange: number;
  savingsRatePct: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function inRange(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

function lastWhere<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

/**
 * Deterministic shareholder-style statement for a period. Every figure traces
 * to transactions (revenue, operating expenses), investment_contribution events
 * (investments), or snapshot/index deltas (savings, debt reduction, index).
 * The identity freeCashFlow === ownerCreatedEquity holds exactly for the demo
 * dataset (zero market drift, static mortgage/property) — see the design spec.
 */
export function computePeriodStatement(
  snapshots: DailySnapshot[],
  transactions: TransactionInput[],
  events: FinancialEvent[],
  indexPoints: IndexPoint[],
  period: ReportPeriod,
): PeriodStatement {
  const { start, end } = period;

  let revenue = 0;
  let operatingExpenses = 0;
  for (const t of transactions) {
    if (!inRange(t.postedDate, start, end)) continue;
    if (t.direction === "inflow" && !t.isTransfer && t.category === "income") revenue += t.amount;
    if (t.direction === "outflow" && !t.isTransfer) operatingExpenses += t.amount;
  }

  let investments = 0;
  for (const e of events) {
    if (inRange(e.date, start, end) && e.type === "investment_contribution") investments += e.amount;
  }

  const prevSnap = lastWhere(snapshots, (s) => s.date < start) ?? snapshots[0];
  const endSnap = lastWhere(snapshots, (s) => s.date <= end) ?? snapshots[snapshots.length - 1];
  const savings = prevSnap && endSnap ? endSnap.liquidAssets - prevSnap.liquidAssets : 0;
  const debtReduction = prevSnap && endSnap ? prevSnap.revolvingBalances - endSnap.revolvingBalances : 0;
  const ownerCreatedEquity = savings + investments + debtReduction;

  const indexByDate = new Map(indexPoints.map((p) => [p.date, p.actual]));
  const indexStart = prevSnap ? (indexByDate.get(prevSnap.date) ?? 100) : 100;
  const indexEnd = endSnap ? (indexByDate.get(endSnap.date) ?? indexStart) : indexStart;

  const freeCashFlow = revenue - operatingExpenses;
  const savingsRatePct = revenue > 0 ? round2((savings / revenue) * 100) : 0;

  return {
    period,
    revenue: round2(revenue),
    operatingExpenses: round2(operatingExpenses),
    freeCashFlow: round2(freeCashFlow),
    savings: round2(savings),
    investments: round2(investments),
    debtReduction: round2(debtReduction),
    ownerCreatedEquity: round2(ownerCreatedEquity),
    marketAppreciation: 0,
    indexStart: round2(indexStart),
    indexEnd: round2(indexEnd),
    indexChange: round2(indexEnd - indexStart),
    savingsRatePct,
  };
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run src/lib/financial-engine && pnpm typecheck && pnpm lint`
Expected: PASS (all engine tests) / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/report.ts src/lib/financial-engine/report.test.ts
git commit -m "feat: period statement computation with reconciling waterfall"
```

---

### Task 4: Management commentary

**Files:**
- Modify: `src/lib/financial-engine/report.ts` (add `buildManagementCommentary`)
- Test: `src/lib/financial-engine/report.test.ts` (append)

**Interfaces:**
- Consumes: `PeriodStatement` (Task 3); `formatDollars`, `formatSignedDollars` from `./format`.
- Produces (Task 5 depends on): `export function buildManagementCommentary(statement: PeriodStatement, companyName: string): string[];`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/financial-engine/report.test.ts`:

```ts
import { buildManagementCommentary } from "./report";

describe("buildManagementCommentary", () => {
  const lines = buildManagementCommentary(
    computePeriodStatement(stmtSnapshots, stmtTxns, stmtEvents, stmtIndex, junePeriod),
    "Koa Holdings",
  );
  const text = lines.join(" ");

  it("names the company and period", () => {
    expect(text).toContain("Koa Holdings");
    expect(text).toContain("June 2026");
  });

  it("states the actual computed figures", () => {
    expect(text).toContain("$6,400"); // revenue
    expect(text).toContain("$4,500"); // operating expenses
    expect(text).toContain("$1,900"); // free cash flow / owner equity
    expect(text).toContain("8.4"); // index movement
  });

  it("returns several sentences", () => {
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/financial-engine/report.test.ts`
Expected: FAIL — `buildManagementCommentary` not exported.

- [ ] **Step 3: Implement**

Add `formatDollars`, `formatSignedDollars` to the report module's imports (add this import line near the top of `report.ts`):

```ts
import { formatDollars, formatSignedDollars } from "./format";
```

Append:

```ts
/**
 * Deterministic shareholder-letter commentary assembled only from the
 * statement's computed figures. No fabrication; the UI tags this
 * "Calculated · AI narration in Phase 4".
 */
export function buildManagementCommentary(statement: PeriodStatement, companyName: string): string[] {
  const s = statement;
  const fcfVerb = s.freeCashFlow >= 0 ? "produced" : "posted";
  const equityVerb = s.ownerCreatedEquity >= 0 ? "building" : "reducing";
  const indexPhrase =
    s.indexChange > 0 ? `rose ${s.indexChange.toFixed(1)} points`
    : s.indexChange < 0 ? `fell ${Math.abs(s.indexChange).toFixed(1)} points`
    : "was unchanged";

  return [
    `During ${s.period.label}, ${companyName} recorded ${formatDollars(s.revenue)} of revenue against ${formatDollars(s.operatingExpenses)} of operating expenses, and ${fcfVerb} ${formatSignedDollars(s.freeCashFlow)} of free cash flow.`,
    `That surplus was allocated across ${formatDollars(s.savings)} of retained cash, ${formatDollars(s.investments)} of investment contributions, and ${formatSignedDollars(s.debtReduction)} of debt reduction — ${equityVerb} ${formatSignedDollars(s.ownerCreatedEquity)} of owner-created equity, with no market appreciation recorded this period.`,
    `The personal index ${indexPhrase} over the period, ending at ${s.indexEnd.toFixed(1)}.`,
    `The household retained ${s.savingsRatePct.toFixed(1)}% of revenue as cash this period.`,
  ];
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run src/lib/financial-engine && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/report.ts src/lib/financial-engine/report.test.ts
git commit -m "feat: deterministic management commentary from period statement"
```

---

### Task 5: Report screen (server page + client view)

**Files:**
- Create: `src/app/report/ReportView.tsx`
- Modify: `src/app/report/page.tsx` (replace the ComingSoon stub)

**Interfaces:**
- Consumes: `getReportData` (Task 1); `enumeratePeriods`, `latestCompletePeriod`, `computePeriodStatement`, `buildManagementCommentary`, `ReportGranularity`, `ReportPeriod`, `PeriodStatement` (Tasks 2–4); `buildIndexSeries`, formatters (engine); `getProfile`, `getCompany` (queries); `Card`, `Segmented`, `FinancialChart`.
- Produces: the `/report` route.

- [ ] **Step 1: Server page**

Replace `src/app/report/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getProfile, getReportData } from "@/lib/data/queries";
import { ReportView } from "./ReportView";

export default async function ReportPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  const { snapshots, transactions, events } = await getReportData(supabase);

  return (
    <ReportView
      companyName={company.name}
      ticker={company.ticker}
      snapshots={snapshots}
      transactions={transactions}
      events={events}
    />
  );
}
```

- [ ] **Step 2: Client view**

Create `src/app/report/ReportView.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Share2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { FinancialChart } from "@/components/chart/FinancialChart";
import {
  buildIndexSeries,
  buildManagementCommentary,
  computePeriodStatement,
  enumeratePeriods,
  latestCompletePeriod,
  formatDollars,
  formatSignedDollars,
  type DailySnapshot,
  type FinancialEvent,
  type ReportGranularity,
} from "@/lib/financial-engine";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";

const GRANULARITIES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
] as const;

interface ReportViewProps {
  companyName: string;
  ticker: string;
  snapshots: DailySnapshot[];
  transactions: TransactionInput[];
  events: FinancialEvent[];
}

export function ReportView({ companyName, ticker, snapshots, transactions, events }: ReportViewProps) {
  const [granularity, setGranularity] = useState<ReportGranularity>("quarterly");

  const indexPoints = useMemo(() => buildIndexSeries(snapshots).points, [snapshots]);
  const periods = useMemo(() => enumeratePeriods(snapshots, granularity), [snapshots, granularity]);
  const [periodKey, setPeriodKey] = useState<string>(() => latestCompletePeriod(periods)?.key ?? "");

  const selectedPeriod = periods.find((p) => p.key === periodKey) ?? latestCompletePeriod(periods);

  function changeGranularity(next: ReportGranularity) {
    setGranularity(next);
    const nextPeriods = enumeratePeriods(snapshots, next);
    setPeriodKey(latestCompletePeriod(nextPeriods)?.key ?? "");
  }

  if (snapshots.length === 0 || !selectedPeriod) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-primary">Report</h1>
        <Card className="p-8 text-center text-sm text-secondary">
          No financial data yet. Load demo data from the Home tab to generate a report.
        </Card>
      </div>
    );
  }

  const statement = computePeriodStatement(snapshots, transactions, events, indexPoints, selectedPeriod);
  const commentary = buildManagementCommentary(statement, companyName);
  const periodPoints = indexPoints.filter((p) => p.date >= selectedPeriod.start && p.date <= selectedPeriod.end);
  const subtitle = granularity === "quarterly" ? "Quarterly Shareholder Report" : "Monthly Report";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Report</h1>
          <p className="mt-0.5 text-sm text-secondary">{subtitle}</p>
          <p className="tabular mt-1 text-xs text-tertiary">
            {companyName} · {ticker} · {selectedPeriod.label}
          </p>
        </div>
        <span
          title="Coming soon"
          className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-tertiary"
        >
          <Share2 size={13} aria-hidden />
          Share
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={GRANULARITIES.map((g) => ({ key: g.key, label: g.label }))}
          value={granularity}
          onChange={(k) => changeGranularity(k as ReportGranularity)}
          ariaLabel="Report granularity"
        />
        <label className="sr-only" htmlFor="report-period">Period</label>
        <select
          id="report-period"
          value={selectedPeriod.key}
          onChange={(e) => setPeriodKey(e.target.value)}
          className="rounded-full border border-border-subtle bg-inset px-4 py-1.5 text-xs font-medium text-primary focus:border-border-strong focus:outline-none"
        >
          {periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {p.complete ? "" : " (partial)"}
            </option>
          ))}
        </select>
      </div>

      {periodPoints.length > 1 && (
        <Card className="p-4">
          <FinancialChart
            points={periodPoints}
            markers={[]}
            ariaDescription={`Personal index over ${selectedPeriod.label}: from ${statement.indexStart.toFixed(1)} to ${statement.indexEnd.toFixed(1)}.`}
          />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-primary">Statement · {selectedPeriod.label}</h2>
        <dl className="flex flex-col">
          <StatementRow label="Revenue" value={formatDollars(statement.revenue)} tone="positive" />
          <StatementRow label="Operating expenses" value={`− ${formatDollars(statement.operatingExpenses)}`} tone="negative" />
          <StatementRow label="Free cash flow" value={formatSignedDollars(statement.freeCashFlow)} tone={statement.freeCashFlow >= 0 ? "positive" : "negative"} emphasized />
          <p className="mt-3 mb-1 text-xs font-medium text-secondary">Allocated to</p>
          <StatementRow label="Savings (retained cash)" value={formatSignedDollars(statement.savings)} indent />
          <StatementRow label="Investments (contributions)" value={formatDollars(statement.investments)} indent />
          <StatementRow label="Debt reduction" value={formatSignedDollars(statement.debtReduction)} indent />
          <StatementRow label="Owner-created equity" value={formatSignedDollars(statement.ownerCreatedEquity)} tone={statement.ownerCreatedEquity >= 0 ? "positive" : "negative"} emphasized indent />
          <StatementRow label="Market appreciation" value="n/a — no market data yet" muted indent />
          <div className="my-2 border-t border-border-subtle" />
          <StatementRow label="Index movement" value={`${statement.indexChange >= 0 ? "+" : "−"}${Math.abs(statement.indexChange).toFixed(1)} pts`} tone={statement.indexChange >= 0 ? "positive" : "negative"} />
          <StatementRow label="Savings rate" value={`${statement.savingsRatePct.toFixed(1)}%`} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">Management commentary</h2>
          <span className="rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
            Calculated · AI narration in Phase 4
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {commentary.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-secondary">{line}</p>
          ))}
        </div>
        <p className="mt-3 text-xs text-tertiary">
          Educational analysis, not financial, tax, or investment advice.
        </p>
      </Card>
    </div>
  );
}

function StatementRow({
  label, value, tone = "neutral", emphasized = false, indent = false, muted = false,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  emphasized?: boolean;
  indent?: boolean;
  muted?: boolean;
}) {
  const valueColor =
    muted ? "text-tertiary"
    : tone === "positive" ? "text-positive"
    : tone === "negative" ? "text-negative"
    : "text-primary";
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${emphasized ? "font-semibold" : ""} ${indent ? "pl-3" : ""}`}>
      <dt className={`text-sm ${emphasized ? "text-primary" : "text-secondary"}`}>{label}</dt>
      <dd className={`tabular text-sm ${valueColor}`}>{value}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Full check**

Run: `pnpm check`
Expected: green; `/report` shown as a dynamic route (`ƒ`) in the build output.

- [ ] **Step 4: Browser verification**

The dev server runs at http://localhost:3000. Use the browse CLI: `B="$HOME/.claude/skills/gstack/browse/dist/browse"; $B viewport 390x844`. A signed-in session with seeded demo data should exist; if the browse session is logged out, re-establish it via the OTP bootstrap documented in `.superpowers/sdd/task-12-report.md` (generateLink → verifyOtp in page context).

- `$B goto http://localhost:3000/report`; screenshot, Read it. Expect: header ("Report" / "Quarterly Shareholder Report" / company·ticker·period), Monthly|Quarterly Segmented + period select, a period index chart, the statement card with the reconciling rows, and the commentary card with the "Calculated · AI narration in Phase 4" tag.
- Toggle Monthly (`$B snapshot -i` to find the segmented button, `$B click`), confirm the subtitle changes to "Monthly Report" and periods repopulate with months; switch the period select to another period and confirm numbers change.
- **Reconciliation spot-check:** read the Free cash flow and Owner-created equity rows — they must display the same dollar value.
- `$B console --errors` clean.
- Screenshot at 1280×900 too (`$B viewport 1280x900`).

Record observations in the report file.

- [ ] **Step 5: Commit**

```bash
git add src/app/report/page.tsx src/app/report/ReportView.tsx
git commit -m "feat: report screen — monthly/quarterly statement, period chart, commentary"
```

---

### Task 6: Docs + final verification

**Files:**
- Modify: `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md`, `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Update docs**

- `CURRENT_PHASE.md`: mark the Report screen complete; next-three-priorities becomes (1) manual accounts/transactions CRUD (Phase 3 — the transactions drill-down per DECISIONS #12), (2) remaining demo profiles (Blue Reef Partners, North Shore Capital) + demo-profile switcher, (3) PWA manifest + Playwright smoke test. Update test status.
- `ROADMAP.md`: check off "Report screen (mock shareholder report)" in the Phase 1 list.
- `KNOWN_LIMITATIONS.md` (Product or a new "Report slice" subsection, dated 2026-07-15): the report's `investments` line is sourced from `investment_contribution` events (the reliable signal in the current data model), a documented refinement of the spec's "investment-contribution transactions" — numerically identical for the demo; the `FCF === owner-created equity` reconciliation identity holds exactly only for demo data (zero market drift, static mortgage/property) and will need a market-appreciation term when real holdings arrive; the period index chart is not re-anchored to the window, so short periods may not start near 100; the full transactions set is sent to the client for the report (fine at demo scale, revisit for real data volumes).

- [ ] **Step 2: Final check**

Run: `pnpm check`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record report screen slice"
```
