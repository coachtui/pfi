# Recurring Transaction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect recurring transaction series deterministically from transaction history and use them to replace the snapshot builder's 28-day obligations proxy, with a minimal confirm/dismiss UI on `/accounts`.

**Architecture:** Pure-function detection in the framework-free financial engine (`src/lib/financial-engine/recurring.ts`); nothing detected is persisted — only user intent (confirm/dismiss) in a new `recurring_overrides` table. The snapshot builder splits obligation windows that extend past known history: actual transactions up to `endDate`, projected recurring occurrences beyond it, with the old 28-day shift kept as fallback when nothing is detected.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Supabase (Postgres/RLS), Vitest, Playwright, Tailwind 4, Zod, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-18-recurring-detection-design.md` — read it before starting any task.

## Global Constraints

- `src/lib/financial-engine/` stays framework-free (no React/Next imports) and deterministic — never `Date.now()`/`new Date()`; reference dates are parameters.
- All financial formulas live in the engine, never in React components.
- `pnpm check` (lint + typecheck + test + build) must be green before any completion claim; `pnpm test:rls` after schema changes; `pnpm test:e2e` after UI changes.
- Mobile-first: verify UI at ~390px before desktop. Never communicate state through color alone.
- Bounded Supabase queries only: use `paginateSelect` from `src/lib/data/paginate.ts` (PostgREST silently caps unbounded selects at 1000 rows).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Detection thresholds (from the spec, used across tasks): ≥3 occurrences; every consecutive gap inside the matched cadence bucket; amount qualification = ≥75% of amounts within ±20% of median; `variableAmount` = any amount outside ±5% of median; lapsed = last occurrence more than 1.5× interval before the reference date.

---

### Task 1: Description normalizer and series key

**Files:**
- Create: `src/lib/financial-engine/recurring.ts`
- Test: `src/lib/financial-engine/recurring.test.ts`

**Interfaces:**
- Produces: `normalizeDescription(raw: string): string`; `seriesKeyOf(accountId: string, direction: "inflow" | "outflow", normalizedDescription: string): string` (8-char lowercase hex, FNV-1a). Task 3 builds `detectRecurringSeries` on these; Task 6's server action validates keys against `/^[0-9a-f]{8}$/`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/financial-engine/recurring.test.ts
import { describe, expect, it } from "vitest";
import { normalizeDescription, seriesKeyOf } from "./recurring";

describe("normalizeDescription", () => {
  it("lowercases and strips reference numbers", () => {
    expect(normalizeDescription("NETFLIX.COM 4529")).toBe("netflix com");
    expect(normalizeDescription("NETFLIX.COM 8817")).toBe("netflix com");
  });

  it("strips date-like runs and collapses whitespace", () => {
    expect(normalizeDescription("ACME PAYROLL 2026-06-01")).toBe("acme payroll");
    expect(normalizeDescription("Rent   #204 07/01")).toBe("rent");
  });

  it("returns empty string for all-numeric descriptions", () => {
    expect(normalizeDescription("123456")).toBe("");
  });
});

describe("seriesKeyOf", () => {
  it("is stable for identical inputs", () => {
    expect(seriesKeyOf("acct-1", "outflow", "rent")).toBe(seriesKeyOf("acct-1", "outflow", "rent"));
  });

  it("is an 8-char lowercase hex string", () => {
    expect(seriesKeyOf("acct-1", "outflow", "rent")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs across account, direction, and description", () => {
    const base = seriesKeyOf("acct-1", "outflow", "rent");
    expect(seriesKeyOf("acct-2", "outflow", "rent")).not.toBe(base);
    expect(seriesKeyOf("acct-1", "inflow", "rent")).not.toBe(base);
    expect(seriesKeyOf("acct-1", "outflow", "mortgage")).not.toBe(base);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/recurring.test.ts`
Expected: FAIL — cannot resolve `./recurring`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/financial-engine/recurring.ts

/**
 * Collapse a raw bank/CSV description into a stable grouping key: lowercase,
 * digit runs (reference codes, invoice numbers, dates) removed, punctuation
 * removed, whitespace collapsed. "NETFLIX.COM 4529" and "NETFLIX.COM 8817"
 * both normalize to "netflix com".
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\d+[/\-.\d]*/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable identity for a recurring series: FNV-1a over account + direction +
 * normalized description ONLY. Cadence and amount are deliberately excluded
 * so a series that reclassifies as more data arrives keeps its key — and the
 * user's confirm/dismiss override keeps sticking to it.
 */
