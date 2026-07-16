# Transactions Drill-Down & Accounts Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first non-demo data path: a `/transactions` drill-down (filterable list, manual add/delete, recategorize via `user_override`) and an `/accounts` management screen (add/edit/include-toggle/archive), wired from the Home dashboard, with snapshots rebuilt on every balance-affecting write.

**Architecture:** Two flat drill-down routes under the existing four-tab nav. Pure engine additions (`overrides.ts`, `rebuild.ts`) keep all correction/config logic framework-free and tested; thin RLS-bound queries and server actions do I/O; snapshot rebuild reuses the existing `buildDailySnapshots` backward replay. Spec: `docs/superpowers/specs/2026-07-16-transactions-accounts-crud-design.md`.

**Tech Stack:** Next.js 16 App Router (async `searchParams`), strict TypeScript, Tailwind 4 tokens, Zod v4 (`z.uuid()`, not `z.string().uuid()`), react-hook-form + `@hookform/resolvers/zod`, Supabase JS (RLS-bound server client), Vitest.

## Global Constraints

- `pnpm check` (lint + typecheck + test + build) must be green before the slice is complete; verify UI at ~390px before desktop.
- No financial formula in React components — calculations live in `src/lib/financial-engine/` (framework-free: no React/Next imports there or in `src/lib/demo-data`).
- Bottom nav stays exactly four tabs (Home/Rankings/Data/Report); new routes are drill-downs with a back affordance and no active tab.
- Never communicate positive/negative through color alone — pair with sign, shape, or text.
- Every new screen handles loading, empty, error, and partial states.
- The `transactions_immutable_source` trigger (migration 0002) is **not** modified. Frozen columns: everything except `user_override` and `notes`.
- **Invariant:** overrides never change balances or the index. Snapshot rebuild reads **source** columns only; `applyOverride` is a display/report-layer correction.
- Server action files (`"use server"`) may export **only async functions** (type-only exports are fine; no consts).
- Existing conventions: actions return `{ error: string }` with `""` on success; queries take `supabase: SupabaseClient` as first arg and live behind `import "server-only"`; row mappers coerce numerics with `Number()`; form inputs use `inputCls`/`labelCls` pattern from `src/app/onboarding/OnboardingForm.tsx`.
- Commit after every task with a conventional message.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0003_manual_data.sql` (create) | `financial_accounts.archived_at` column |
| `src/lib/financial-engine/overrides.ts` (create) | `parseOverride`, `applyOverride`, `CorrectableTransaction`, `EffectiveTransaction` |
| `src/lib/financial-engine/rebuild.ts` (create) | `deriveRebuildConfig`, `DEFAULT_SAFETY_BUFFER` (pure) |
| `src/lib/config/categories.ts` (create) | `CATEGORIES`, `Category`, `CATEGORY_LABELS` |
| `src/lib/validation/transactions.ts` (create) | Zod schemas, `TransactionFilters`, `parseTransactionFilters`, `MutationResult`, `ACCOUNT_TYPES` |
| `src/lib/data/mappers.ts` (modify) | `TransactionListRow→TransactionListItem`, `AccountRow→AccountSummary` |
| `src/lib/data/queries.ts` (modify) | `getTransactionsData`, `getAccountsData`, stale flag in `getDashboardData`, effective categories in `getReportData` |
| `src/lib/data/insert-chunked.ts` (create) | shared `insertChunked` (extracted from `demo.ts`) |
| `src/lib/data/rebuild-snapshots.ts` (create) | `rebuildSnapshots(supabase)` — fetch → derive config → build → replace rows |
| `src/app/actions/transactions.ts` (create) | `createTransaction`, `deleteTransaction`, `overrideTransaction` |
| `src/app/actions/accounts.ts` (create) | `createAccount`, `updateAccount`, `setAccountIncluded`, `setAccountArchived` |
| `src/app/actions/demo.ts` (modify) | seed/clear finish with `rebuildSnapshots` so manual accounts survive demo reseeds |
| `src/components/ui/Sheet.tsx` (create) | bottom-sheet (mobile) / centered dialog (desktop) primitive |
| `src/app/transactions/{page,loading,error}.tsx`, `TransactionsView.tsx`, `TransactionSheet.tsx` (create) | list screen + add/detail sheet |
| `src/app/accounts/{page,loading,error}.tsx`, `AccountsView.tsx`, `AccountSheet.tsx` (create) | accounts screen + add/edit sheet |
| `src/components/dashboard/MetricCard.tsx`, `WhatMovedYourLine.tsx`, `HomeDashboard.tsx`, `src/app/page.tsx` (modify) | drill-down links, stale-index notice, self-heal rebuild |
| `scripts/test-rls.mts` (modify) | mutation-path isolation checks |
| Tests | `overrides.test.ts`, `rebuild.test.ts` (create); `mappers.test.ts` (extend); validation `transactions.test.ts` (create) |

---

### Task 1: Migration `0003_manual_data` — `archived_at`

**Files:**
- Create: `supabase/migrations/0003_manual_data.sql`

**Interfaces:**
- Produces: `financial_accounts.archived_at timestamptz` (null = active). Inherits existing owner-only RLS; no policy changes needed.

- [ ] **Step 1: Write the migration**

```sql
-- Manual-data slice: accounts are archived, never deleted, so their
-- transaction history keeps informing snapshots built before the archive date
-- stays queryable. Archived accounts are excluded from calculations and
-- pickers at the application layer.
alter table public.financial_accounts
  add column archived_at timestamptz;
```

- [ ] **Step 2: Push and verify**

Run: `supabase db push`
Expected: `0003_manual_data.sql` applied without error.
Run: `supabase migration list`
Expected: `0003_manual_data` shows in both local and remote columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_manual_data.sql
git commit -m "feat: add financial_accounts.archived_at for archive-not-delete"
```

---

### Task 2: Engine — `overrides.ts` (parse + apply)

**Files:**
- Create: `src/lib/financial-engine/overrides.ts`
- Test: `src/lib/financial-engine/overrides.test.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./overrides";`)

**Interfaces:**
- Consumes: `ISODate` from `./types`.
- Produces:
  - `interface TransactionOverride { category?: string; description?: string }`
  - `parseOverride(raw: unknown): TransactionOverride | null` — defensive parse of the `user_override` jsonb; ignores unknown/hostile keys.
  - `interface CorrectableTransaction { id: string; accountId: string; postedDate: ISODate; amount: number; direction: "inflow" | "outflow"; description: string; category: string | null; essential: boolean | null; isTransfer: boolean; transferPairId: string | null; userOverride: TransactionOverride | null }`
  - `interface EffectiveTransaction extends Omit<CorrectableTransaction, "userOverride"> { corrected: boolean; original: { category: string | null; description: string } | null }`
  - `applyOverride(t: CorrectableTransaction): EffectiveTransaction`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/financial-engine/overrides.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyOverride, parseOverride, type CorrectableTransaction } from "./overrides";

const base: CorrectableTransaction = {
  id: "t1", accountId: "a1", postedDate: "2026-06-01", amount: 120,
  direction: "outflow", description: "Card purchases", category: "discretionary",
  essential: false, isTransfer: false, transferPairId: null, userOverride: null,
};

describe("parseOverride", () => {
  it("returns null for null, arrays, and non-objects", () => {
    expect(parseOverride(null)).toBeNull();
    expect(parseOverride([])).toBeNull();
    expect(parseOverride("x")).toBeNull();
    expect(parseOverride(42)).toBeNull();
  });

  it("keeps only string category/description keys", () => {
    expect(parseOverride({ category: "groceries", description: "Farmers market" }))
      .toEqual({ category: "groceries", description: "Farmers market" });
    expect(parseOverride({ category: 7, description: null })).toBeNull();
  });

  it("ignores hostile keys that would change balances", () => {
    const parsed = parseOverride({ amount: 9999, postedDate: "2020-01-01", direction: "inflow", category: "groceries" });
    expect(parsed).toEqual({ category: "groceries" });
  });

  it("returns null for an empty object", () => {
    expect(parseOverride({})).toBeNull();
  });
});