export function seriesKeyOf(
  accountId: string,
  direction: "inflow" | "outflow",
  normalizedDescription: string,
): string {
  const input = `${accountId}|${direction}|${normalizedDescription}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/recurring.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/recurring.ts src/lib/financial-engine/recurring.test.ts
git commit -m "feat(engine): description normalizer and stable series key for recurring detection"
```

---

### Task 2: Thread `description` through `TransactionInput`

The engine's `TransactionInput` (`src/lib/financial-engine/snapshot-builder.ts:23-34`) lacks `description`; detection needs it. The DB column is `not null`, and demo data's `DemoTransaction` already carries it, so making it required is safe. This task does the whole class in one pass (every construction site), per project convention — no piecemeal fixes.

**Files:**
- Modify: `src/lib/financial-engine/snapshot-builder.ts` (add field; export `daysBetween`, `LIQUID_TYPES`, `LIABILITY_TYPES` for Task 3)
- Modify: `src/lib/data/mappers.ts:84-102` (`TransactionRow`, `rowToTransactionInput`)
- Modify: `src/lib/data/rebuild-snapshots.ts:41` (add `description` to the select list)
- Modify: `src/lib/demo-data/shared.ts:50-52` (`DemoTransaction` becomes a plain alias)
- Modify: test fixture factories — `src/lib/financial-engine/snapshot-builder.test.ts:10`, `src/lib/financial-engine/rebuild.test.ts:6`, `src/lib/financial-engine/report.test.ts:83`, and the two `TransactionRow` literals in `src/lib/data/mappers.test.ts:58,71`

**Interfaces:**
- Produces: `TransactionInput.description: string` (required); exported `daysBetween(a: ISODate, b: ISODate): number`, `LIQUID_TYPES: ReadonlySet<AccountType>`, `LIABILITY_TYPES: ReadonlySet<AccountType>` from `snapshot-builder.ts`. (`ScoreTransactionInput` in `metric-inputs.ts` is a separate interface — untouched.)

- [ ] **Step 1: Add the field and exports**

In `src/lib/financial-engine/snapshot-builder.ts`:
- Inside `TransactionInput`, after `direction`, add: `description: string;`
- Change `const LIQUID_TYPES` → `export const LIQUID_TYPES` (line 10) and `const LIABILITY_TYPES` → `export const LIABILITY_TYPES` (line 11).
- Change `function daysBetween` → `export function daysBetween` (line 74).

- [ ] **Step 2: Run typecheck to enumerate every broken construction site**

Run: `pnpm typecheck`
Expected: FAIL with "Property 'description' is missing" errors. The complete list should match the Files section above; if typecheck surfaces additional sites, fix those too — do not leave any.

- [ ] **Step 3: Fix each site**

- `src/lib/data/mappers.ts` — add `description: string;` to `TransactionRow` and `description: row.description,` to the object returned by `rowToTransactionInput`.
- `src/lib/data/rebuild-snapshots.ts` — in the transactions `select(...)`, add `description` to the column list:
  ```ts
  .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id")
  ```
- `src/lib/demo-data/shared.ts` — replace the `DemoTransaction` interface with:
  ```ts
  export type DemoTransaction = TransactionInput;
  ```
  (It previously extended `TransactionInput` only to add `description`; the base type now has it.)
- Test factories — give each a passthrough-with-default. Example for `snapshot-builder.test.ts:10` (apply the same pattern to the others):
  ```ts
  const txn = (t: Partial<TransactionInput> & { id: string; accountId: string; postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
    description: "",
    category: null,
    essential: null,
    isTransfer: false,
    transferPairId: null,
    ...t,
  });
  ```
  (Keep each factory's existing defaults; only add `description: ""`.) In `mappers.test.ts`, add a literal `description: "Test"` to each `TransactionRow` fixture and assert it round-trips through `rowToTransactionInput`.

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, 248/248 tests (or current baseline). No behavior changed — this is plumbing only.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib
git commit -m "refactor(engine): thread transaction description through TransactionInput for recurring detection"
```

---

### Task 3: `detectRecurringSeries` and occurrence projection

**Files:**
- Modify: `src/lib/financial-engine/recurring.ts`
- Test: `src/lib/financial-engine/recurring.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription`, `seriesKeyOf` (Task 1); `addDays`, `daysBetween`, `LIQUID_TYPES`, `LIABILITY_TYPES`, `AccountInput`, `TransactionInput` from `./snapshot-builder` (Task 2).
- Produces (Task 4 and Task 6/7 depend on these exact shapes):

```ts
export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";
export type RecurringConfidence = "high" | "medium" | "low";

export interface RecurringSeries {
  seriesKey: string;
  accountId: string;
  direction: "inflow" | "outflow";
  displayName: string;        // normalized description, lowercase
  cadence: Cadence;
  intervalDays: number;       // nominal projection step for the cadence
  typicalAmount: number;      // median per-occurrence amount, rounded to cents
  variableAmount: boolean;
  essential: boolean;         // majority of underlying txns have essential === true
  isDebtPayment: boolean;     // any underlying txn is a transfer into a liability account
  isIncome: boolean;          // inflow + majority category === "income"
  occurrenceCount: number;
  firstDate: ISODate;
  lastDate: ISODate;
  nextExpectedDate: ISODate;  // lastDate + intervalDays
  lapsed: boolean;
  confidence: RecurringConfidence;
}

export interface RecurringOverride {
  seriesKey: string;
  status: "confirmed" | "dismissed";
}

export function detectRecurringSeries(accounts: AccountInput[], transactions: TransactionInput[], referenceDate: ISODate): RecurringSeries[];
export function occurrencesAfter(series: RecurringSeries, afterExclusive: ISODate, throughInclusive: ISODate): ISODate[];
export function nextOccurrenceAfter(series: RecurringSeries, date: ISODate): ISODate | null;
```

**Algorithm rules (from the spec — the implementation below encodes them):**
- Candidates: transactions on liquid accounts only; transfers excluded unless the transfer is an outflow whose pair lands in a liability account (a debt payment).
- Same-day transactions in one group merge into a single occurrence (amounts summed).
- Cadence buckets: weekly 5–9 (interval 7), biweekly 11–17 (14), semimonthly 13–18 (15, only when the occurrences hit ≤2 distinct days-of-month — checked before biweekly since the bands overlap), monthly 28–33 (30), quarterly 85–95 (91), annual 350–380 (365). Median gap picks the bucket; every gap must be inside the bucket's band.
- Confidence: ≥6 occurrences high, 4–5 medium, 3 low; demoted one level when `variableAmount`.
- Output sorted by `seriesKey` for determinism.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/financial-engine/recurring.test.ts`:

```ts
import { detectRecurringSeries, nextOccurrenceAfter, occurrencesAfter, type RecurringSeries } from "./recurring";
import type { AccountInput, TransactionInput } from "./snapshot-builder";

const CHK: AccountInput = { id: "chk", type: "checking", currentBalance: 1000, includeInCalculations: true };
const CARD: AccountInput = { id: "card", type: "credit_card", currentBalance: 500, includeInCalculations: true };

let seq = 0;
const txn = (t: Partial<TransactionInput> & { postedDate: string; amount: number }): TransactionInput => ({
  id: `t${seq++}`,
  accountId: "chk",
  direction: "outflow",
  description: "Rent",
  category: null,
  essential: null,
  isTransfer: false,
  transferPairId: null,
  ...t,
});

describe("detectRecurringSeries", () => {
  it("detects a monthly series with correct fields", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 1500, essential: true }),
      txn({ postedDate: "2026-05-01", amount: 1500, essential: true }),
      txn({ postedDate: "2026-06-01", amount: 1500, essential: true }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s).toMatchObject({
      displayName: "rent", cadence: "monthly", intervalDays: 30,
      typicalAmount: 1500, variableAmount: false, essential: true,
      isDebtPayment: false, isIncome: false, occurrenceCount: 3,
      lastDate: "2026-06-01", nextExpectedDate: "2026-07-01",
      lapsed: false, confidence: "low",
    });
  });

  it("classifies a 1st/15th payroll as semimonthly income", () => {
    const dates = ["2026-04-01", "2026-04-15", "2026-05-01", "2026-05-15", "2026-06-01", "2026-06-15"];
    const txns = dates.map((d) =>
      txn({ postedDate: d, amount: 2600, direction: "inflow", description: "Employer payroll", category: "income" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.cadence).toBe("semimonthly");
    expect(s.isIncome).toBe(true);
    expect(s.confidence).toBe("high");
  });

  it("classifies an every-14-days series as biweekly (day-of-month set exceeds 2)", () => {
    const txns = ["2026-05-01", "2026-05-15", "2026-05-29", "2026-06-12"].map((d) =>
      txn({ postedDate: d, amount: 900, description: "Gym Membership" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.cadence).toBe("biweekly");
  });

  it("flags variable amounts but still qualifies within ±20%", () => {
    const txns = [
      txn({ postedDate: "2026-04-05", amount: 110, description: "Utilities" }),
      txn({ postedDate: "2026-05-05", amount: 100, description: "Utilities" }),
      txn({ postedDate: "2026-06-05", amount: 118, description: "Utilities" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.variableAmount).toBe(true);
    expect(s.typicalAmount).toBe(110);
  });

  it("rejects a group whose amounts spread beyond tolerance", () => {
    const txns = [
      txn({ postedDate: "2026-04-05", amount: 100, description: "Shopping" }),
      txn({ postedDate: "2026-05-05", amount: 300, description: "Shopping" }),
      txn({ postedDate: "2026-06-05", amount: 700, description: "Shopping" }),
    ];
    expect(detectRecurringSeries([CHK], txns, "2026-06-20")).toHaveLength(0);
  });

  it("rejects irregular gaps and sub-3-occurrence groups", () => {
    const irregular = ["2026-04-01", "2026-04-04", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 50, description: "Coffee" }));
    expect(detectRecurringSeries([CHK], irregular, "2026-06-20")).toHaveLength(0);
    const twoOnly = ["2026-05-01", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 50, description: "Box Sub" }));
    expect(detectRecurringSeries([CHK], twoOnly, "2026-06-20")).toHaveLength(0);
  });

  it("marks a series lapsed when past 1.5x its interval", () => {
    const txns = ["2026-01-10", "2026-02-10", "2026-03-10"].map((d) =>
      txn({ postedDate: d, amount: 45, description: "Old Gym" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.lapsed).toBe(true);
  });

  it("detects debt-payment transfers and excludes other transfers", () => {
    const txns: TransactionInput[] = [];
    for (const [i, d] of ["2026-04-13", "2026-05-13", "2026-06-13"].entries()) {
      txns.push(txn({ id: `out${i}`, postedDate: d, amount: 640, description: "Credit card payment", isTransfer: true, transferPairId: `in${i}` }));
      txns.push(txn({ id: `in${i}`, postedDate: d, amount: 640, direction: "inflow", accountId: "card", description: "Credit card payment", isTransfer: true, transferPairId: `out${i}` }));
    }
    const series = detectRecurringSeries([CHK, CARD], txns, "2026-06-20");
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ isDebtPayment: true, direction: "outflow", accountId: "chk" });
  });

  it("ignores transactions on non-liquid accounts and blank descriptions", () => {
    const txns = [
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 30, accountId: "card", description: "Streaming" })),
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 30, description: "12345" })),
    ];
    expect(detectRecurringSeries([CHK, CARD], txns, "2026-06-20")).toHaveLength(0);
  });

  it("merges same-day transactions into one occurrence", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 700, description: "Rent" }),
      txn({ postedDate: "2026-04-01", amount: 800, description: "Rent" }),
      txn({ postedDate: "2026-05-01", amount: 1500, description: "Rent" }),
      txn({ postedDate: "2026-06-01", amount: 1500, description: "Rent" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s.occurrenceCount).toBe(3);
    expect(s.typicalAmount).toBe(1500);
  });

  it("keeps the same seriesKey when more data reclassifies the cadence", () => {
    const monthly = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 100, description: "Flex Plan" }));
    const [a] = detectRecurringSeries([CHK], monthly, "2026-06-15");
    const biweekly = ["2026-04-01", "2026-04-15", "2026-04-29", "2026-05-13", "2026-05-27"].map((d) =>
      txn({ postedDate: d, amount: 100, description: "Flex Plan" }));
    const [b] = detectRecurringSeries([CHK], biweekly, "2026-06-15");
    expect(a.seriesKey).toBe(b.seriesKey);
  });

  it("is deterministic and sorted by seriesKey", () => {
    const txns = [
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 1500, description: "Rent" })),
      ...["2026-04-05", "2026-05-05", "2026-06-05"].map((d) => txn({ postedDate: d, amount: 110, description: "Utilities" })),
    ];
    const a = detectRecurringSeries([CHK], txns, "2026-06-15");
    const b = detectRecurringSeries([CHK], [...txns].reverse(), "2026-06-15");
    expect(a).toEqual(b);
    expect(a.map((s) => s.seriesKey)).toEqual([...a.map((s) => s.seriesKey)].sort());
  });
});

describe("occurrence projection", () => {
  const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
    seriesKey: "abcd1234", accountId: "chk", direction: "outflow", displayName: "rent",
    cadence: "monthly", intervalDays: 30, typicalAmount: 1500, variableAmount: false,
    essential: true, isDebtPayment: false, isIncome: false, occurrenceCount: 3,
    firstDate: "2026-04-01", lastDate: "2026-06-01", nextExpectedDate: "2026-07-01",
    lapsed: false, confidence: "low", ...over,
  });

  it("lists occurrences in a range, stepping by interval", () => {
    expect(occurrencesAfter(series({}), "2026-06-30", "2026-08-15")).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("skips occurrences at or before the exclusive lower bound", () => {
    expect(occurrencesAfter(series({}), "2026-07-01", "2026-07-31")).toEqual(["2026-07-31"]);
  });

  it("finds the next occurrence after a date, rolling an overdue series forward", () => {
    expect(nextOccurrenceAfter(series({}), "2026-06-15")).toBe("2026-07-01");
    expect(nextOccurrenceAfter(series({ nextExpectedDate: "2026-05-01" }), "2026-06-15")).toBe("2026-06-30");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/recurring.test.ts`
Expected: FAIL — `detectRecurringSeries` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/financial-engine/recurring.ts` (after the Task 1 code):

```ts
import type { ISODate } from "./types";
import {
  addDays, daysBetween, LIABILITY_TYPES, LIQUID_TYPES,
  type AccountInput, type TransactionInput,
} from "./snapshot-builder";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";
export type RecurringConfidence = "high" | "medium" | "low";

export interface RecurringSeries {
  seriesKey: string;
  accountId: string;
  direction: "inflow" | "outflow";
  displayName: string;
  cadence: Cadence;
  intervalDays: number;
  typicalAmount: number;
  variableAmount: boolean;
  essential: boolean;
  isDebtPayment: boolean;
  isIncome: boolean;
  occurrenceCount: number;
  firstDate: ISODate;
  lastDate: ISODate;
  nextExpectedDate: ISODate;
  lapsed: boolean;
  confidence: RecurringConfidence;
}

export interface RecurringOverride {
  seriesKey: string;
  status: "confirmed" | "dismissed";
}

interface CadenceBucket {
  cadence: Cadence;
  min: number;
  max: number;
  intervalDays: number;
}

const BUCKETS: readonly CadenceBucket[] = [
  { cadence: "weekly", min: 5, max: 9, intervalDays: 7 },
  { cadence: "biweekly", min: 11, max: 17, intervalDays: 14 },
  { cadence: "monthly", min: 28, max: 33, intervalDays: 30 },
  { cadence: "quarterly", min: 85, max: 95, intervalDays: 91 },
  { cadence: "annual", min: 350, max: 380, intervalDays: 365 },
];
// Overlaps the biweekly band; distinguished by a ≤2-element day-of-month
// anchor set (e.g. paid on the 1st and the 15th), so it is checked first.
const SEMIMONTHLY: CadenceBucket = { cadence: "semimonthly", min: 13, max: 18, intervalDays: 15 };

const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE = 0.2;
const AMOUNT_QUALIFYING_SHARE = 0.75;
const VARIABLE_THRESHOLD = 0.05;
const LAPSED_FACTOR = 1.5;
const MAX_PROJECTION_STEPS = 400;

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyCadence(dates: ISODate[]): CadenceBucket | null {
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const m = medianOf(gaps);
  const daysOfMonth = new Set(dates.map((d) => Number(d.slice(8, 10))));
  if (
    m >= SEMIMONTHLY.min && m <= SEMIMONTHLY.max && daysOfMonth.size <= 2 &&
    gaps.every((g) => g >= SEMIMONTHLY.min && g <= SEMIMONTHLY.max)
  ) {
    return SEMIMONTHLY;
  }
  for (const b of BUCKETS) {
    if (m >= b.min && m <= b.max && gaps.every((g) => g >= b.min && g <= b.max)) return b;
  }
  return null;
}

function demote(c: RecurringConfidence): RecurringConfidence {
  return c === "high" ? "medium" : "low";
}

/**
 * Detect recurring transaction series. Pure and deterministic: same accounts,
 * transactions, and reference date always produce the same sorted output.
 * Candidates are transactions on liquid accounts; transfers are excluded
 * unless they are outflows paired into a liability account (debt payments).
 */
export function detectRecurringSeries(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  referenceDate: ISODate,
): RecurringSeries[] {
  const liquidIds = new Set(accounts.filter((a) => LIQUID_TYPES.has(a.type)).map((a) => a.id));
  const liabilityIds = new Set(accounts.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.id));
  const txnById = new Map(transactions.map((t) => [t.id, t]));

  const groups = new Map<string, { accountId: string; direction: "inflow" | "outflow"; norm: string; txns: TransactionInput[] }>();
  for (const t of transactions) {
    if (!liquidIds.has(t.accountId)) continue;
    if (t.isTransfer) {
      const pair = t.transferPairId ? txnById.get(t.transferPairId) : undefined;
      if (!(t.direction === "outflow" && pair && liabilityIds.has(pair.accountId))) continue;
    }
    const norm = normalizeDescription(t.description);
    if (norm === "") continue;
    const key = `${t.accountId}|${t.direction}|${norm}`;
    const g = groups.get(key) ?? { accountId: t.accountId, direction: t.direction, norm, txns: [] };
    g.txns.push(t);
    groups.set(key, g);
  }

  const series: RecurringSeries[] = [];
  for (const g of groups.values()) {
    // One occurrence per date; same-day transactions merge (amounts summed).
    const byDate = new Map<ISODate, number>();
    for (const t of g.txns) byDate.set(t.postedDate, (byDate.get(t.postedDate) ?? 0) + t.amount);
    const dates = [...byDate.keys()].sort();
    if (dates.length < MIN_OCCURRENCES) continue;

    const bucket = classifyCadence(dates);
    if (!bucket) continue;

    const amounts = dates.map((d) => byDate.get(d)!);
    const typical = medianOf(amounts);
    if (typical <= 0) continue;
    const within = amounts.filter((a) => Math.abs(a - typical) <= typical * AMOUNT_TOLERANCE).length;
    if (within / amounts.length < AMOUNT_QUALIFYING_SHARE) continue;
    const variableAmount = amounts.some((a) => Math.abs(a - typical) > typical * VARIABLE_THRESHOLD);

    const essentialCount = g.txns.filter((t) => t.essential === true).length;
    const incomeCount = g.txns.filter((t) => t.category === "income").length;
    const lastDate = dates[dates.length - 1];
    const base: RecurringConfidence = dates.length >= 6 ? "high" : dates.length >= 4 ? "medium" : "low";

    series.push({
      seriesKey: seriesKeyOf(g.accountId, g.direction, g.norm),
      accountId: g.accountId,
      direction: g.direction,
      displayName: g.norm,
      cadence: bucket.cadence,
      intervalDays: bucket.intervalDays,
      typicalAmount: round2(typical),
      variableAmount,
      essential: essentialCount * 2 > g.txns.length,
      isDebtPayment: g.txns.some((t) => t.isTransfer),
      isIncome: g.direction === "inflow" && incomeCount * 2 > g.txns.length,
      occurrenceCount: dates.length,
      firstDate: dates[0],
      lastDate,
      nextExpectedDate: addDays(lastDate, bucket.intervalDays),
      lapsed: daysBetween(lastDate, referenceDate) > bucket.intervalDays * LAPSED_FACTOR,
      confidence: variableAmount ? demote(base) : base,
    });
  }
  return series.sort((a, b) => (a.seriesKey < b.seriesKey ? -1 : a.seriesKey > b.seriesKey ? 1 : 0));
}

/** Projected occurrence dates in (afterExclusive, throughInclusive]. */
export function occurrencesAfter(
  series: RecurringSeries,
  afterExclusive: ISODate,
  throughInclusive: ISODate,
): ISODate[] {
  const out: ISODate[] = [];
  let d = series.nextExpectedDate;
  for (let i = 0; i < MAX_PROJECTION_STEPS && d <= throughInclusive; i++) {
    if (d > afterExclusive) out.push(d);
    d = addDays(d, series.intervalDays);
  }
  return out;
}

/** First projected occurrence strictly after `date`; overdue series roll forward. */
export function nextOccurrenceAfter(series: RecurringSeries, date: ISODate): ISODate | null {
  let d = series.nextExpectedDate;
  for (let i = 0; i < MAX_PROJECTION_STEPS; i++) {
    if (d > date) return d;
    d = addDays(d, series.intervalDays);
  }
  return null;
}
```

Move the two Task 1 functions below these imports if the linter complains about import order (imports must be first in the file).

Then export the module from the engine barrel — in `src/lib/financial-engine/index.ts` add:

```ts
export * from "./recurring";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/recurring.test.ts`
Expected: PASS. Also run `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/recurring.ts src/lib/financial-engine/recurring.test.ts src/lib/financial-engine/index.ts
git commit -m "feat(engine): deterministic recurring-series detection with cadence buckets and stable keys"
```

---

### Task 4: Snapshot-builder obligations integration

Replace the wholesale 28-day window shift with a split window: actual transactions up to `endDate`, projected recurring occurrences beyond it. The 28-day shift remains as fallback when no recurring outflow series exist.

**Files:**
- Modify: `src/lib/financial-engine/snapshot-builder.ts:78-198` (`ObligationContext`, `buildObligationContext`, `buildDailySnapshots`, `computeObligations`)
- Test: `src/lib/financial-engine/snapshot-builder.test.ts`

**Interfaces:**
- Consumes: `detectRecurringSeries`, `occurrencesAfter`, `nextOccurrenceAfter`, `RecurringSeries`, `RecurringOverride` from `./recurring` (Task 3).
- Produces: `buildDailySnapshots(accounts, transactions, config, recurringOverrides: RecurringOverride[] = [])` — the new optional 4th parameter is the only signature change; existing callers compile unchanged. Task 6's `rebuildSnapshots` passes real overrides.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/financial-engine/snapshot-builder.test.ts` (reuse the file's existing `txn`/account fixtures; the factory gained `description: ""` in Task 2 — these fixtures pass explicit descriptions):

```ts
describe("obligations with recurring projection", () => {
  const chk = account({ id: "chk", type: "checking", currentBalance: 5000 });
  const config = { startDate: "2026-05-01", endDate: "2026-06-30", safetyBuffer: 500 };
  // Monthly rent, 3 occurrences → projects 2026-07-01 at 1500.
  const rent = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d, i) =>
    txn({ id: `r${i}`, accountId: "chk", postedDate: d, amount: 1500, direction: "outflow", description: "Rent", essential: true }));
  // Semimonthly-ish monthly payroll, 3 occurrences → projects 2026-07-01.
  const payroll = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d, i) =>
    txn({ id: `p${i}`, accountId: "chk", postedDate: d, amount: 4000, direction: "inflow", description: "Employer payroll", category: "income" }));
  // One-off inside the legacy shifted window (2026-05-23..2026-06-03] but
  // outside the split window's actual span (2026-06-20..2026-06-30].
  const oneOff = txn({ id: "x1", accountId: "chk", postedDate: "2026-05-25", amount: 999, direction: "outflow", description: "Car repair" });
  const all = [...rent, ...payroll, oneOff];

  const snapshotFor = (date: string, overrides: RecurringOverride[] = []) =>
    buildDailySnapshots([chk], all, config, overrides).find((s) => s.date === date)!;

  it("projects recurring outflows into the window beyond endDate instead of shifting", () => {
    // At 2026-06-20: no actual income after that date; recurring payroll
    // projects 2026-07-01 → window (06-20, 07-01]. Actual span (06-20, 06-30]
    // holds no outflows; projection adds rent on 07-01.
    const s = snapshotFor("2026-06-20");
    expect(s.nearTermObligations).toBe(1500);
    expect(s.essentialObligations).toBe(1500);
  });

  it("falls back to the 28-day shift when every outflow series is dismissed", () => {
    const rentKey = seriesKeyOf("chk", "outflow", normalizeDescription("Rent"));
    const s = snapshotFor("2026-06-20", [{ seriesKey: rentKey, status: "dismissed" }]);
    // Legacy shifted window (2026-05-23, 2026-06-03]: rent 1500 + one-off 999.
    expect(s.nearTermObligations).toBe(2499);
    expect(s.essentialObligations).toBe(1500);
  });

  it("keeps windows fully inside known history identical to the pre-recurring behavior", () => {
    const withRecurring = buildDailySnapshots([chk], all, config);
    const dismissedAll = buildDailySnapshots([chk], all, config, [
      { seriesKey: seriesKeyOf("chk", "outflow", normalizeDescription("Rent")), status: "dismissed" },
    ]);
    // 2026-05-10's window ends at the 2026-06-01 payroll — inside history, so
    // projection never engages and overrides change nothing.
    const a = withRecurring.find((s) => s.date === "2026-05-10")!;
    const b = dismissedAll.find((s) => s.date === "2026-05-10")!;
    expect(a.nearTermObligations).toBe(b.nearTermObligations);
  });

  it("projects a confirmed lapsed series but not an unconfirmed one", () => {
    // lastDate 2026-05-02, monthly (interval 30) → nextExpectedDate 2026-06-01,
    // whose +30 step lands exactly on 2026-07-01 — the one day the projected
    // span (2026-06-30, 2026-07-01] at date "2026-06-20" covers. lapsed
    // because daysBetween(05-02, 06-20) = 49 > 45 (1.5x the 30-day interval).
    const lapsed = ["2026-03-03", "2026-04-02", "2026-05-02"].map((d, i) =>
      txn({ id: `l${i}`, accountId: "chk", postedDate: d, amount: 200, direction: "outflow", description: "Old Gym", essential: false }));
    const key = seriesKeyOf("chk", "outflow", normalizeDescription("Old Gym"));
    const base = [...rent, ...payroll, ...lapsed];
    const without = buildDailySnapshots([chk], base, config).find((s) => s.date === "2026-06-20")!;
    expect(without.nearTermObligations).toBe(1500); // lapsed series ignored by default
    const confirmed = buildDailySnapshots([chk], base, config, [{ seriesKey: key, status: "confirmed" }])
      .find((s) => s.date === "2026-06-20")!;
    // Confirming makes the lapsed series project its 07-01 occurrence too.
    expect(confirmed.nearTermObligations).toBe(1700);
    expect(confirmed.essentialObligations).toBe(1500); // Old Gym isn't essential
  });
});
```

Add the imports the new tests need at the top of the test file:

```ts
import { normalizeDescription, seriesKeyOf, type RecurringOverride } from "./recurring";
```

(If the file has no `account` helper, inline `{ id: "chk", type: "checking" as const, currentBalance: 5000, includeInCalculations: true }` — match the file's existing fixture style.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/snapshot-builder.test.ts`
Expected: FAIL — `buildDailySnapshots` doesn't accept a 4th argument / projection not implemented (the first new test gets the legacy shifted-window answer of 2499, not 1500).

- [ ] **Step 3: Implement the integration**

In `src/lib/financial-engine/snapshot-builder.ts`:

(Note: this creates a deliberate circular import — `recurring.ts` already imports helpers/types from `snapshot-builder.ts`. It is safe because each module only references the other inside function bodies, never during module initialization; do not "fix" it by duplicating `addDays`/`daysBetween`. If Vitest ever reports an undefined import from this cycle, extract the shared helpers to a new `date-utils.ts` instead.)

Add the import:

```ts
import {
  detectRecurringSeries, nextOccurrenceAfter, occurrencesAfter,
  type RecurringOverride, type RecurringSeries,
} from "./recurring";
```

Extend `ObligationContext` (line 78) with two fields:

```ts
interface ObligationContext {
  incomeDates: ISODate[];
  medianGap: number;
  liquidIds: Set<string>;
  liabilityIds: Set<string>;
  txnById: Map<string, TransactionInput>;
  projectedOutflows: RecurringSeries[];
  projectedIncome: RecurringSeries[];
}
```

In `buildDailySnapshots`, change the signature and compute the projected series after `included` is derived (replace the current `const ctx = buildObligationContext(included, transactions);` line):

```ts
export function buildDailySnapshots(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
  recurringOverrides: RecurringOverride[] = [],
): DailySnapshot[] {
```

```ts
  const overrideByKey = new Map(recurringOverrides.map((o) => [o.seriesKey, o.status]));
  // Dismissed series never project; confirmed series always do, even lapsed.
  const projected = detectRecurringSeries(included, transactions, config.endDate).filter(
    (s) =>
      overrideByKey.get(s.seriesKey) !== "dismissed" &&
      (!s.lapsed || overrideByKey.get(s.seriesKey) === "confirmed"),
  );
  const ctx = buildObligationContext(included, transactions, projected);
```

Update `buildObligationContext` to accept and store them:

```ts
function buildObligationContext(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  projected: RecurringSeries[],
): ObligationContext {
  // ...existing body unchanged, then in the returned object add:
  return {
    incomeDates,
    medianGap: median(gaps),
    liquidIds,
    liabilityIds,
    txnById: new Map(transactions.map((t) => [t.id, t])),
    projectedOutflows: projected.filter((s) => s.direction === "outflow" && !s.isIncome),
    projectedIncome: projected.filter((s) => s.isIncome),
  };
}
```

Replace `computeObligations` (lines 174-198) entirely:

```ts
function computeObligations(
  date: ISODate,
  ctx: ObligationContext,
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
): { nearTerm: number; essential: number } {
  const nextIncome = ctx.incomeDates.find((d) => d > date);
  let gap: number;
  if (nextIncome) {
    gap = daysBetween(date, nextIncome);
  } else {
    // Past the last known income: a detected recurring income series gives a
    // better next-income estimate than the historical median gap.
    const projectedNext = ctx.projectedIncome
      .map((s) => nextOccurrenceAfter(s, date))
      .filter((d): d is ISODate => d !== null)
      .sort()[0];
    gap = projectedNext ? daysBetween(date, projectedNext) : ctx.medianGap;
  }
  let windowStart = date;
  let windowEnd = addDays(date, gap);

  const beyondHistory = windowEnd > config.endDate;
  const canProject = ctx.projectedOutflows.length > 0;
  if (beyondHistory && !canProject) {
    // Legacy previous-cycle proxy, retained as fallback: with nothing
    // detected, reuse the window one cycle back. Undercounts when the true
    // income gap exceeds 28 days (KNOWN_LIMITATIONS).
    windowStart = addDays(windowStart, -PROXY_SHIFT_DAYS);
    windowEnd = addDays(windowEnd, -PROXY_SHIFT_DAYS);
  }

  let nearTerm = 0;
  let essential = 0;
  const actualEnd = windowEnd > config.endDate ? config.endDate : windowEnd;
  for (const t of transactions) {
    if (t.direction !== "outflow" || !ctx.liquidIds.has(t.accountId)) continue;
    if (!(t.postedDate > windowStart && t.postedDate <= actualEnd)) continue;
    if (t.isTransfer) {
      const pair = t.transferPairId ? ctx.txnById.get(t.transferPairId) : undefined;
      if (pair && ctx.liabilityIds.has(pair.accountId)) nearTerm += t.amount; // debt payment
      continue;
    }
    nearTerm += t.amount;
    if (t.essential === true) essential += t.amount;
  }

  if (beyondHistory && canProject) {
    // Split window: actuals covered above up to endDate; recurring series
    // project their expected occurrences into (endDate, windowEnd].
    for (const s of ctx.projectedOutflows) {
      for (const _occurrence of occurrencesAfter(s, config.endDate, windowEnd)) {
        nearTerm += s.typicalAmount;
        if (s.essential) essential += s.typicalAmount;
      }
    }
  }
  return { nearTerm, essential };
}
```

Note the one intentional behavior nuance: in the fallback path, bounding actuals by `actualEnd` is a no-op (`endDate` is always ≥ the latest transaction date by construction — `deriveRebuildConfig` derives it from the data), so legacy behavior is preserved exactly.

- [ ] **Step 4: Run the full engine test suite**

Run: `pnpm vitest run src/lib/financial-engine/`
Expected: PASS. **If a pre-existing test fails**, its fixture now legitimately contains a detectable recurring series and the expected obligations changed. Verify by hand that the new number matches the split-window rule, then update the expectation with a comment naming the projecting series. Do not weaken the fixture to dodge detection.

- [ ] **Step 5: Run the whole unit suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. `buildDailySnapshots`'s new parameter is optional, so `demo.ts` and `rebuild-snapshots.ts` compile unchanged (they get real overrides in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/snapshot-builder.ts src/lib/financial-engine/snapshot-builder.test.ts
git commit -m "feat(engine): replace 28-day obligations proxy with recurring-series projection (proxy kept as fallback)"
```

---

### Task 5: Migration 0006 + RLS tests

**Files:**
- Create: `supabase/migrations/0006_recurring_overrides.sql`
- Modify: `scripts/test-rls.mts` (new checks)

**Interfaces:**
- Produces: table `public.recurring_overrides` (`user_id`, `series_key`, `status`, timestamps; PK `(user_id, series_key)`), owner-only RLS. Task 6's actions upsert/delete rows; loaders select `series_key, status`.

**Critical detail:** `transactions.recurring_status` is being dropped, but the source-immutability trigger function (last defined in `0004_csv_import.sql:12-41`) references `new.recurring_status` — the function must be recreated *without* that line before the column drop, or every subsequent transaction update raises a runtime error.

- [ ] **Step 1: Write the migration**

```sql
-- 0006_recurring_overrides.sql
-- Recurring detection slice (docs/superpowers/specs/2026-07-18-recurring-detection-design.md).
-- Detection is recomputed from transactions on every rebuild; only user
-- intent (confirm/dismiss of a detected series) is persisted, mirroring how
-- corrections stay in transactions.user_override.

create table public.recurring_overrides (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  series_key text not null,
  status text not null check (status in ('confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, series_key)
);

alter table public.recurring_overrides enable row level security;

create policy "own_select" on public.recurring_overrides for select using (auth.uid() = user_id);
create policy "own_insert" on public.recurring_overrides for insert with check (auth.uid() = user_id);
create policy "own_update" on public.recurring_overrides for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.recurring_overrides for delete using (auth.uid() = user_id);

-- transactions.recurring_status (0001) was reserved for per-transaction
-- recurrence tagging and never read or written; series-level detection
-- supersedes it. The immutability trigger references the column, so the
-- function is recreated without it BEFORE the drop.

create or replace function public.transactions_prevent_source_update()
returns trigger
language plpgsql
as $$
begin
  if (
    new.id is distinct from old.id
    or new.account_id is distinct from old.account_id
    or new.user_id is distinct from old.user_id
    or new.posted_date is distinct from old.posted_date
    or new.authorized_date is distinct from old.authorized_date
    or new.amount is distinct from old.amount
    or new.direction is distinct from old.direction
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory
    or new.txn_type is distinct from old.txn_type
    or new.essential is distinct from old.essential
    or new.is_transfer is distinct from old.is_transfer
    or new.transfer_pair_id is distinct from old.transfer_pair_id
    or new.confidence is distinct from old.confidence
    or new.created_at is distinct from old.created_at
    or new.import_batch_id is distinct from old.import_batch_id
  ) then
    raise exception 'transactions: source columns are immutable after insert; corrections must go in user_override';
  end if;

  return new;
end;
$$;

alter table public.transactions drop column recurring_status;
```

- [ ] **Step 2: Apply to the linked Supabase project**

Run: `supabase db push`
Expected: `0006_recurring_overrides.sql` applied cleanly. (CLI 2.100.1 is installed at `/opt/homebrew/bin/supabase`; the project is already linked.)

- [ ] **Step 3: Add RLS checks**

In `scripts/test-rls.mts`, after the existing per-table checks (follow the file's `check(name, ok, detail)` pattern and its two-user `a`/`b` setup):

```ts
// recurring_overrides: owner-only in every direction.
const { error: ovInsertOwn } = await a.client.from("recurring_overrides")
  .insert({ user_id: a.id, series_key: "deadbeef", status: "dismissed" });
check("recurring_overrides: owner can insert", !ovInsertOwn, ovInsertOwn?.message ?? "");

const { data: ovCrossRead } = await b.client.from("recurring_overrides").select("series_key");
check("recurring_overrides: cross-user read returns nothing", (ovCrossRead ?? []).length === 0);

const { error: ovForge } = await b.client.from("recurring_overrides")
  .insert({ user_id: a.id, series_key: "cafef00d", status: "confirmed" });
check("recurring_overrides: cross-user insert rejected", !!ovForge);

await b.client.from("recurring_overrides")
  .update({ status: "confirmed" }).eq("user_id", a.id).eq("series_key", "deadbeef");
const { data: ovAfter } = await a.client.from("recurring_overrides")
  .select("status").eq("series_key", "deadbeef").single();
check("recurring_overrides: cross-user update is a no-op", ovAfter?.status === "dismissed");

const { error: ovDeleteOwn } = await a.client.from("recurring_overrides")
  .delete().eq("user_id", a.id).eq("series_key", "deadbeef");
check("recurring_overrides: owner can delete", !ovDeleteOwn, ovDeleteOwn?.message ?? "");
```

- [ ] **Step 4: Run the RLS suite**

Run: `pnpm test:rls`
Expected: all checks pass (19 existing + 5 new = 24). The existing "source columns are immutable" checks double as proof the recreated trigger still fires after the column drop.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_recurring_overrides.sql scripts/test-rls.mts
git commit -m "feat(db): recurring_overrides table with owner-only RLS; drop unused transactions.recurring_status"
```

---

### Task 6: Server layer — rebuild wiring, actions, query

**Files:**
- Modify: `src/lib/data/rebuild-snapshots.ts` (fetch overrides, pass to builder)
- Create: `src/app/actions/recurring.ts`
- Modify: `src/lib/data/queries.ts` (add `getRecurringData`)

**Interfaces:**
- Consumes: `RecurringOverride`, `RecurringSeries`, `detectRecurringSeries` from `@/lib/financial-engine`; `paginateSelect`; `finishWithRebuild`; `MutationResult` from `@/lib/validation/transactions`.
- Produces:
  - `setRecurringOverride(seriesKey: string, status: "confirmed" | "dismissed"): Promise<MutationResult>` and `clearRecurringOverride(seriesKey: string): Promise<MutationResult>` — Task 7's UI calls these.
  - `getRecurringData(supabase: SupabaseClient): Promise<RecurringListItem[]>` where `export interface RecurringListItem extends RecurringSeries { status: "confirmed" | "dismissed" | null }` — sorted by `nextExpectedDate` then `seriesKey`.

- [ ] **Step 1: Wire overrides into `rebuildSnapshots`**

In `src/lib/data/rebuild-snapshots.ts`:
- Import `type RecurringOverride` from `@/lib/financial-engine`.
- Add a fourth query to the existing `Promise.all`:
  ```ts
  paginateSelect<{ series_key: string; status: string }>(PAGE_SIZE, (from, to) =>
    supabase.from("recurring_overrides")
      .select("series_key, status")
      .order("series_key", { ascending: true })
      .range(from, to)),
  ```
  binding it as `overrideRows` in the destructure.
- Map and pass to the builder:
  ```ts
  const recurringOverrides: RecurringOverride[] = overrideRows.map((r) => ({
    seriesKey: r.series_key,
    status: r.status as RecurringOverride["status"],
  }));
  // ...
  const snapshots = buildDailySnapshots(accounts, transactions, config, recurringOverrides);
  ```
- Update the doc comment: source columns plus recurring overrides feed the rebuild — transaction *category* overrides still never move the index; recurring confirm/dismiss deliberately does (it curates the obligations projection). Reference DECISIONS #23.

(`src/app/actions/demo.ts:47` needs no change: a fresh demo seed has no overrides yet, and the `rebuildSnapshots` call right after it folds in any that exist.)

- [ ] **Step 2: Create the server actions**

```ts
// src/app/actions/recurring.ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import type { MutationResult } from "@/lib/validation/transactions";

const seriesKeySchema = z.string().regex(/^[0-9a-f]{8}$/);
const statusSchema = z.enum(["confirmed", "dismissed"]);

/**
 * Confirm or dismiss a detected recurring series. Snapshots must rebuild:
 * the override changes which series project into obligation windows beyond
 * known history, and those windows are persisted in daily_snapshots.
 */
export async function setRecurringOverride(seriesKey: string, status: "confirmed" | "dismissed"): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!seriesKeySchema.safeParse(seriesKey).success) return { error: "Invalid series" };
  if (!statusSchema.safeParse(status).success) return { error: "Invalid status" };

  const { error } = await supabase.from("recurring_overrides").upsert(
    { user_id: user.id, series_key: seriesKey, status, updated_at: new Date().toISOString() },
    { onConflict: "user_id,series_key" },
  );
  if (error) return { error: error.message };
  return finishWithRebuild(supabase);
}

/** Return a series to its default (detected, unreviewed) state. */
export async function clearRecurringOverride(seriesKey: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!seriesKeySchema.safeParse(seriesKey).success) return { error: "Invalid series" };

  const { error } = await supabase.from("recurring_overrides")
    .delete().eq("user_id", user.id).eq("series_key", seriesKey);
  if (error) return { error: error.message };
  return finishWithRebuild(supabase);
}
```

(`new Date().toISOString()` is fine here — this is server glue, not the engine; determinism rules bind `src/lib/financial-engine/` only.)

- [ ] **Step 3: Add the query**

In `src/lib/data/queries.ts` (imports: `detectRecurringSeries`, `type RecurringSeries`, `type AccountInput`, `type AccountType` from `@/lib/financial-engine`; reuse the file's existing `paginateSelect`, `rowToTransactionInput`, `TransactionRow` imports):

```ts
export interface RecurringListItem extends RecurringSeries {
  status: "confirmed" | "dismissed" | null;
}

/**
 * Detected recurring series with the user's confirm/dismiss status merged in.
 * Detection is recomputed here, not persisted — the reference date is derived
 * from the data (never wall-clock "today") so demo datasets with a fixed end
 * date don't spuriously read as lapsed.
 */
export async function getRecurringData(supabase: SupabaseClient): Promise<RecurringListItem[]> {
  interface RecurringAccountRow {
    id: string; type: string; current_balance: number | null;
    include_in_calculations: boolean; archived_at: string | null;
  }
  const [acctRes, txnRows, overrideRows, latestSnap] = await Promise.all([
    supabase.from("financial_accounts")
      .select("id, type, current_balance, include_in_calculations, archived_at"),
    paginateSelect<TransactionRow>(1000, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id")
        .order("id", { ascending: true })
        .range(from, to)),
    paginateSelect<{ series_key: string; status: string }>(1000, (from, to) =>
      supabase.from("recurring_overrides")
        .select("series_key, status")
        .order("series_key", { ascending: true })
        .range(from, to)),
    supabase.from("daily_snapshots")
      .select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (acctRes.error) throw acctRes.error;

  const active = (acctRes.data as RecurringAccountRow[]).filter((a) => a.archived_at === null);
  const activeIds = new Set(active.map((a) => a.id));
  const accounts: AccountInput[] = active.map((a) => ({
    id: a.id,
    type: a.type as AccountType,
    currentBalance: Number(a.current_balance ?? 0),
    includeInCalculations: a.include_in_calculations,
  }));
  const transactions = txnRows.map(rowToTransactionInput).filter((t) => activeIds.has(t.accountId));
  if (transactions.length === 0) return [];

  // Same reference the rebuild derives: the newest known date in the data.
  const maxTxnDate = transactions.reduce((m, t) => (t.postedDate > m ? t.postedDate : m), transactions[0].postedDate);
  const snapDate = (latestSnap.data as { date: string } | null)?.date;
  const referenceDate = snapDate && snapDate > maxTxnDate ? snapDate : maxTxnDate;

  const statusByKey = new Map(overrideRows.map((r) => [r.series_key, r.status as "confirmed" | "dismissed"]));
  return detectRecurringSeries(accounts, transactions, referenceDate)
    .map((s) => ({ ...s, status: statusByKey.get(s.seriesKey) ?? null }))
    .sort((a, b) =>
      a.nextExpectedDate < b.nextExpectedDate ? -1 : a.nextExpectedDate > b.nextExpectedDate ? 1
        : a.seriesKey < b.seriesKey ? -1 : 1);
}
```

- [ ] **Step 4: Typecheck, test, build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS. (No new unit tests: this is glue over the tested engine, matching the file's convention — `queries.ts` has no unit tests; correctness is covered by the e2e spec in Task 8 and live verification in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/rebuild-snapshots.ts src/app/actions/recurring.ts src/lib/data/queries.ts
git commit -m "feat(server): recurring override actions, rebuild wiring, and detection query"
```

---

### Task 7: `/accounts` Recurring section UI

**Files:**
- Create: `src/app/accounts/RecurringSection.tsx`
- Modify: `src/app/accounts/AccountsView.tsx` (accept + render the new section)
- Modify: `src/app/accounts/page.tsx` (fetch recurring data)
- Modify: `src/components/dashboard/HomeDashboard.tsx:159-165` (Obligations card links to the section)

**Interfaces:**
- Consumes: `RecurringListItem` from `@/lib/data/queries`; `setRecurringOverride`, `clearRecurringOverride` from `@/app/actions/recurring`; `formatDollars` from `@/lib/financial-engine/format`; `Card` from `@/components/ui/Card`.
- Produces: `<RecurringSection items={RecurringListItem[]} />`, rendered inside `AccountsView`; the section root carries `id="recurring"` (the dashboard links to `/accounts#recurring`).

**UI rules (binding):** confidence and lapsed state shown as text chips (never color alone); two-step inline dismiss (no native dialogs — follow the clear-demo-data pattern in `DemoDataCard.tsx`); income grouped separately from bills; dismissed items recoverable under a disclosure; empty state links to `/import`; "How is this calculated?" as a `<details>` disclosure (match `ScoreView.tsx:209`'s pattern). Match `AccountsView.tsx`'s existing idioms (`chipCls`, `actionCls`, `mutate` wrapper, `Card`).

- [ ] **Step 1: Create the component**

```tsx
// src/app/accounts/RecurringSection.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { clearRecurringOverride, setRecurringOverride } from "@/app/actions/recurring";
import { formatDollars } from "@/lib/financial-engine/format";
import type { RecurringListItem } from "@/lib/data/queries";

const chipCls = "rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary";
const actionCls = "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";

const CADENCE_LABEL: Record<RecurringListItem["cadence"], string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month",
  monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly",
};

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function formatNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Row({ item, pending, onConfirm, onDismiss, onClear }: {
  item: RecurringListItem;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <li data-testid="recurring-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-primary">{titleCase(item.displayName)}</p>
        <p className="text-xs text-tertiary">
          {CADENCE_LABEL[item.cadence]} · {item.variableAmount ? "~" : ""}{formatDollars(item.typicalAmount)}
          {item.lapsed ? " · last seen " + formatNext(item.lastDate) : " · next " + formatNext(item.nextExpectedDate)}
        </p>
      </div>
      <span className={chipCls} aria-label={`${item.confidence} confidence, based on ${item.occurrenceCount} occurrences`}>
        {item.confidence === "high" ? "◆◆◆" : item.confidence === "medium" ? "◆◆◇" : "◆◇◇"} {item.confidence}
      </span>
      {item.lapsed && <span className={chipCls}>Lapsed</span>}
      {item.isDebtPayment && <span className={chipCls}>Debt payment</span>}
      <div className="flex items-center gap-1.5">
        {item.status === "confirmed" ? (
          <>
            <span className={chipCls}>✓ Confirmed</span>
            <button type="button" className={actionCls} disabled={pending} onClick={onClear}>Undo</button>
          </>
        ) : armed ? (
          <>
            <button type="button" className={actionCls} disabled={pending}
              onClick={() => { setArmed(false); onDismiss(); }}>
              Confirm dismiss
            </button>
            <button type="button" className={actionCls} disabled={pending} onClick={() => setArmed(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className={actionCls} disabled={pending} onClick={onConfirm}>Confirm</button>
            <button type="button" className={actionCls} disabled={pending} onClick={() => setArmed(true)}>Dismiss</button>
          </>
        )}
      </div>
    </li>
  );
}

export function RecurringSection({ items }: { items: RecurringListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const mutate = (fn: () => Promise<{ error: string; warning?: string }>) => {
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setNotice(`✕ ${result.error}`);
      else if (result.warning) setNotice(`⚠ ${result.warning}`);
      router.refresh();
    });
  };

  const dismissed = items.filter((i) => i.status === "dismissed");
  const visible = items.filter((i) => i.status !== "dismissed");
  const income = visible.filter((i) => i.isIncome);
  const bills = visible.filter((i) => !i.isIncome);

  const renderRow = (i: RecurringListItem) => (
    <Row key={i.seriesKey} item={i} pending={pending}
      onConfirm={() => mutate(() => setRecurringOverride(i.seriesKey, "confirmed"))}
      onDismiss={() => mutate(() => setRecurringOverride(i.seriesKey, "dismissed"))}
      onClear={() => mutate(() => clearRecurringOverride(i.seriesKey))} />
  );

  return (
    <section id="recurring" aria-labelledby="recurring-heading">
      <Card>
        <div className="flex items-baseline justify-between">
          <h2 id="recurring-heading" className="text-base font-semibold text-primary">Recurring</h2>
          <span className="text-xs text-tertiary">{visible.length} detected</span>
        </div>
        <p className="mt-1 text-xs text-secondary">
          Repeating income and bills detected from your transaction history. Beyond your known
          history, obligations on the dashboard are projected from the items below — dismiss
          anything that shouldn&apos;t count.
        </p>

        {notice && <p role="status" className="mt-2 text-xs text-warning">{notice}</p>}

        {items.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">
            Nothing recurring detected yet. Detection needs about three occurrences of a similar
            transaction — <a href="/import" className="underline">import more history</a> to improve it.
          </p>
        ) : (
          <>
            {income.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-tertiary">Income</h3>
                <ul>{income.map(renderRow)}</ul>
              </>
            )}
            {bills.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-tertiary">Bills &amp; payments</h3>
                <ul>{bills.map(renderRow)}</ul>
              </>
            )}
          </>
        )}

        {dismissed.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-tertiary">Dismissed ({dismissed.length})</summary>
            <ul>{dismissed.map((i) => (
              <li key={i.seriesKey} data-testid="recurring-dismissed-row" className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-b-0">
                <p className="min-w-0 flex-1 truncate text-sm text-tertiary">{titleCase(i.displayName)}</p>
                <button type="button" className={actionCls} disabled={pending}
                  onClick={() => mutate(() => clearRecurringOverride(i.seriesKey))}>
                  Restore
                </button>
              </li>
            ))}</ul>
          </details>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-tertiary">How is this calculated?</summary>
          <div className="mt-2 space-y-2 text-xs text-secondary">
            <p>
              Transactions on cash accounts are grouped by cleaned-up description. A group becomes a
              recurring item when it has at least three occurrences at a steady rhythm (weekly,
              every 2 weeks, twice a month, monthly, quarterly, or yearly) and consistent amounts.
              The typical amount is the median; a ~ marks items whose amounts vary.
            </p>
            <p>
              Confidence reflects how many occurrences support the item and how steady they are —
              more history raises it. Items that stop appearing are marked Lapsed and no longer
              project forward.
            </p>
            <p>
              The dashboard&apos;s Obligations figure sums real upcoming transactions where your history
              covers the window, and projects these recurring items where it doesn&apos;t. Dismissing an
              item removes it from that projection; confirming keeps it projecting even at low
              confidence. Deterministic code computes all of this — nothing here is estimated by AI.
            </p>
          </div>
        </details>
      </Card>
    </section>
  );
}
```

- [ ] **Step 2: Wire into the page**

In `src/app/accounts/page.tsx` — add `getRecurringData` to the imports from `@/lib/data/queries`, fetch it in the `Promise.all`, and pass it through:

```tsx
const [accounts, recentImports, recurring] = await Promise.all([
  getAccountsData(supabase),
  getRecentImports(supabase),
  getRecurringData(supabase),
]);
return <AccountsView accounts={accounts} recentImports={recentImports} recurring={recurring} />;
```

In `src/app/accounts/AccountsView.tsx` — extend the props:

```tsx
import { RecurringSection } from "./RecurringSection";
import type { RecurringListItem } from "@/lib/data/queries";

export function AccountsView({
  accounts, recentImports, recurring,
}: {
  accounts: AccountSummary[];
  recentImports: RecentImport[];
  recurring: RecurringListItem[];
}) {
```

and render `<RecurringSection items={recurring} />` immediately after the `<RecentImports … />` element (same list position, before the demo-data card).

- [ ] **Step 3: Link the dashboard Obligations card**

In `src/components/dashboard/HomeDashboard.tsx`, the Obligations `MetricCard` (line ~159) gains an `href` so "how is this number built?" is one tap from where it appears:

```tsx
<MetricCard
  label="Obligations"
  value={formatDollars(latest.nearTermObligations)}
  tone="neutral"
  trend={trendOf((s) => -s.nearTermObligations)}
  trendDescription="Near-term obligations over the last 14 days"
  href="/accounts#recurring"
/>
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: PASS (the pre-existing `AccountSheet.tsx` lint warning is the only warning).

Then visually verify per CLAUDE.md — dev server (`pnpm dev`), signed-in user with Koa demo data, `http://localhost:3000/accounts` at **390×844 first**, then 1280×900:
- Recurring section lists Employer Payroll under Income; Mortgage Payment, Utilities, Auto Insurance, Credit Card Payment (Debt payment chip) under Bills & payments.
- Confidence chips render as text + diamonds (readable without color).
- Dismiss is two-step; a dismissed row moves under "Dismissed (n)"; Restore brings it back.
- Dashboard Obligations card navigates to `/accounts#recurring`.

- [ ] **Step 5: Commit**

```bash
git add src/app/accounts src/components/dashboard/HomeDashboard.tsx
git commit -m "feat(ui): recurring section on /accounts with confirm/dismiss; obligations card links to it"
```

---

### Task 8: E2e coverage

**Files:**
- Modify: `e2e/smoke.spec.ts`

Playwright runs with `workers: 1` and this file's tests share one page in order — the new tests go **after** "accounts screen shows the demo data card with Koa active" and **before** "sign out returns to login". (A separate spec file would sort alphabetically before `smoke.spec.ts` and run against a not-yet-onboarded user.)

- [ ] **Step 1: Add the tests**

```ts
test("recurring section lists series detected from Koa demo data", async () => {
  await page.goto("/accounts");
  const section = page.locator("#recurring");
  await expect(section.getByRole("heading", { name: "Recurring" })).toBeVisible();
  await expect(section.getByText(/employer payroll/i)).toBeVisible();
  await expect(section.getByText(/mortgage payment/i)).toBeVisible();
});

test("dismissing a recurring series moves it under Dismissed and restore undoes it", async () => {
  await page.goto("/accounts");
  const section = page.locator("#recurring");
  const row = section.getByTestId("recurring-row").filter({ hasText: /auto insurance/i });
  await row.getByRole("button", { name: "Dismiss", exact: true }).click();
  await row.getByRole("button", { name: "Confirm dismiss" }).click();
  // The override triggers a snapshot rebuild before the refresh lands.
  await expect(section.getByText("Dismissed (1)")).toBeVisible({ timeout: 30_000 });
  await section.getByText("Dismissed (1)").click();
  await section.getByTestId("recurring-dismissed-row").getByRole("button", { name: "Restore" }).click();
  await expect(section.getByText(/^Dismissed \(/)).toBeHidden({ timeout: 30_000 });
});
```

- [ ] **Step 2: Run the e2e suite twice**

Run: `pnpm test:e2e && pnpm test:e2e`
Expected: 9/9 both runs (7 existing + 2 new). Each run seeds its own throwaway user, so back-to-back runs prove the tests don't depend on leftover state.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(e2e): recurring section detection and dismiss/restore round-trip"
```

---

### Task 9: Documentation + final verification

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/ROADMAP.md`, `docs/CURRENT_PHASE.md`

- [ ] **Step 1: DECISIONS.md — append entry #23**

```markdown
## 23. Recurring detection: pure-function engine + override-only persistence (2026-07-18)

**Decision:** recurring transaction series are detected by a pure, deterministic engine function (`src/lib/financial-engine/recurring.ts`) recomputed from transactions on every snapshot rebuild — nothing detected is persisted. Only user intent is stored (`recurring_overrides`: confirm/dismiss keyed by a stable series hash of account + direction + normalized description, deliberately excluding cadence/amount so overrides survive reclassification). The snapshot builder's obligation windows now split at the edge of known history: actual transactions up to `endDate`, projected occurrences of active non-dismissed series beyond it; the 28-day previous-cycle shift survives only as a fallback when nothing is detected. Recurring confirm/dismiss deliberately moves the index (it curates the obligations projection) — unlike transaction category overrides, which still never do (DECISIONS #13). The unused `transactions.recurring_status` column (0001) was dropped in migration 0006, which also recreated the source-immutability trigger without it.

**Alternatives:** a persisted `recurring_items` table refreshed on import/mutation (stable IDs, but a second source of truth with a staleness pipeline — the same sync class the snapshot rebuild already manages); hybrid persistence of confirmed items only (one concept in two representations); per-transaction `recurring_status` tagging (the 0001 column's original intent).

**Reasoning:** matches "deterministic code calculates"; recompute-on-rebuild is cheap at household volume; the override pattern mirrors `user_override`; detection improves as data arrives with no migration.

**Consequences:** series keys must stay stable across normalizer changes (a normalizer change orphans existing overrides — treat as a versioned methodology change); detection runs on every rebuild and dashboard/accounts load; v1 limits recorded in KNOWN_LIMITATIONS.
```

- [ ] **Step 2: KNOWN_LIMITATIONS.md — update the obligations bullet**

Replace the "Obligations v1 uses actual forward transactions…" bullet with:

```markdown
- **Obligations beyond known history are projected from detected recurring series** (spec: docs/superpowers/specs/2026-07-18-recurring-detection-design.md); the old 28-day previous-cycle proxy survives only as a fallback when no recurring outflows are detected (sparse/new accounts), where it can still undercount when the actual income gap exceeds 28 days. Detection v1 limits: no fuzzy merchant matching across accounts or description drift beyond the normalizer; fixed cadence buckets (a true 6-week cycle won't classify); no user-created manual recurring items; semimonthly projection steps a nominal 15 days rather than tracking day-of-month anchors, so it can drift across long projection windows (windows are one income gap, so drift is bounded in practice).
```

- [ ] **Step 3: ROADMAP.md — Phase 3 line**

In the Phase 3 section, replace "Remaining scope: recurring detection (replacing the obligations proxy — see KNOWN_LIMITATIONS)" with "Recurring detection landed 2026-07-18 (DECISIONS.md #23), replacing the obligations proxy with recurring-series projection (28-day shift retained as fallback) — Phase 3 complete." Keep the out-of-scope list.

- [ ] **Step 4: CURRENT_PHASE.md — update**

Update the header/phase line to record: recurring detection complete (Phase 3 now fully complete), what landed (engine module, obligations split-window, migration 0006, `/accounts` Recurring section, 2 new e2e specs), and shift "Next three priorities" to: (1) Phase 4 kickoff (AI financial interpreter) — now unblocked as the sole top item; (2) verify production magic-link email flow; (3) wire e2e into CI. Record the new test counts from Step 5 in "Test status".

- [ ] **Step 5: Final verification**

Run: `pnpm check && pnpm test:rls && pnpm test:e2e`
Expected: all green. Record exact counts in CURRENT_PHASE.md. Re-run the Task 7 browser pass if any UI file changed since it ran.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: record recurring-detection slice (DECISIONS #23); Phase 3 complete"
```

---

## Plan Self-Review Notes

- **Spec coverage:** detection module (Tasks 1–3), obligations integration incl. fallback + overrides (Task 4), persistence/actions/RLS (Tasks 5–6), UI incl. explainability + dashboard link (Task 7), e2e + live verification (Tasks 8, 7.4, 9.5), docs (Task 9). The spec's "income series improve window length" is implemented in Task 4's `computeObligations` and covered by the first new snapshot test (the window at 06-20 ends at the projected 07-01 payroll).
- **Known judgment call encoded:** confirmed-but-lapsed series project (spec says "confirmed always projects"); Task 4 implements and tests exactly that.
- **Type consistency:** `RecurringSeries`/`RecurringOverride` shapes in Tasks 3, 4, 6, 7 match; `MutationResult` reused from `@/lib/validation/transactions` as existing actions do.