describe("applyOverride", () => {
  it("passes through untouched when there is no override", () => {
    const eff = applyOverride(base);
    expect(eff.category).toBe("discretionary");
    expect(eff.description).toBe("Card purchases");
    expect(eff.corrected).toBe(false);
    expect(eff.original).toBeNull();
  });

  it("applies a category override and preserves the original", () => {
    const eff = applyOverride({ ...base, userOverride: { category: "groceries" } });
    expect(eff.category).toBe("groceries");
    expect(eff.description).toBe("Card purchases");
    expect(eff.corrected).toBe(true);
    expect(eff.original).toEqual({ category: "discretionary", description: "Card purchases" });
  });

  it("applies a description override", () => {
    const eff = applyOverride({ ...base, userOverride: { description: "Costco run" } });
    expect(eff.description).toBe("Costco run");
    expect(eff.category).toBe("discretionary");
    expect(eff.corrected).toBe(true);
  });

  it("never changes amount, date, direction, or transfer fields", () => {
    const eff = applyOverride({ ...base, userOverride: { category: "income", description: "x" } });
    expect(eff.amount).toBe(base.amount);
    expect(eff.postedDate).toBe(base.postedDate);
    expect(eff.direction).toBe(base.direction);
    expect(eff.isTransfer).toBe(base.isTransfer);
    expect(eff.transferPairId).toBe(base.transferPairId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/overrides.test.ts`
Expected: FAIL — cannot resolve `./overrides`.

- [ ] **Step 3: Implement**

Create `src/lib/financial-engine/overrides.ts`:

```ts
import type { ISODate } from "./types";

/**
 * User corrections to a transaction. Stored in the `user_override` jsonb
 * column (migration 0002 freezes every source column except `user_override`
 * and `notes`). Overrides are a display/report-layer correction: snapshot
 * building intentionally reads source columns only, so an override can never
 * change balances or the index (v1 — see KNOWN_LIMITATIONS for the
 * income-recategorization consequence).
 */
export interface TransactionOverride {
  category?: string;
  description?: string;
}

/** Defensive parse of the raw jsonb — only known string keys survive. */
export function parseOverride(raw: unknown): TransactionOverride | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: TransactionOverride = {};
  if (typeof o.category === "string") out.category = o.category;
  if (typeof o.description === "string") out.description = o.description;
  return Object.keys(out).length > 0 ? out : null;
}

export interface CorrectableTransaction {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  category: string | null;
  essential: boolean | null;
  isTransfer: boolean;
  transferPairId: string | null;
  userOverride: TransactionOverride | null;
}

export interface EffectiveTransaction extends Omit<CorrectableTransaction, "userOverride"> {
  corrected: boolean;
  /** Source values that were overridden, for "original" display. Null when uncorrected. */
  original: { category: string | null; description: string } | null;
}

export function applyOverride(t: CorrectableTransaction): EffectiveTransaction {
  const { userOverride, ...source } = t;
  if (!userOverride) return { ...source, corrected: false, original: null };
  return {
    ...source,
    category: userOverride.category ?? source.category,
    description: userOverride.description ?? source.description,
    corrected: true,
    original: { category: source.category, description: source.description },
  };
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./overrides";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/overrides.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/overrides.ts src/lib/financial-engine/overrides.test.ts src/lib/financial-engine/index.ts
git commit -m "feat: engine override parsing/merging for transaction corrections"
```

---

### Task 3: Engine — `rebuild.ts` (`deriveRebuildConfig`)

**Files:**
- Create: `src/lib/financial-engine/rebuild.ts`
- Test: `src/lib/financial-engine/rebuild.test.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./rebuild";`)

**Interfaces:**
- Consumes: `SnapshotBuilderConfig`, `TransactionInput`, `buildDailySnapshots` from `./snapshot-builder`; `ISODate` from `./types`; `generateKoaHoldings` from `@/lib/demo-data/koa-holdings` (test only).
- Produces:
  - `const DEFAULT_SAFETY_BUFFER = 2500`
  - `interface PriorSnapshotMeta { date: ISODate; safetyBuffer: number }`
  - `deriveRebuildConfig(prior: PriorSnapshotMeta[], transactions: TransactionInput[]): SnapshotBuilderConfig | null` — window spans min→max of all prior-snapshot and transaction dates; `safetyBuffer` from the latest prior snapshot, else the default; `null` when there is nothing to build from.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/financial-engine/rebuild.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_BUFFER, deriveRebuildConfig } from "./rebuild";
import { buildDailySnapshots, type TransactionInput } from "./snapshot-builder";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";

function txn(postedDate: string): TransactionInput {
  return {
    id: `t-${postedDate}`, accountId: "a1", postedDate, amount: 10,
    direction: "outflow", category: null, essential: null,
    isTransfer: false, transferPairId: null,
  };
}

describe("deriveRebuildConfig", () => {
  it("returns null with no snapshots and no transactions", () => {
    expect(deriveRebuildConfig([], [])).toBeNull();
  });

  it("derives the window from transactions alone, with the default buffer", () => {
    const config = deriveRebuildConfig([], [txn("2026-03-05"), txn("2026-01-10")]);
    expect(config).toEqual({ startDate: "2026-01-10", endDate: "2026-03-05", safetyBuffer: DEFAULT_SAFETY_BUFFER });
  });

  it("keeps the prior snapshot window and buffer when it is wider", () => {
    const prior = [
      { date: "2026-01-01", safetyBuffer: 4000 },
      { date: "2026-06-30", safetyBuffer: 4000 },
    ];
    const config = deriveRebuildConfig(prior, [txn("2026-02-01")]);
    expect(config).toEqual({ startDate: "2026-01-01", endDate: "2026-06-30", safetyBuffer: 4000 });
  });

  it("extends the window when a transaction falls outside prior snapshots", () => {
    const prior = [{ date: "2026-03-01", safetyBuffer: 2500 }];
    const config = deriveRebuildConfig(prior, [txn("2026-01-15"), txn("2026-07-16")]);
    expect(config).toEqual({ startDate: "2026-01-15", endDate: "2026-07-16", safetyBuffer: 2500 });
  });

  it("takes the buffer from the latest prior snapshot", () => {
    const prior = [
      { date: "2026-01-01", safetyBuffer: 1000 },
      { date: "2026-02-01", safetyBuffer: 3000 },
    ];
    expect(deriveRebuildConfig(prior, [])?.safetyBuffer).toBe(3000);
  });
});

describe("rebuild equivalence with the demo pipeline", () => {
  it("re-deriving the config from demo output rebuilds identical snapshots", () => {
    const { accounts, transactions, config } = generateKoaHoldings();
    const original = buildDailySnapshots(accounts, transactions, config);
    const derived = deriveRebuildConfig(
      original.map((s) => ({ date: s.date, safetyBuffer: s.safetyBuffer })),
      transactions,
    );
    expect(derived).not.toBeNull();
    const rebuilt = buildDailySnapshots(accounts, transactions, derived!);
    expect(rebuilt).toEqual(original);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/rebuild.test.ts`
Expected: FAIL — cannot resolve `./rebuild`.

- [ ] **Step 3: Implement**

Create `src/lib/financial-engine/rebuild.ts`:

```ts
import type { ISODate } from "./types";
import type { SnapshotBuilderConfig, TransactionInput } from "./snapshot-builder";

/** Matches the demo generator's buffer so a rebuild of demo data is identical. */
export const DEFAULT_SAFETY_BUFFER = 2500;

export interface PriorSnapshotMeta {
  date: ISODate;
  safetyBuffer: number;
}

/**
 * Derive the snapshot window for a rebuild from what already exists. The
 * window must never shrink (prior snapshot dates are kept) and must cover
 * every transaction, so adding history extends backward and new activity
 * extends forward. Returns null when there is nothing to build from.
 */
export function deriveRebuildConfig(
  prior: PriorSnapshotMeta[],
  transactions: TransactionInput[],
): SnapshotBuilderConfig | null {
  const dates = [...prior.map((p) => p.date), ...transactions.map((t) => t.postedDate)];
  if (dates.length === 0) return null;
  let start = dates[0];
  let end = dates[0];
  for (const d of dates) {
    if (d < start) start = d;
    if (d > end) end = d;
  }
  const latest = prior.reduce<PriorSnapshotMeta | null>(
    (acc, p) => (acc === null || p.date > acc.date ? p : acc),
    null,
  );
  return { startDate: start, endDate: end, safetyBuffer: latest?.safetyBuffer ?? DEFAULT_SAFETY_BUFFER };
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./rebuild";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/rebuild.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/rebuild.ts src/lib/financial-engine/rebuild.test.ts src/lib/financial-engine/index.ts
git commit -m "feat: derive snapshot rebuild config from existing data"
```

---

### Task 4: Categories config + validation schemas

**Files:**
- Create: `src/lib/config/categories.ts`
- Create: `src/lib/validation/transactions.ts`
- Test: `src/lib/validation/transactions.test.ts`

**Interfaces:**
- Consumes: `AccountType` from `@/lib/financial-engine`.
- Produces:
  - `CATEGORIES: readonly [...]`, `type Category`, `CATEGORY_LABELS: Record<Category, string>`
  - `ACCOUNT_TYPES` runtime array (type-checked against the engine's `AccountType`), `ACCOUNT_TYPE_LABELS`
  - `createTransactionSchema`, `TransactionFormValues`
  - `overrideTransactionSchema`, `OverrideFormValues` (null = clear that override/notes)
  - `accountSchema`, `AccountFormValues`; `updateAccountSchema` (= `accountSchema` + `id`)
  - `interface TransactionFilters { account?: string; category?: Category; direction?: "inflow" | "outflow"; from?: string; to?: string }`
  - `parseTransactionFilters(sp: Record<string, string | string[] | undefined>): TransactionFilters`
  - `interface MutationResult { error: string; warning?: string }`

- [ ] **Step 1: Write `src/lib/config/categories.ts`**

```ts
/** Product-level transaction taxonomy. The engine only interprets "income"
 * (obligation windows); everything else is display/report grouping. */
export const CATEGORIES = [
  "income", "housing", "utilities", "insurance", "groceries", "dining",
  "transport", "health", "shopping", "discretionary", "debt_payment",
  "savings", "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  income: "Income", housing: "Housing", utilities: "Utilities",
  insurance: "Insurance", groceries: "Groceries", dining: "Dining",
  transport: "Transport", health: "Health", shopping: "Shopping",
  discretionary: "Discretionary", debt_payment: "Debt payment",
  savings: "Savings", other: "Other",
};
```

- [ ] **Step 2: Write the failing validation tests**

Create `src/lib/validation/transactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  accountSchema, createTransactionSchema, overrideTransactionSchema,
  parseTransactionFilters,
} from "./transactions";

const goodTxn = {
  accountId: "3f0e0e46-9c5b-4b0e-8f6e-0a4a25dd8f11",
  postedDate: "2026-07-01", amount: 42.5, direction: "outflow" as const,
  description: "Groceries", category: "groceries" as const,
};

describe("createTransactionSchema", () => {
  it("accepts a valid manual transaction", () => {
    expect(createTransactionSchema.safeParse(goodTxn).success).toBe(true);
  });
  it("rejects zero/negative amounts", () => {
    expect(createTransactionSchema.safeParse({ ...goodTxn, amount: 0 }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...goodTxn, amount: -5 }).success).toBe(false);
  });
  it("rejects future dates", () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(createTransactionSchema.safeParse({ ...goodTxn, postedDate: future }).success).toBe(false);
  });
  it("rejects an empty description and unknown categories", () => {
    expect(createTransactionSchema.safeParse({ ...goodTxn, description: "  " }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...goodTxn, category: "yachts" }).success).toBe(false);
  });
});

describe("overrideTransactionSchema", () => {
  const id = goodTxn.accountId;
  it("requires at least one change", () => {
    expect(overrideTransactionSchema.safeParse({ id }).success).toBe(false);
  });
  it("accepts nulls as clear-this-field", () => {
    expect(overrideTransactionSchema.safeParse({ id, category: null }).success).toBe(true);
    expect(overrideTransactionSchema.safeParse({ id, notes: null }).success).toBe(true);
  });
});

describe("accountSchema", () => {
  const good = { displayName: "House Checking", type: "checking" as const, currentBalance: 1200 };
  it("accepts a minimal manual account", () => {
    expect(accountSchema.safeParse(good).success).toBe(true);
  });
  it("rejects unknown types and negative balances", () => {
    expect(accountSchema.safeParse({ ...good, type: "crypto" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...good, currentBalance: -10 }).success).toBe(false);
  });
});

describe("parseTransactionFilters", () => {
  it("keeps valid params and drops junk", () => {
    expect(parseTransactionFilters({
      account: "abc", category: "groceries", direction: "inflow",
      from: "2026-07-01", to: "2026-07-15",
    })).toEqual({ account: "abc", category: "groceries", direction: "inflow", from: "2026-07-01", to: "2026-07-15" });
    expect(parseTransactionFilters({ category: "yachts", direction: "sideways", from: "nope", to: ["a"] }))
      .toEqual({ account: undefined, category: undefined, direction: undefined, from: undefined, to: undefined });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validation/transactions.test.ts`
Expected: FAIL — cannot resolve `./transactions`.

- [ ] **Step 4: Implement `src/lib/validation/transactions.ts`**

```ts
import { z } from "zod";
import { CATEGORIES, type Category } from "@/lib/config/categories";
import type { AccountType } from "@/lib/financial-engine";

/** Runtime mirror of the engine's AccountType (and the DB check constraint). */
export const ACCOUNT_TYPES = [
  "checking", "savings", "money_market", "credit_card", "mortgage",
  "auto_loan", "student_loan", "personal_loan", "brokerage", "retirement",
  "property", "other_asset", "other_liability",
] as const satisfies readonly AccountType[];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking", savings: "Savings", money_market: "Money market",
  credit_card: "Credit card", mortgage: "Mortgage", auto_loan: "Auto loan",
  student_loan: "Student loan", personal_loan: "Personal loan",
  brokerage: "Brokerage", retirement: "Retirement", property: "Property",
  other_asset: "Other asset", other_liability: "Other liability",
};

/** Shared result shape for all mutation server actions. `error: ""` = success;
 * `warning` = saved, but the snapshot rebuild failed (retryable). */
export interface MutationResult {
  error: string;
  warning?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const notFuture = (d: string) => d <= new Date().toISOString().slice(0, 10);

export const createTransactionSchema = z.object({
  accountId: z.uuid(),
  postedDate: isoDate.refine(notFuture, "Date can't be in the future"),
  amount: z.number().positive("Amount must be positive").max(10_000_000),
  direction: z.enum(["inflow", "outflow"]),
  description: z.string().trim().min(1, "Description is required").max(120),
  category: z.enum(CATEGORIES).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type TransactionFormValues = z.infer<typeof createTransactionSchema>;

export const overrideTransactionSchema = z
  .object({
    id: z.uuid(),
    category: z.enum(CATEGORIES).nullable().optional(),
    description: z.string().trim().min(1).max(120).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) => v.category !== undefined || v.description !== undefined || v.notes !== undefined,
    "Nothing to update",
  );
export type OverrideFormValues = z.infer<typeof overrideTransactionSchema>;

export const accountSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(60).optional(),
  /** Balance as of today. Enter liabilities as positive amounts. */
  currentBalance: z.number().min(0).max(100_000_000),
  creditLimit: z.number().min(0).max(100_000_000).optional(),
  /** Percent, e.g. 6.25 */
  interestRate: z.number().min(0).max(99.9999).optional(),
});
export type AccountFormValues = z.infer<typeof accountSchema>;

export const updateAccountSchema = accountSchema.extend({ id: z.uuid() });

export interface TransactionFilters {
  account?: string;
  category?: Category;
  direction?: "inflow" | "outflow";
  from?: string;
  to?: string;
}

export function parseTransactionFilters(
  sp: Record<string, string | string[] | undefined>,
): TransactionFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const cat = s("category");
  const dir = s("direction");
  return {
    account: s("account"),
    category: (CATEGORIES as readonly string[]).includes(cat ?? "") ? (cat as Category) : undefined,
    direction: dir === "inflow" || dir === "outflow" ? dir : undefined,
    from: iso(s("from")),
    to: iso(s("to")),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validation/transactions.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/config/categories.ts src/lib/validation/transactions.ts src/lib/validation/transactions.test.ts
git commit -m "feat: category taxonomy and manual-data validation schemas"
```

---

### Task 5: Mappers — transaction list items and account summaries

**Files:**
- Modify: `src/lib/data/mappers.ts`
- Test: `src/lib/data/mappers.test.ts` (extend)

**Interfaces:**
- Consumes: `applyOverride`, `parseOverride`, `EffectiveTransaction`, `AccountType` from `@/lib/financial-engine`.
- Produces:
  - `interface TransactionListRow { id: string; account_id: string; posted_date: string; amount: number; direction: string; description: string; category: string | null; essential: boolean | null; is_transfer: boolean; transfer_pair_id: string | null; notes: string | null; user_override: unknown; financial_accounts: { display_name: string; provider: string } }`
  - `interface TransactionListItem extends EffectiveTransaction { notes: string | null; accountName: string; accountProvider: "demo" | "manual" | "csv" }`
  - `rowToTransactionListItem(row: TransactionListRow): TransactionListItem`
  - `interface AccountRow { id: string; provider: string; institution: string | null; type: string; display_name: string; mask: string | null; current_balance: number | null; credit_limit: number | null; interest_rate: number | null; include_in_calculations: boolean; archived_at: string | null }`
  - `interface AccountSummary { id: string; provider: "demo" | "manual" | "csv"; institution: string | null; type: AccountType; displayName: string; mask: string | null; currentBalance: number | null; creditLimit: number | null; interestRate: number | null; includeInCalculations: boolean; archivedAt: string | null }`
  - `rowToAccountSummary(row: AccountRow): AccountSummary`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/data/mappers.test.ts`)

```ts
import { rowToAccountSummary, rowToTransactionListItem, type AccountRow, type TransactionListRow } from "./mappers";

describe("rowToTransactionListItem", () => {
  const row: TransactionListRow = {
    id: "t1", account_id: "a1", posted_date: "2026-06-01", amount: "120.50" as unknown as number,
    direction: "outflow", description: "Card purchases", category: "discretionary",
    essential: false, is_transfer: false, transfer_pair_id: null, notes: "june trip",
    user_override: { category: "dining", amount: 9999 },
    financial_accounts: { display_name: "Rewards Card", provider: "demo" },
  };

  it("coerces numerics, applies overrides, and carries account context", () => {
    const item = rowToTransactionListItem(row);
    expect(item.amount).toBe(120.5);
    expect(item.category).toBe("dining");
    expect(item.corrected).toBe(true);
    expect(item.original?.category).toBe("discretionary");
    expect(item.accountName).toBe("Rewards Card");
    expect(item.accountProvider).toBe("demo");
    expect(item.notes).toBe("june trip");
  });

  it("treats malformed user_override as no correction", () => {
    const item = rowToTransactionListItem({ ...row, user_override: "junk" });
    expect(item.corrected).toBe(false);
    expect(item.category).toBe("discretionary");
  });
});

describe("rowToAccountSummary", () => {
  const row: AccountRow = {
    id: "a1", provider: "manual", institution: "Pacific Bank", type: "credit_card",
    display_name: "Rewards Card", mask: "7710", current_balance: "412.00" as unknown as number,
    credit_limit: 5000, interest_rate: "21.99" as unknown as number,
    include_in_calculations: true, archived_at: null,
  };

  it("maps and coerces account fields", () => {
    const s = rowToAccountSummary(row);
    expect(s.currentBalance).toBe(412);
    expect(s.creditLimit).toBe(5000);
    expect(s.interestRate).toBe(21.99);
    expect(s.type).toBe("credit_card");
    expect(s.archivedAt).toBeNull();
  });

  it("keeps null balances null", () => {
    expect(rowToAccountSummary({ ...row, current_balance: null }).currentBalance).toBeNull();
  });
});
```

(Also add `rowToAccountSummary`, `rowToTransactionListItem`, and the two row types to the existing import line from `./mappers` if the test file uses one shared import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement** (append to `src/lib/data/mappers.ts`)

```ts
import { applyOverride, parseOverride, type EffectiveTransaction } from "@/lib/financial-engine";
import type { AccountType } from "@/lib/financial-engine";
```

(Merge these into the existing import block from `@/lib/financial-engine` / add as needed — the file already imports from `@/lib/financial-engine`.)

```ts
export interface TransactionListRow {
  id: string; account_id: string; posted_date: string; amount: number;
  direction: string; description: string; category: string | null;
  essential: boolean | null; is_transfer: boolean; transfer_pair_id: string | null;
  notes: string | null; user_override: unknown;
  financial_accounts: { display_name: string; provider: string };
}

export interface TransactionListItem extends EffectiveTransaction {
  notes: string | null;
  accountName: string;
  accountProvider: "demo" | "manual" | "csv";
}

export function rowToTransactionListItem(row: TransactionListRow): TransactionListItem {
  const effective = applyOverride({
    id: row.id,
    accountId: row.account_id,
    postedDate: row.posted_date,
    amount: Number(row.amount),
    direction: row.direction as "inflow" | "outflow",
    description: row.description,
    category: row.category,
    essential: row.essential,
    isTransfer: row.is_transfer,
    transferPairId: row.transfer_pair_id,
    userOverride: parseOverride(row.user_override),
  });
  return {
    ...effective,
    notes: row.notes,
    accountName: row.financial_accounts.display_name,
    accountProvider: row.financial_accounts.provider as "demo" | "manual" | "csv",
  };
}

export interface AccountRow {
  id: string; provider: string; institution: string | null; type: string;
  display_name: string; mask: string | null; current_balance: number | null;
  credit_limit: number | null; interest_rate: number | null;
  include_in_calculations: boolean; archived_at: string | null;
}

export interface AccountSummary {
  id: string; provider: "demo" | "manual" | "csv"; institution: string | null;
  type: AccountType; displayName: string; mask: string | null;
  currentBalance: number | null; creditLimit: number | null;
  interestRate: number | null; includeInCalculations: boolean;
  archivedAt: string | null;
}

export function rowToAccountSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    provider: row.provider as AccountSummary["provider"],
    institution: row.institution,
    type: row.type as AccountType,
    displayName: row.display_name,
    mask: row.mask,
    currentBalance: row.current_balance === null ? null : Number(row.current_balance),
    creditLimit: row.credit_limit === null ? null : Number(row.credit_limit),
    interestRate: row.interest_rate === null ? null : Number(row.interest_rate),
    includeInCalculations: row.include_in_calculations,
    archivedAt: row.archived_at,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/mappers.ts src/lib/data/mappers.test.ts
git commit -m "feat: transaction list and account summary mappers with override merge"
```

---

### Task 6: Queries — transactions/accounts reads, stale flag, effective report categories

**Files:**
- Modify: `src/lib/data/queries.ts`

**Interfaces:**
- Consumes: mappers from Task 5, `TransactionFilters` from `@/lib/validation/transactions`.
- Produces:
  - `getAccountsData(supabase): Promise<AccountSummary[]>` (all accounts, including archived, creation order)
  - `getTransactionsData(supabase, filters): Promise<{ transactions: TransactionListItem[]; accounts: AccountSummary[] }>` — account/date filters in SQL; category/direction filtered in memory **on effective values** (overrides live in jsonb, so SQL can't see them)
  - `getDashboardData` now returns `{ snapshots, events, staleIndex: boolean }` — `staleIndex` = latest transaction `posted_date` is newer than the latest snapshot date (or transactions exist with no snapshots)
  - `getReportData` maps transactions through `parseOverride`/`applyOverride` so report groupings honor corrections (amount/date/direction untouched → FCF≡OCE identity unaffected)

- [ ] **Step 1: Implement query additions**

In `src/lib/data/queries.ts`, extend the mapper import line to include the new symbols:

```ts
import {
  rowToSnapshot, rowToEvent, rowToTransactionInput, rowToTransactionListItem,
  rowToAccountSummary, type SnapshotRow, type EventRow, type TransactionRow,
  type TransactionListRow, type AccountRow, type AccountSummary, type TransactionListItem,
} from "./mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";
```

Add:

```ts
export async function getAccountsData(supabase: SupabaseClient): Promise<AccountSummary[]> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, provider, institution, type, display_name, mask, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AccountRow[]).map(rowToAccountSummary);
}

export async function getTransactionsData(
  supabase: SupabaseClient,
  filters: TransactionFilters,
): Promise<{ transactions: TransactionListItem[]; accounts: AccountSummary[] }> {
  let query = supabase
    .from("transactions")
    .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override, financial_accounts!inner(display_name, provider)")
    .order("posted_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (filters.account) query = query.eq("account_id", filters.account);
  if (filters.from) query = query.gte("posted_date", filters.from);
  if (filters.to) query = query.lte("posted_date", filters.to);

  const [txnRes, accounts] = await Promise.all([query, getAccountsData(supabase)]);
  if (txnRes.error) throw txnRes.error;

  // Category/direction filter on *effective* values: overrides live in jsonb,
  // so SQL filters on the source column would miss corrections.
  let items = (txnRes.data as unknown as TransactionListRow[]).map(rowToTransactionListItem);
  if (filters.category) items = items.filter((t) => t.category === filters.category);
  if (filters.direction) items = items.filter((t) => t.direction === filters.direction);
  return { transactions: items, accounts };
}
```

- [ ] **Step 2: Add the stale flag to `getDashboardData`**

Replace the existing `getDashboardData` with:

```ts
export async function getDashboardData(
  supabase: SupabaseClient,
): Promise<{ snapshots: DailySnapshot[]; events: FinancialEvent[]; staleIndex: boolean }> {
  const [snapRes, eventRes, latestTxnRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
    supabase.from("transactions").select("posted_date").order("posted_date", { ascending: false }).limit(1),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (eventRes.error) throw eventRes.error;
  if (latestTxnRes.error) throw latestTxnRes.error;

  const snapshots = (snapRes.data as SnapshotRow[]).map(rowToSnapshot);
  const latestTxnDate = latestTxnRes.data?.[0]?.posted_date as string | undefined;
  const latestSnapDate = snapshots.at(-1)?.date;
  // Cheap divergence proxy: a transaction newer than the newest snapshot means
  // a rebuild is pending/failed. (Historical inserts with a failed rebuild are
  // caught by the retry-on-mutation path — see KNOWN_LIMITATIONS.)
  const staleIndex = latestTxnDate !== undefined && (latestSnapDate === undefined || latestTxnDate > latestSnapDate);

  return {
    snapshots,
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
    staleIndex,
  };
}
```

- [ ] **Step 3: Make `getReportData` honor overrides**

In `getReportData`, widen the transaction select to include `description, notes, user_override` and map through the override helper. Replace the transactions select string with:

```ts
supabase
  .from("transactions")
  .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override")
  .order("posted_date", { ascending: true }),
```

and replace the returned `transactions:` mapping with:

```ts
transactions: (txnRes.data as Array<TransactionRow & { description: string; notes: string | null; user_override: unknown }>).map((row) => {
  const effective = applyOverride({
    id: row.id, accountId: row.account_id, postedDate: row.posted_date,
    amount: Number(row.amount), direction: row.direction as "inflow" | "outflow",
    description: row.description, category: row.category, essential: row.essential,
    isTransfer: row.is_transfer, transferPairId: row.transfer_pair_id,
    userOverride: parseOverride(row.user_override),
  });
  return {
    id: effective.id, accountId: effective.accountId, postedDate: effective.postedDate,
    amount: effective.amount, direction: effective.direction, category: effective.category,
    essential: effective.essential, isTransfer: effective.isTransfer,
    transferPairId: effective.transferPairId,
  };
}),
```

with `import { applyOverride, parseOverride } from "@/lib/financial-engine";` added at the top. (`rowToTransactionInput` remains for the rebuild path.)

- [ ] **Step 4: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test`
Expected: green. (`getDashboardData`'s new return field breaks no existing destructuring; `src/app/page.tsx` is updated in Task 12.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/queries.ts
git commit -m "feat: transactions/accounts queries, stale-index flag, override-aware report reads"
```

---

### Task 7: `insertChunked` extraction + `rebuildSnapshots`

**Files:**
- Create: `src/lib/data/insert-chunked.ts`
- Create: `src/lib/data/rebuild-snapshots.ts`
- Modify: `src/app/actions/demo.ts` (use shared helper; finish seed/clear with a rebuild)

**Interfaces:**
- Consumes: `deriveRebuildConfig`, `buildDailySnapshots`, `AccountInput`, `AccountType` from `@/lib/financial-engine`; `rowToTransactionInput`, `snapshotToRow`, `TransactionRow` from `./mappers`.
- Produces:
  - `insertChunked(supabase: SupabaseClient, table: string, rows: unknown[]): Promise<void>` (throws on error)
  - `rebuildSnapshots(supabase: SupabaseClient): Promise<{ error: string }>` — never throws; `error: ""` on success. Archived accounts and their transactions are excluded before building.

- [ ] **Step 1: Create `src/lib/data/insert-chunked.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 500;

export async function insertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: unknown[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}
```

(Check the `CHUNK` constant's value in `src/app/actions/demo.ts` first and keep the same value; then delete the local `insertChunked` and its `CHUNK` from `demo.ts` and import the shared one. `createClient`'s return type is assignable to `SupabaseClient`.)

- [ ] **Step 2: Create `src/lib/data/rebuild-snapshots.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDailySnapshots, deriveRebuildConfig,
  type AccountInput, type AccountType,
} from "@/lib/financial-engine";
import { rowToTransactionInput, snapshotToRow, type TransactionRow } from "./mappers";
import { insertChunked } from "./insert-chunked";

interface RebuildAccountRow {
  id: string; type: string; current_balance: number | null;
  include_in_calculations: boolean; archived_at: string | null;
}

/**
 * Recompute the user's daily_snapshots from source-of-truth accounts and
 * transactions (source columns only — overrides never move the index).
 * Idempotent: same inputs always produce the same rows. Returns an error
 * string instead of throwing so callers can degrade to a "recalculation
 * pending" state; the delete+insert is not transactional, and the stale-index
 * check plus retry-on-next-mutation covers the failure window.
 */
export async function rebuildSnapshots(supabase: SupabaseClient): Promise<{ error: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const [acctRes, txnRes, snapRes] = await Promise.all([
      supabase.from("financial_accounts")
        .select("id, type, current_balance, include_in_calculations, archived_at"),
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, category, essential, is_transfer, transfer_pair_id"),
      supabase.from("daily_snapshots").select("date, safety_buffer"),
    ]);
    if (acctRes.error) throw new Error(acctRes.error.message);
    if (txnRes.error) throw new Error(txnRes.error.message);
    if (snapRes.error) throw new Error(snapRes.error.message);

    const active = (acctRes.data as RebuildAccountRow[]).filter((a) => a.archived_at === null);
    const activeIds = new Set(active.map((a) => a.id));
    const accounts: AccountInput[] = active.map((a) => ({
      id: a.id,
      type: a.type as AccountType,
      currentBalance: Number(a.current_balance ?? 0),
      includeInCalculations: a.include_in_calculations,
    }));
    const transactions = (txnRes.data as TransactionRow[])
      .map(rowToTransactionInput)
      .filter((t) => activeIds.has(t.accountId));
    const prior = (snapRes.data as Array<{ date: string; safety_buffer: number }>).map((p) => ({
      date: p.date,
      safetyBuffer: Number(p.safety_buffer),
    }));

    const config = deriveRebuildConfig(prior, transactions);

    const del = await supabase.from("daily_snapshots").delete().eq("user_id", user.id);
    if (del.error) throw new Error(del.error.message);

    if (config) {
      const snapshots = buildDailySnapshots(accounts, transactions, config);
      await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));
    }
    return { error: "" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Snapshot rebuild failed" };
  }
}
```

- [ ] **Step 3: Route the demo pipeline through the rebuild**

In `src/app/actions/demo.ts`:
- Replace the local `insertChunked`/`CHUNK` with `import { insertChunked } from "@/lib/data/insert-chunked";`.
- In `loadDemoData`, immediately after the existing demo-built snapshot insert (keep it — it seeds the window and safety buffer) and before `revalidatePath("/")`, add:

```ts
  // A user may have manual accounts alongside demo data; the demo-built
  // snapshots above only cover demo accounts. Rebuilding from the DB folds
  // every active account in (identical output when only demo data exists).
  const { error: rebuildErr } = await rebuildSnapshots(supabase);
  if (rebuildErr) throw new Error(rebuildErr);
```

- In `clearDemoData`, before its final `revalidatePath("/")`, add the same rebuild call (manual accounts must regain snapshots after demo rows vanish):

```ts
  const { error: rebuildErr } = await rebuildSnapshots(supabase);
  if (rebuildErr) throw new Error(rebuildErr);
```

- Add `import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";` to `demo.ts`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/insert-chunked.ts src/lib/data/rebuild-snapshots.ts src/app/actions/demo.ts
git commit -m "feat: snapshot rebuild from persisted data; demo pipeline folds in manual accounts"
```

---

### Task 8: Transaction server actions

**Files:**
- Create: `src/app/actions/transactions.ts`

**Interfaces:**
- Consumes: schemas + `MutationResult` from `@/lib/validation/transactions`; `rebuildSnapshots`; `createClient` from `@/lib/supabase/server`.
- Produces (all async, all return `Promise<MutationResult>`):
  - `createTransaction(values: TransactionFormValues)` — only into the caller's own **manual, non-archived** accounts
  - `deleteTransaction(id: string)` — only when the owning account's provider is `manual`
  - `overrideTransaction(values: OverrideFormValues)` — merges `user_override` (null clears a key; empty override stored as SQL `null`), writes `notes` directly (not a frozen column); **no rebuild** (overrides never move the index)

- [ ] **Step 1: Implement `src/app/actions/transactions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";
import {
  createTransactionSchema, overrideTransactionSchema,
  type MutationResult, type OverrideFormValues, type TransactionFormValues,
} from "@/lib/validation/transactions";

const REBUILD_WARNING =
  "Saved — but the index recalculation failed. It will retry on your next change or dashboard reload.";

async function finishWithRebuild(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<MutationResult> {
  const { error } = await rebuildSnapshots(supabase);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/report");
  return error ? { error: "", warning: REBUILD_WARNING } : { error: "" };
}

export async function createTransaction(values: TransactionFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = createTransactionSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: acctErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Transactions can only be added to manual accounts" };
  }
  if (account.archived_at) return { error: "This account is archived" };

  const { error: insertErr } = await supabase.from("transactions").insert({
    account_id: v.accountId, user_id: user.id, posted_date: v.postedDate,
    amount: v.amount, direction: v.direction, description: v.description,
    category: v.category ?? null, notes: v.notes || null,
  });
  if (insertErr) return { error: insertErr.message };

  return finishWithRebuild(supabase);
}

export async function deleteTransaction(id: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid transaction" };

  const { data: txn, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, financial_accounts!inner(provider)")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!txn) return { error: "Transaction not found" };
  const provider = (txn.financial_accounts as unknown as { provider: string }).provider;
  if (provider !== "manual") {
    return { error: "Imported transactions can't be deleted — recategorize them instead" };
  }

  const { error: delErr } = await supabase.from("transactions").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

  return finishWithRebuild(supabase);
}

export async function overrideTransaction(values: OverrideFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = overrideTransactionSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: txn, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, user_override")
    .eq("id", v.id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!txn) return { error: "Transaction not found" };

  // Merge onto the existing override; null clears a key. An empty result is
  // stored as SQL null so `corrected` stays honest.
  const merged: Record<string, string> = {
    ...((txn.user_override as Record<string, string> | null) ?? {}),
  };
  for (const key of ["category", "description"] as const) {
    const value = v[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  const update: Record<string, unknown> = {
    user_override: Object.keys(merged).length > 0 ? merged : null,
  };
  if (v.notes !== undefined) update.notes = v.notes || null;

  const { error: updateErr } = await supabase.from("transactions").update(update).eq("id", v.id);
  if (updateErr) return { error: updateErr.message };

  // Overrides never touch amount/date/direction → no rebuild (invariant).
  revalidatePath("/transactions");
  revalidatePath("/report");
  return { error: "" };
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: green. (These actions are exercised by the RLS script in Task 13 and live verification in Task 14 — Supabase I/O isn't unit-tested, matching the existing actions.)

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/transactions.ts
git commit -m "feat: create/delete/override transaction server actions"
```

---

### Task 9: Account server actions

**Files:**
- Create: `src/app/actions/accounts.ts`

**Interfaces:**
- Consumes: `accountSchema`, `updateAccountSchema`, `MutationResult` from `@/lib/validation/transactions`; `rebuildSnapshots`.
- Produces (all async, `Promise<MutationResult>`):
  - `createAccount(values: AccountFormValues)` — always `provider: 'manual'`
  - `updateAccount(values: AccountFormValues & { id: string })` — **manual accounts only** (demo accounts reset via demo reseed)
  - `setAccountIncluded(id: string, included: boolean)` — any provider
  - `setAccountArchived(id: string, archived: boolean)` — any provider; sets/clears `archived_at`
  - All four end with the same rebuild+revalidate helper as Task 8 (duplicated locally — `"use server"` files can't share non-async exports).

- [ ] **Step 1: Implement `src/app/actions/accounts.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";
import {
  accountSchema, updateAccountSchema,
  type AccountFormValues, type MutationResult,
} from "@/lib/validation/transactions";

const REBUILD_WARNING =
  "Saved — but the index recalculation failed. It will retry on your next change or dashboard reload.";

async function finishWithRebuild(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<MutationResult> {
  const { error } = await rebuildSnapshots(supabase);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/report");
  return error ? { error: "", warning: REBUILD_WARNING } : { error: "" };
}

export async function createAccount(values: AccountFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = accountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { error: insertErr } = await supabase.from("financial_accounts").insert({
    user_id: user.id, provider: "manual", type: v.type, display_name: v.displayName,
    institution: v.institution || null, current_balance: v.currentBalance,
    credit_limit: v.creditLimit ?? null, interest_rate: v.interestRate ?? null,
  });
  if (insertErr) return { error: insertErr.message };

  return finishWithRebuild(supabase);
}

export async function updateAccount(
  values: AccountFormValues & { id: string },
): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = updateAccountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: fetchErr } = await supabase
    .from("financial_accounts").select("id, provider").eq("id", v.id).maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Demo accounts can't be edited — reload demo data to reset them" };
  }

  const { error: updateErr } = await supabase
    .from("financial_accounts")
    .update({
      type: v.type, display_name: v.displayName, institution: v.institution || null,
      current_balance: v.currentBalance, credit_limit: v.creditLimit ?? null,
      interest_rate: v.interestRate ?? null,
    })
    .eq("id", v.id);
  if (updateErr) return { error: updateErr.message };

  return finishWithRebuild(supabase);
}

export async function setAccountIncluded(id: string, included: boolean): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { error } = await supabase
    .from("financial_accounts")
    .update({ include_in_calculations: included })
    .eq("id", id);
  if (error) return { error: error.message };

  return finishWithRebuild(supabase);
}

export async function setAccountArchived(id: string, archived: boolean): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { error } = await supabase
    .from("financial_accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };

  return finishWithRebuild(supabase);
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/accounts.ts
git commit -m "feat: account create/update/include/archive server actions"
```

---

### Task 10: Sheet primitive + `/transactions` screen

**Files:**
- Create: `src/components/ui/Sheet.tsx`
- Create: `src/app/transactions/page.tsx`, `src/app/transactions/loading.tsx`, `src/app/transactions/error.tsx`, `src/app/transactions/TransactionsView.tsx`

**Interfaces:**
- Consumes: `getTransactionsData`, `getProfile`; `parseTransactionFilters`, `TransactionFilters`; `CATEGORY_LABELS`, `CATEGORIES`; `formatShortDate`, `formatSignedDollars` from the engine; `Segmented`, `Card`.
- Produces:
  - `Sheet({ open, onClose, title, children })` — `role="dialog"`, `aria-modal`, Esc closes, backdrop click closes; bottom sheet <640px, centered dialog ≥640px
  - `TransactionsView({ transactions, accounts, filters, contextLabel })` — renders groups/filters/FAB; opens `TransactionSheet` (Task 11) for add/detail. **In this task, render the list without the sheet wiring** (add a `TODO`-free placeholder: FAB and row clicks store selection in state; the sheet component arrives in Task 11 — keep the `useState` hooks and pass-through props in place so Task 11 only adds the import and JSX).

- [ ] **Step 1: Create `src/components/ui/Sheet.tsx`**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Bottom sheet on mobile, centered dialog on ≥sm. Purely presentational. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border-subtle bg-elevated p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-secondary hover:text-primary"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/transactions/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getTransactionsData } from "@/lib/data/queries";
import { parseTransactionFilters } from "@/lib/validation/transactions";
import { TransactionsView } from "./TransactionsView";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const sp = await searchParams;
  const filters = parseTransactionFilters(sp);
  const { transactions, accounts } = await getTransactionsData(supabase, filters);

  return (
    <TransactionsView
      transactions={transactions}
      accounts={accounts}
      filters={filters}
      contextLabel={typeof sp.label === "string" ? sp.label : null}
    />
  );
}
```

- [ ] **Step 3: Create `src/app/transactions/loading.tsx` and `error.tsx`**

`loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading transactions" className="flex flex-col gap-3">
      <div className="h-7 w-44 animate-pulse rounded-lg bg-elevated" />
      <div className="h-9 w-full animate-pulse rounded-full bg-elevated" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-card bg-elevated" />
      ))}
    </div>
  );
}
```

`error.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-4 p-10 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-warning-muted text-warning">
        <AlertTriangle size={24} />
      </span>
      <div>
        <p className="text-sm font-medium text-primary">Couldn’t load transactions</p>
        <p className="mt-1 max-w-sm text-sm text-secondary">Your data is safe. Try again in a moment.</p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base"
      >
        Try again
      </button>
    </Card>
  );
}
```

(Create the same pair for `/accounts` in Task 12 with "Couldn’t load accounts" copy.)

- [ ] **Step 4: Create `src/app/transactions/TransactionsView.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { formatShortDate, formatSignedDollars } from "@/lib/financial-engine/format";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import type { AccountSummary, TransactionListItem } from "@/lib/data/mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";

const selectCls =
  "rounded-full border border-border-subtle bg-inset px-3 py-1.5 text-xs text-primary focus:border-border-strong focus:outline-none";

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function TransactionsView({
  transactions,
  accounts,
  filters,
  contextLabel,
}: {
  transactions: TransactionListItem[];
  accounts: AccountSummary[];
  filters: TransactionFilters;
  contextLabel: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<TransactionListItem | null>(null);
  const [adding, setAdding] = useState(false);

  const hasFilters = Boolean(
    filters.account || filters.category || filters.direction || filters.from || filters.to,
  );
  const pickerAccounts = accounts.filter((a) => a.archivedAt === null);
  const manualAccounts = pickerAccounts.filter((a) => a.provider === "manual");

  const setFilter = (patch: Partial<Record<keyof TransactionFilters | "label", string | undefined>>) => {
    const next = new URLSearchParams();
    const merged = { ...filters, label: contextLabel ?? undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const groups = useMemo(() => {
    const map = new Map<string, TransactionListItem[]>();
    for (const t of transactions) {
      const key = t.postedDate.slice(0, 7);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [transactions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back to dashboard" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Transactions</h1>
      </div>

      {contextLabel && (filters.from || filters.to) && (
        <Card className="flex items-center justify-between gap-3 p-3">
          <p className="text-sm text-secondary">
            Showing {filters.from === filters.to ? formatShortDate(filters.from!) : "a date range"} — tapped from{" "}
            <span className="font-medium text-primary">{contextLabel}</span>
          </p>
          <button
            type="button"
            onClick={() => setFilter({ from: undefined, to: undefined, label: undefined })}
            className="shrink-0 text-xs font-medium text-secondary underline hover:text-primary"
          >
            Clear filters
          </button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <select
          aria-label="Filter by account"
          className={selectCls}
          value={filters.account ?? ""}
          onChange={(e) => setFilter({ account: e.target.value || undefined })}
        >
          <option value="">All accounts</option>
          {pickerAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <select
          aria-label="Filter by category"
          className={selectCls}
          value={filters.category ?? ""}
          onChange={(e) => setFilter({ category: (e.target.value || undefined) as Category | undefined })}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <Segmented
          ariaLabel="Filter by direction"
          options={[{ key: "all", label: "All" }, { key: "inflow", label: "In" }, { key: "outflow", label: "Out" }]}
          value={filters.direction ?? "all"}
          onChange={(key) => setFilter({ direction: key === "all" ? undefined : key })}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={() => router.replace(pathname)}
            className="text-xs font-medium text-secondary underline hover:text-primary"
          >
            Clear all
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        hasFilters ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-primary">No transactions match these filters</p>
            <button
              type="button"
              onClick={() => router.replace(pathname)}
              className="rounded-xl border border-border-subtle px-4 py-2 text-sm text-secondary hover:text-primary"
            >
              Clear filters
            </button>
          </Card>
        ) : (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-primary">No transactions yet</p>
            <p className="max-w-sm text-sm text-secondary">
              Add a transaction to a manual account, or load demo data from the dashboard to explore.
            </p>
            {manualAccounts.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base"
              >
                Add transaction
              </button>
            )}
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-5 pb-24">
          {groups.map(([month, items]) => (
            <section key={month} aria-label={monthLabel(month)}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">
                {monthLabel(month)}
              </h2>
              <Card className="divide-y divide-border-subtle">
                {items.map((t) => {
                  const inflow = t.direction === "inflow";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(t)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-inset"
                    >
                      <span
                        aria-hidden
                        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                          inflow ? "bg-positive-muted text-positive" : "bg-inset text-secondary"
                        }`}
                      >
                        {inflow ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-primary">
                          {t.description}
                          {t.corrected && (
                            <span className="ml-2 rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary">
                              corrected
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-tertiary">
                          {t.accountName} · {formatShortDate(t.postedDate)}
                          {t.category ? ` · ${CATEGORY_LABELS[t.category as Category] ?? t.category}` : ""}
                        </span>
                      </span>
                      <span
                        className={`tabular shrink-0 text-sm font-semibold ${
                          inflow ? "text-positive" : "text-primary"
                        }`}
                      >
                        {formatSignedDollars(inflow ? t.amount : -t.amount)}
                      </span>
                    </button>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}

      {manualAccounts.length > 0 && transactions.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-20 z-10 flex items-center gap-2 rounded-full bg-positive-strong px-5 py-3 text-sm font-semibold text-base shadow-card"
        >
          <Plus size={18} aria-hidden /> Add transaction
        </button>
      )}
      {/* TransactionSheet (add + detail) mounts here in Task 11, driven by `adding`/`selected`.
          This expression renders nothing; it only keeps the state lint-clean until then. */}
      {(adding || selected) && null}
    </div>
  );
}
```

- [ ] **Step 5: Verify in browser and with the toolchain**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: green.
Run: `pnpm dev`, sign in as the demo user, open `http://localhost:3000/transactions` at 390×844:
- list renders month groups; filters change the URL and the list
- `/transactions?from=2026-07-01&to=2026-07-01&label=Test` shows the context banner
- empty-filter state shows "No transactions match"

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Sheet.tsx src/app/transactions
git commit -m "feat: /transactions drill-down list with filters, states, and sheet primitive"
```

---

### Task 11: TransactionSheet — add, detail, recategorize, delete

**Files:**
- Create: `src/app/transactions/TransactionSheet.tsx`
- Modify: `src/app/transactions/TransactionsView.tsx` (mount the sheets)

**Interfaces:**
- Consumes: `Sheet`; `createTransaction`, `deleteTransaction`, `overrideTransaction` actions; schemas from `@/lib/validation/transactions`; `CATEGORIES`, `CATEGORY_LABELS`.
- Produces:
  - `AddTransactionSheet({ accounts, open, onClose })` — `accounts` = manual, non-archived only
  - `TransactionDetailSheet({ txn, open, onClose })` — source fields read-only; category/description/notes editable via override; "Reset corrections" when corrected; two-step delete for manual transactions

- [ ] **Step 1: Create `src/app/transactions/TransactionSheet.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet } from "@/components/ui/Sheet";
import { createTransaction, deleteTransaction, overrideTransaction } from "@/app/actions/transactions";
import {
  createTransactionSchema, type TransactionFormValues,
} from "@/lib/validation/transactions";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import { formatDollars, formatShortDate } from "@/lib/financial-engine/format";
import type { AccountSummary, TransactionListItem } from "@/lib/data/mappers";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

function ResultNotice({ warning, error }: { warning: string | null; error: string | null }) {
  if (error) return <p role="alert" className="text-sm text-negative">✕ {error}</p>;
  if (warning) return <p role="status" className="text-sm text-warning">⚠ {warning}</p>;
  return null;
}

export function AddTransactionSheet({
  accounts,
  open,
  onClose,
}: {
  accounts: AccountSummary[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      postedDate: new Date().toISOString().slice(0, 10),
      direction: "outflow",
    },
  });

  const submit = (values: TransactionFormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createTransaction(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      reset();
      onClose();
      router.refresh();
      if (result.warning) setServerError(null); // warning surfaces via dashboard stale notice
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add transaction">
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="txn-account">Account</label>
        <select id="txn-account" className={inputCls} {...register("accountId")}>
          <option value="">Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        {errors.accountId && <p role="alert" className="text-xs text-negative">Choose an account</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="txn-date">Date</label>
            <input id="txn-date" type="date" className={inputCls} {...register("postedDate")} />
            {errors.postedDate && <p role="alert" className="text-xs text-negative">{errors.postedDate.message}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="txn-amount">Amount ($)</label>
            <input
              id="txn-amount" type="number" step="0.01" min="0" inputMode="decimal"
              className={inputCls} {...register("amount", { valueAsNumber: true })}
            />
            {errors.amount && <p role="alert" className="text-xs text-negative">{errors.amount.message}</p>}
          </div>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className={labelCls}>Direction</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="radio" value="outflow" {...register("direction")} /> Money out
            </label>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="radio" value="inflow" {...register("direction")} /> Money in
            </label>
          </div>
        </fieldset>

        <label className={labelCls} htmlFor="txn-desc">Description</label>
        <input id="txn-desc" className={inputCls} placeholder="Groceries" {...register("description")} />
        {errors.description && <p role="alert" className="text-xs text-negative">{errors.description.message}</p>}

        <label className={labelCls} htmlFor="txn-category">Category (optional)</label>
        <select id="txn-category" className={inputCls} defaultValue="" {...register("category", { setValueAs: (v) => (v === "" ? undefined : v) })}>
          <option value="">Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <label className={labelCls} htmlFor="txn-notes">Notes (optional)</label>
        <textarea id="txn-notes" rows={2} className={inputCls} {...register("notes", { setValueAs: (v) => (v === "" ? undefined : v) })} />

        <ResultNotice warning={null} error={serverError} />
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save transaction"}
        </button>
      </form>
    </Sheet>
  );
}

export function TransactionDetailSheet({
  txn,
  open,
  onClose,
}: {
  txn: TransactionListItem;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [category, setCategory] = useState<string>(txn.category ?? "");
  const [description, setDescription] = useState(txn.description);
  const [notes, setNotes] = useState(txn.notes ?? "");

  const inflow = txn.direction === "inflow";
  const changed =
    category !== (txn.category ?? "") || description !== txn.description || notes !== (txn.notes ?? "");

  const run = (fn: () => Promise<{ error: string; warning?: string }>, closeOnSuccess = true) => {
    setServerError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setServerError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      router.refresh();
      if (closeOnSuccess && !result.warning) onClose();
    });
  };

  const save = () =>
    run(() =>
      overrideTransaction({
        id: txn.id,
        // Send a field only when the visible value differs from the current
        // effective one; "" category means clear the override.
        category: category !== (txn.category ?? "") ? (category === "" ? null : (category as Category)) : undefined,
        description: description !== txn.description ? description : undefined,
        notes: notes !== (txn.notes ?? "") ? notes || null : undefined,
      }),
    );

  const resetCorrections = () =>
    run(() => overrideTransaction({ id: txn.id, category: null, description: null }));

  return (
    <Sheet open={open} onClose={onClose} title="Transaction">
      <div className="flex flex-col gap-3">
        <div>
          <p className={`tabular text-2xl font-semibold ${inflow ? "text-positive" : "text-primary"}`}>
            {inflow ? "+" : "−"}{formatDollars(txn.amount)}
          </p>
          <p className="mt-1 text-xs text-tertiary">
            {txn.accountName} · {formatShortDate(txn.postedDate)} · {inflow ? "Money in" : "Money out"}
            {txn.isTransfer ? " · Transfer" : ""}
          </p>
          {txn.accountProvider !== "manual" && (
            <p className="mt-1 text-xs text-tertiary">
              Imported {txn.accountProvider} data — amount and date are locked; corrections below are tracked.
            </p>
          )}
          {txn.accountProvider === "manual" && (
            <p className="mt-1 text-xs text-tertiary">
              Wrong amount or date? Delete this transaction and re-add it.
            </p>
          )}
        </div>

        <label className={labelCls} htmlFor="detail-desc">Description</label>
        <input id="detail-desc" className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        {txn.corrected && txn.original && (
          <p className="text-xs text-tertiary">
            Original: {txn.original.description}
            {txn.original.category ? ` · ${CATEGORY_LABELS[txn.original.category as Category] ?? txn.original.category}` : ""}
          </p>
        )}

        <label className={labelCls} htmlFor="detail-category">Category</label>
        <select id="detail-category" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <label className={labelCls} htmlFor="detail-notes">Notes</label>
        <textarea id="detail-notes" rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <ResultNotice warning={warning} error={serverError} />

        <div className="mt-1 flex flex-col gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending || !changed}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save corrections"}
          </button>
          {txn.corrected && (
            <button
              type="button"
              onClick={resetCorrections}
              disabled={pending}
              className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary disabled:opacity-60"
            >
              Reset to original
            </button>
          )}
          {txn.accountProvider === "manual" &&
            (confirmingDelete ? (
              <button
                type="button"
                onClick={() => run(() => deleteTransaction(txn.id))}
                disabled={pending}
                className="rounded-xl border border-negative px-4 py-3 text-sm font-semibold text-negative disabled:opacity-60"
              >
                {pending ? "Deleting…" : "Confirm delete — can’t be undone"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary"
              >
                Delete transaction
              </button>
            ))}
        </div>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 2: Mount the sheets in `TransactionsView.tsx`**

Replace the `{(adding || selected) && null}` placeholder (and its comment) from Task 10 with:

```tsx
<AddTransactionSheet accounts={manualAccounts} open={adding} onClose={() => setAdding(false)} />
{selected && (
  <TransactionDetailSheet
    key={selected.id}
    txn={selected}
    open
    onClose={() => setSelected(null)}
  />
)}
```

and add the import:

```tsx
import { AddTransactionSheet, TransactionDetailSheet } from "./TransactionSheet";
```

(`key={selected.id}` resets the sheet's local field state per transaction.)

- [ ] **Step 3: Verify live**

Run: `pnpm typecheck && pnpm lint && pnpm build`, then `pnpm dev` at 390×844:
- Add a manual account first via SQL is NOT needed — if no manual account exists yet, the FAB is hidden; temporarily verify the detail sheet on demo data: open a demo transaction, recategorize it, confirm the "corrected" chip and "Reset to original", and confirm the amount is unchanged on the dashboard (index identical).
- Delete button must be absent on demo transactions.

- [ ] **Step 4: Commit**

```bash
git add src/app/transactions
git commit -m "feat: transaction add/detail sheet with override corrections and manual delete"
```

---

### Task 12: `/accounts` screen + dashboard wiring + self-heal

**Files:**
- Create: `src/app/accounts/page.tsx`, `loading.tsx`, `error.tsx`, `AccountsView.tsx`, `AccountSheet.tsx`
- Modify: `src/components/dashboard/MetricCard.tsx` (optional `href`), `src/components/dashboard/WhatMovedYourLine.tsx` (driver links), `src/components/dashboard/HomeDashboard.tsx` (Available Capital href + stale notice), `src/app/page.tsx` (stale self-heal + prop)

**Interfaces:**
- Consumes: `getAccountsData`, account actions, `AccountSummary`, `ACCOUNT_TYPE_LABELS`, `Sheet`, `formatDollars`, `rebuildSnapshots`.
- Produces: `AccountsView({ accounts })`, `AccountSheet({ account | null, open, onClose })`; `MetricCard` gains `href?: string`; `HomeDashboard` gains `staleIndex?: boolean`.

- [ ] **Step 1: `src/app/accounts/page.tsx`, `loading.tsx`, `error.tsx`**

`page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountsData, getProfile } from "@/lib/data/queries";
import { AccountsView } from "./AccountsView";

export default async function AccountsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const accounts = await getAccountsData(supabase);
  return <AccountsView accounts={accounts} />;
}
```

`loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading accounts" className="flex flex-col gap-3">
      <div className="h-7 w-36 animate-pulse rounded-lg bg-elevated" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-card bg-elevated" />
      ))}
    </div>
  );
}
```

`error.tsx`: copy of `src/app/transactions/error.tsx` with the heading "Couldn’t load accounts".

- [ ] **Step 2: `src/app/accounts/AccountsView.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { setAccountArchived, setAccountIncluded } from "@/app/actions/accounts";
import { formatDollars } from "@/lib/financial-engine/format";
import type { AccountType } from "@/lib/financial-engine";
import type { AccountSummary } from "@/lib/data/mappers";
import { AccountSheet } from "./AccountSheet";

const GROUPS: ReadonlyArray<{ title: string; types: readonly AccountType[] }> = [
  { title: "Cash", types: ["checking", "savings", "money_market"] },
  { title: "Credit", types: ["credit_card"] },
  { title: "Loans", types: ["mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability"] },
  { title: "Investments", types: ["brokerage", "retirement"] },
  { title: "Property & other", types: ["property", "other_asset"] },
];

const chipCls =
  "rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary";
const actionCls =
  "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";

export function AccountsView({ accounts }: { accounts: AccountSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AccountSummary | null>(null);
  const [adding, setAdding] = useState(false);
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

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back to dashboard" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Accounts</h1>
      </div>

      {notice && <p role="status" className="text-sm text-warning">{notice}</p>}

      {accounts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-primary">No accounts yet</p>
          <p className="max-w-sm text-sm text-secondary">
            Add your first account to start tracking your real finances, or load demo data from the dashboard.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base"
          >
            Add account
          </button>
        </Card>
      ) : (
        GROUPS.map(({ title, types }) => {
          const group = accounts.filter((a) => (types as readonly string[]).includes(a.type));
          if (group.length === 0) return null;
          return (
            <section key={title} aria-label={title}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</h2>
              <div className="flex flex-col gap-3">
                {group.map((a) => {
                  const archived = a.archivedAt !== null;
                  const excluded = !a.includeInCalculations;
                  return (
                    <Card key={a.id} className={`flex flex-col gap-2 p-4 ${archived ? "opacity-70" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/transactions?account=${a.id}`}
                            className="block truncate text-sm font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {a.displayName}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-tertiary">
                            {[a.institution, a.mask ? `··${a.mask}` : null].filter(Boolean).join(" · ") || "Manual account"}
                          </p>
                        </div>
                        <p className="tabular shrink-0 text-sm font-semibold text-primary">
                          {a.currentBalance === null ? "—" : formatDollars(a.currentBalance)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={chipCls}>{a.provider}</span>
                        {excluded && <span className={chipCls}>Excluded</span>}
                        {archived && <span className={chipCls}>Archived</span>}
                      </div>
                      {(excluded || archived) && (
                        <p className="text-xs text-tertiary">
                          {archived
                            ? "Archived accounts and their transactions don’t affect your index. Unarchive to bring them back."
                            : "Excluded accounts don’t affect your index — their history is kept."}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {a.provider === "manual" && !archived && (
                          <button type="button" disabled={pending} onClick={() => setEditing(a)} className={actionCls}>
                            Edit
                          </button>
                        )}
                        {!archived && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => mutate(() => setAccountIncluded(a.id, excluded))}
                            className={actionCls}
                          >
                            {excluded ? "Include in index" : "Exclude from index"}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => mutate(() => setAccountArchived(a.id, !archived))}
                          className={actionCls}
                        >
                          {archived ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {accounts.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-20 z-10 flex items-center gap-2 rounded-full bg-positive-strong px-5 py-3 text-sm font-semibold text-base shadow-card"
        >
          <Plus size={18} aria-hidden /> Add account
        </button>
      )}

      <AccountSheet account={null} open={adding} onClose={() => setAdding(false)} />
      {editing && <AccountSheet key={editing.id} account={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: `src/app/accounts/AccountSheet.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet } from "@/components/ui/Sheet";
import { createAccount, updateAccount } from "@/app/actions/accounts";
import {
  accountSchema, ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountFormValues,
} from "@/lib/validation/transactions";
import type { AccountSummary } from "@/lib/data/mappers";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function AccountSheet({
  account,
  open,
  onClose,
}: {
  account: AccountSummary | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const {
    register, handleSubmit, watch, reset,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: account
      ? {
          displayName: account.displayName,
          type: account.type,
          institution: account.institution ?? undefined,
          currentBalance: account.currentBalance ?? 0,
          creditLimit: account.creditLimit ?? undefined,
          interestRate: account.interestRate ?? undefined,
        }
      : { type: "checking", currentBalance: 0 },
  });
  const type = watch("type");

  const submit = (values: AccountFormValues) => {
    setServerError(null);
    setWarning(null);
    startTransition(async () => {
      const result = account
        ? await updateAccount({ ...values, id: account.id })
        : await createAccount(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      reset();
      router.refresh();
      if (!result.warning) onClose();
    });
  };

  const optionalNumber = { setValueAs: (v: string) => (v === "" ? undefined : Number(v)) };

  return (
    <Sheet open={open} onClose={onClose} title={account ? "Edit account" : "Add account"}>
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="acct-name">Name</label>
        <input id="acct-name" className={inputCls} placeholder="House Checking" {...register("displayName")} />
        {errors.displayName && <p role="alert" className="text-xs text-negative">{errors.displayName.message}</p>}

        <label className={labelCls} htmlFor="acct-type">Type</label>
        <select id="acct-type" className={inputCls} {...register("type")}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <label className={labelCls} htmlFor="acct-institution">Institution (optional)</label>
        <input id="acct-institution" className={inputCls} placeholder="Pacific Bank" {...register("institution", { setValueAs: (v) => (v === "" ? undefined : v) })} />

        <label className={labelCls} htmlFor="acct-balance">Current balance ($)</label>
        <input
          id="acct-balance" type="number" step="0.01" min="0" inputMode="decimal"
          className={inputCls} {...register("currentBalance", { valueAsNumber: true })}
        />
        <p className="text-xs text-tertiary">
          Enter today’s balance. For loans and cards, enter the amount owed as a positive number.
        </p>
        {errors.currentBalance && <p role="alert" className="text-xs text-negative">{errors.currentBalance.message}</p>}

        {type === "credit_card" && (
          <>
            <label className={labelCls} htmlFor="acct-limit">Credit limit ($, optional)</label>
            <input id="acct-limit" type="number" step="1" min="0" inputMode="decimal" className={inputCls} {...register("creditLimit", optionalNumber)} />
          </>
        )}
        {(type === "credit_card" || type === "mortgage" || type === "auto_loan" || type === "student_loan" || type === "personal_loan") && (
          <>
            <label className={labelCls} htmlFor="acct-rate">Interest rate (%, optional)</label>
            <input id="acct-rate" type="number" step="0.01" min="0" inputMode="decimal" className={inputCls} {...register("interestRate", optionalNumber)} />
          </>
        )}

        {serverError && <p role="alert" className="text-sm text-negative">✕ {serverError}</p>}
        {warning && <p role="status" className="text-sm text-warning">⚠ {warning}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          {pending ? "Saving…" : account ? "Save changes" : "Add account"}
        </button>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 4: Dashboard wiring**

`src/components/dashboard/MetricCard.tsx` — add an optional link wrapper. Add `import Link from "next/link";`, add `href?: string` to `MetricCardProps`, and change the component body to:

```tsx
export function MetricCard({
  label, value, tone = "neutral", trend, trendDescription, footer, href,
}: MetricCardProps) {
  const card = (
    <Card
      className={`flex min-h-28 flex-col justify-between p-4 ${
        href ? "transition-colors hover:border-border-strong" : ""
      }`}
    >
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${toneText[tone]}`}>{value}</p>
      {trend && trend.length > 1 && (
        <>
          <Sparkline values={trend} tone={tone} />
          {trendDescription && <span className="sr-only">{trendDescription}</span>}
        </>
      )}
      {footer}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} aria-label={`${label}: ${value}. View details`} className="block rounded-card">
      {card}
    </Link>
  );
}
```

`src/components/dashboard/HomeDashboard.tsx` —
1. Add `href="/accounts"` to the Available Capital `MetricCard`.
2. Add `staleIndex` to the props: extend the component signature with `staleIndex?: boolean` (threaded from the page) and render, directly above the Key metrics `<section>`:

```tsx
{staleIndex && (
  <p role="status" className="rounded-card border border-border-subtle bg-elevated p-3 text-sm text-warning">
    ⚠ Index recalculation pending — recent data changes aren’t reflected in the chart yet. They’ll be picked up automatically.
  </p>
)}
```

`src/components/dashboard/WhatMovedYourLine.tsx` — add `import Link from "next/link";` and wrap each driver card:

```tsx
<li key={event.id}>
  <Link
    href={`/transactions?from=${event.date}&to=${event.date}&label=${encodeURIComponent(event.label)}`}
    aria-label={`${event.label}, ${formatSignedDollars(display.displayAmount)} on ${formatShortDate(event.date)}. View transactions`}
    className="block h-full"
  >
    <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-border-strong">
      {/* existing inner content unchanged: icon span, label, amount, date */}
    </Card>
  </Link>
</li>
```

`src/app/page.tsx` — self-heal and thread the flag. Replace the data-fetch line with:

```tsx
  let data = await getDashboardData(supabase);
  if (data.staleIndex) {
    // Idempotent reconciliation: a prior rebuild failed or was skipped. Safe in
    // a GET — rebuildSnapshots never calls revalidatePath and always converges.
    await rebuildSnapshots(supabase);
    data = await getDashboardData(supabase);
  }
  const { snapshots, events, staleIndex } = data;
```

with `import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";` added, and pass `staleIndex={staleIndex}` to `<HomeDashboard>`.

- [ ] **Step 5: Verify live (mobile-first)**

Run: `pnpm typecheck && pnpm lint && pnpm build`, then `pnpm dev` at 390×844 and 1280×900:
- Home → tap Available Capital → `/accounts`; tap a driver card → filtered `/transactions` with banner.
- `/accounts`: add a manual checking account with a balance → dashboard index shifts (rebuild ran); exclude it → index returns; archive it → hidden from transaction pickers.
- Add a manual transaction to the manual account → appears in list; delete it via the sheet.
- Recategorize a demo transaction → "corrected" chip; dashboard numbers unchanged.
- Keyboard: sheets close on Esc; all controls reachable by Tab.

- [ ] **Step 6: Commit**

```bash
git add src/app/accounts src/components/dashboard/MetricCard.tsx src/components/dashboard/WhatMovedYourLine.tsx src/components/dashboard/HomeDashboard.tsx src/app/page.tsx
git commit -m "feat: /accounts management screen, dashboard drill-down links, stale-index self-heal"
```

---

### Task 13: RLS tenant-isolation extension

**Files:**
- Modify: `scripts/test-rls.mts`

**Interfaces:**
- Consumes: existing `check()`, `a`/`b` users, and A's manual `acct` created earlier in the script.

- [ ] **Step 1: Add mutation-path checks**

After the script's existing checks (before cleanup), add:

```ts
  // ---- Manual-data slice: transaction mutation isolation ----
  const { data: aTxn, error: aTxnErr } = await a.client
    .from("transactions")
    .insert({
      account_id: acct!.id, user_id: a.id, posted_date: "2026-07-01",
      amount: 50, direction: "outflow", description: "RLS manual txn",
    })
    .select("id")
    .single();
  check("A can insert a transaction into own manual account", !aTxnErr && !!aTxn, aTxnErr?.message);

  const { error: aImmErr } = await a.client
    .from("transactions").update({ amount: 60 }).eq("id", aTxn!.id);
  check("A cannot edit frozen source columns (immutability trigger)", !!aImmErr);

  const { error: aOvErr } = await a.client
    .from("transactions").update({ user_override: { category: "other" } }).eq("id", aTxn!.id);
  check("A can write own user_override", !aOvErr, aOvErr?.message);

  const { data: bOv } = await b.client
    .from("transactions").update({ user_override: { category: "income" } }).eq("id", aTxn!.id).select("id");
  check("B cannot override A's transaction", (bOv ?? []).length === 0);

  const { data: bDel } = await b.client
    .from("transactions").delete().eq("id", aTxn!.id).select("id");
  check("B cannot delete A's transaction", (bDel ?? []).length === 0);

  const { data: bArch } = await b.client
    .from("financial_accounts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", acct!.id)
    .select("id");
  check("B cannot archive A's account", (bArch ?? []).length === 0);
```

(If the existing script's account variable is named differently than `acct`, use the actual name; it is the manual account A creates near the top.)

- [ ] **Step 2: Run against the live project**

Run: `pnpm test:rls`
Expected: all checks pass (existing 9 + new 6), exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-rls.mts
git commit -m "test: RLS isolation for transaction mutations and account archive"
```

---

### Task 14: Docs + final verification

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md`

- [ ] **Step 1: `docs/DECISIONS.md` — append entry #13**

```markdown
## 13. 2026-07-16 — Uniform override edit model; archive-not-delete accounts; manual txns only on manual accounts

**Decision:** all transaction edits — demo or manual — write `user_override` (category/description) or the mutable `notes` column; amount/date mistakes on manual transactions are fixed by delete + re-add. Accounts are archived (`archived_at`), never deleted. Manual transactions may only be created in `provider='manual'` accounts; imported (demo/csv) transactions can never be deleted. Snapshot rebuilds read source columns only, so overrides never move the index.
**Alternatives:** relaxing the 0002 immutability trigger for manual rows; hard-deleting accounts; allowing manual txns in demo accounts.
**Reasoning:** one provenance rule for every provider keeps the trigger untouched and the audit trail complete; account.provider stays the single source of a transaction's origin; archived accounts preserve history for past snapshots.
**Consequences:** recategorizing to/from `income` changes report groupings but not obligations or the index (v1 — revisit with the Phase 2 metric registry); manual edit UX for amount/date is delete + re-add.
```

- [ ] **Step 2: `docs/KNOWN_LIMITATIONS.md` — add a "Manual data (transactions/accounts slice)" section**

```markdown
## Manual data (transactions/accounts slice)

- **Amount/date corrections are delete + re-add** on manual transactions (source columns are frozen by design). Revisit if users hit it often.
- **Overrides never move the index (v1).** Recategorizing a transaction to/from `income` changes list/report groupings but not obligation windows or snapshots. The Phase 2 metric registry should decide whether corrections feed calculations.
- **Manual `current_balance` is authoritative.** Adding transactions reshapes history backward from the entered balance; it never changes today's balance — balance updates are an explicit account edit.
- **Snapshot rebuild is full-history and non-transactional** (delete + reinsert, O(days)). Fine at household volume; the stale-index notice plus rebuild-on-dashboard-load covers the failure window. The staleness proxy only detects transactions newer than the newest snapshot; older divergence is healed on the next mutation or dashboard load.
- **`snapshotToRow` still stamps `data_coverage_confidence: "demo"`** even for rebuilt mixed/manual data — confidence modeling is Phase 2.
- **Transaction list loads the full filtered window** (no DB pagination yet); month grouping is client-side.
```

- [ ] **Step 3: Update `docs/CURRENT_PHASE.md`**

Rewrite the header/sections to record: slice complete (transactions drill-down + accounts management, migration 0003, engine overrides/rebuild modules, RLS checks now 15), move "Manual accounts/transactions CRUD" out of Next-three-priorities, promote CSV import (Phase 3 remainder), demo profiles, and PWA/Playwright. Update the test counts to match reality (run the suite and copy the numbers), and set `_Last updated: 2026-07-16 (transactions/accounts slice)._`

- [ ] **Step 4: Update `docs/ROADMAP.md` Phase 3**

Change the Phase 3 heading line to note the landed slice:

```markdown
## Phase 3 — Manual data & CSV import (persistence live; manual CRUD slice landed 2026-07-16)
```

and in its body, mark manual accounts/transactions CRUD + correction workflow (category/description/notes via `user_override`) as done, leaving CSV import, recurring detection, transfers/splits/essential marking.

- [ ] **Step 5: Full verification**

Run: `pnpm check`
Expected: lint, typecheck, all tests, and build green.
Run: `pnpm test:rls`
Expected: 15/15.
Browser pass at 390×844 and 1280×900 over `/`, `/transactions`, `/accounts` (all four states: loading via throttling or reload, empty via filters/fresh user, error only if reproducible, partial via exclude/archive). Console clean on all three routes.

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/KNOWN_LIMITATIONS.md docs/CURRENT_PHASE.md docs/ROADMAP.md
git commit -m "docs: record transactions/accounts slice decisions, limitations, and phase status"
```
