# Statement Balance Anchoring & Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statement ending balances become balance anchors — entered in the CSV import wizard, reconciled against existing data, rolled forward by math — plus "as of" freshness labels and a staleness nudge.

**Architecture:** A new append-only `balance_anchors` table stores (date, balance) truth points; pure engine functions (`anchors.ts`, `staleness.ts`) compute the effective anchor, roll-forward balances, reconciliation discrepancies, and freshness. `rebuildSnapshots` keeps `financial_accounts.current_balance` mathematically consistent with the effective anchor on every mutation, so the snapshot builder itself needs **zero changes**. The import wizard gains an optional ending-balance card with live reconciliation; the dashboard gains a "Data current through" line and a dismissible staleness banner.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Supabase (Postgres/RLS), Vitest, Playwright, Tailwind 4, Zod, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-18-balance-anchoring-design.md` — read it before starting any task.

## Global Constraints

- `src/lib/financial-engine/` stays framework-free (no React/Next imports) and deterministic — never `Date.now()`/bare `new Date()`; "today" and timestamps are parameters. Server glue (actions, queries) may use wall-clock time.
- Bounded Supabase queries only: `paginateSelect` from `src/lib/data/paginate.ts` for growable tables (PostgREST silently caps unbounded selects at 1000 rows; see DECISIONS #21). `financial_accounts` and `user_profiles` single-row reads stay unpaginated per existing convention.
- Sign convention: anchor `balance` matches `financial_accounts.current_balance` — positive-owed for liability accounts. The liability sign logic lives ONLY in `snapshot-builder.ts`'s signed-net helper; never duplicate it.
- Anchor entry is encouraged, skippable — an import without a balance commits exactly as today. Reconciliation never blocks a commit.
- Staleness threshold: exactly **35 days** (`STALE_AFTER_DAYS`), for both banner appearance and dismissal reappearance.
- UI: mobile-first (~390px); state never communicated by color alone (icon/text pairing); no-shame copy — facts and actions, no guilt; every new surface keeps loading/empty/error handling.
- `pnpm check` green before any completion claim; `pnpm test:rls` after schema changes; `pnpm test:e2e` after UI changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine anchor math (`anchors.ts`)

**Files:**
- Modify: `src/lib/financial-engine/snapshot-builder.ts:58-62` (rename `dayDelta` → `signedNet`, export it)
- Create: `src/lib/financial-engine/anchors.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./anchors";`)
- Test: `src/lib/financial-engine/anchors.test.ts`

**Interfaces:**
- Consumes: `signedNet(account: AccountInput, txns: TransactionInput[]): number` (the renamed `dayDelta` — filters to the account internally, applies liability sign), `AccountInput`, `TransactionInput` from `./snapshot-builder`; `ISODate` from `./types`.
- Produces (Tasks 4–7 depend on these exact shapes):

```ts
export interface BalanceAnchor {
  accountId: string;
  anchorDate: ISODate;
  balance: number;
  createdAt: string; // ISO timestamp, tiebreak for same-date anchors
}
export function effectiveAnchor(anchors: BalanceAnchor[]): BalanceAnchor | null;
export function rollForwardBalance(account: AccountInput, anchorBalance: number, anchorDate: ISODate, transactions: TransactionInput[]): number;
export function derivedBalanceAt(account: AccountInput, anchor: { balance: number; anchorDate: ISODate }, date: ISODate, transactions: TransactionInput[]): number;
export function computeDiscrepancy(account: AccountInput, effective: { balance: number; anchorDate: ISODate } | null, enteredBalance: number, enteredDate: ISODate, transactions: TransactionInput[]): number | null;
```

- [ ] **Step 1: Rename `dayDelta` to `signedNet` and export it**

In `src/lib/financial-engine/snapshot-builder.ts`, change the function at ~line 58 (keep the body identical — only the name, export keyword, and doc comment change):

```ts
/** Signed net balance change for one account over any set of transactions
 * (filters to the account internally; liability accounts invert the sign —
 * an outflow purchase increases what you owe). The ONLY home of the
 * liability sign rule; anchors.ts reuses it, never re-implements it. */
export function signedNet(account: AccountInput, txns: TransactionInput[]): number {
```

Update its one internal call site (in the backward-replay loop, `dayDelta(a, dayTxns)` → `signedNet(a, dayTxns)`). Run `pnpm typecheck && pnpm vitest run src/lib/financial-engine/snapshot-builder.test.ts` — everything still green (pure rename).

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/financial-engine/anchors.test.ts
import { describe, expect, it } from "vitest";
import {
  computeDiscrepancy, derivedBalanceAt, effectiveAnchor, rollForwardBalance,
  type BalanceAnchor,
} from "./anchors";
import type { AccountInput, TransactionInput } from "./snapshot-builder";

const CHK: AccountInput = { id: "chk", type: "checking", currentBalance: 0, includeInCalculations: true };
const CARD: AccountInput = { id: "card", type: "credit_card", currentBalance: 0, includeInCalculations: true };

let seq = 0;
const txn = (t: Partial<TransactionInput> & { postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
  id: `t${seq++}`,
  accountId: "chk",
  description: "",
  category: null,
  essential: null,
  isTransfer: false,
  transferPairId: null,
  ...t,
});

const anchor = (a: Partial<BalanceAnchor> & { anchorDate: string; balance: number }): BalanceAnchor => ({
  accountId: "chk",
  createdAt: "2026-07-01T00:00:00Z",
  ...a,
});

describe("effectiveAnchor", () => {
  it("picks the greatest anchorDate", () => {
    const a = anchor({ anchorDate: "2026-06-30", balance: 100 });
    const b = anchor({ anchorDate: "2026-07-31", balance: 200 });
    expect(effectiveAnchor([a, b])).toBe(b);
    expect(effectiveAnchor([b, a])).toBe(b);
  });

  it("breaks same-date ties by latest createdAt", () => {
    const first = anchor({ anchorDate: "2026-07-31", balance: 100, createdAt: "2026-08-01T10:00:00Z" });
    const second = anchor({ anchorDate: "2026-07-31", balance: 150, createdAt: "2026-08-01T11:00:00Z" });
    expect(effectiveAnchor([first, second])).toBe(second);
  });

  it("returns null for no anchors", () => {
    expect(effectiveAnchor([])).toBeNull();
  });
});

describe("rollForwardBalance", () => {
  it("adds post-anchor net for asset accounts, ignoring on-or-before-anchor txns", () => {
    const txns = [
      txn({ postedDate: "2026-07-31", amount: 999, direction: "outflow" }), // on anchor date — excluded
      txn({ postedDate: "2026-08-05", amount: 100, direction: "outflow" }),
      txn({ postedDate: "2026-08-10", amount: 250.5, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", txns)).toBe(1650.5);
  });

  it("inverts the sign for liability accounts (purchase raises owed, payment lowers it)", () => {
    const txns = [
      txn({ accountId: "card", postedDate: "2026-08-03", amount: 80, direction: "outflow" }),
      txn({ accountId: "card", postedDate: "2026-08-10", amount: 200, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CARD, 500, "2026-07-31", txns)).toBe(380);
  });

  it("ignores other accounts' transactions and handles empty history", () => {
    const txns = [txn({ accountId: "other", postedDate: "2026-08-05", amount: 100, direction: "inflow" })];
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", txns)).toBe(1500);
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", [])).toBe(1500);
  });

  it("rounds to cents", () => {
    const txns = [
      txn({ postedDate: "2026-08-01", amount: 0.1, direction: "inflow" }),
      txn({ postedDate: "2026-08-02", amount: 0.2, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CHK, 0, "2026-07-31", txns)).toBe(0.3);
  });
});

describe("derivedBalanceAt", () => {
  const a = { balance: 1500, anchorDate: "2026-07-31" };

  it("rolls forward when the date is after the anchor", () => {
    const txns = [txn({ postedDate: "2026-08-05", amount: 100, direction: "outflow" })];
    expect(derivedBalanceAt(CHK, a, "2026-08-10", txns)).toBe(1400);
  });

  it("backs transactions out when the date is before the anchor", () => {
    const txns = [
      txn({ postedDate: "2026-07-15", amount: 2000, direction: "inflow" }),
      txn({ postedDate: "2026-07-20", amount: 300, direction: "outflow" }),
    ];
    // At 07-10 the +2000/-300 hadn't happened yet: 1500 - (2000 - 300) = -200.
    expect(derivedBalanceAt(CHK, a, "2026-07-10", txns)).toBe(-200);
  });

  it("equals the anchor balance on the anchor date itself", () => {
    const txns = [txn({ postedDate: "2026-07-31", amount: 50, direction: "inflow" })];
    // On-date txns are inside the anchor's own truth — not re-applied.
    expect(derivedBalanceAt(CHK, a, "2026-07-31", txns)).toBe(1500);
  });
});

describe("computeDiscrepancy", () => {
  it("returns null when there is no prior anchor", () => {
    expect(computeDiscrepancy(CHK, null, 1600, "2026-07-31", [])).toBeNull();
  });

  it("returns entered minus derived", () => {
    const eff = { balance: 1000, anchorDate: "2026-06-30" };
    const txns = [txn({ postedDate: "2026-07-10", amount: 500, direction: "inflow" })];
    // Derived at 07-31 = 1000 + 500 = 1500; entered 1600 → +100 unexplained.
    expect(computeDiscrepancy(CHK, eff, 1600, "2026-07-31", txns)).toBe(100);
  });

  it("returns 0 when the statement reconciles cleanly", () => {
    const eff = { balance: 1000, anchorDate: "2026-06-30" };
    const txns = [txn({ postedDate: "2026-07-10", amount: 500, direction: "inflow" })];
    expect(computeDiscrepancy(CHK, eff, 1500, "2026-07-31", txns)).toBe(0);
  });

  it("reconciles a back-filled statement dated before the effective anchor", () => {
    const eff = { balance: 1500, anchorDate: "2026-07-31" };
    const txns = [txn({ postedDate: "2026-07-15", amount: 2000, direction: "inflow" })];
    // Derived at 06-30 = 1500 - 2000 = -500; entered -500 → clean.
    expect(computeDiscrepancy(CHK, eff, -500, "2026-06-30", txns)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/anchors.test.ts`
Expected: FAIL — cannot resolve `./anchors`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/financial-engine/anchors.ts
import type { ISODate } from "./types";
import { signedNet, type AccountInput, type TransactionInput } from "./snapshot-builder";

/** One (date, balance) truth point for an account. Balance uses the same
 * sign convention as financial_accounts.current_balance (positive-owed for
 * liabilities). Rows are append-only provenance; effectiveAnchor picks the
 * one the engine trusts. */
export interface BalanceAnchor {
  accountId: string;
  anchorDate: ISODate;
  balance: number;
  createdAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The anchor the engine trusts: greatest anchorDate, tiebreak latest
 * createdAt. A back-filled older statement stores its anchor (and still
 * reconciles) without superseding a newer one. */
export function effectiveAnchor(anchors: BalanceAnchor[]): BalanceAnchor | null {
  let best: BalanceAnchor | null = null;
  for (const a of anchors) {
    if (
      best === null ||
      a.anchorDate > best.anchorDate ||
      (a.anchorDate === best.anchorDate && a.createdAt > best.createdAt)
    ) {
      best = a;
    }
  }
  return best;
}

/** Anchor balance plus the net effect of the account's transactions dated
 * strictly after the anchor. The anchor's own date is inside its truth —
 * a statement's ending balance already reflects everything through close. */
export function rollForwardBalance(
  account: AccountInput,
  anchorBalance: number,
  anchorDate: ISODate,
  transactions: TransactionInput[],
): number {
  const after = transactions.filter((t) => t.postedDate > anchorDate);
  return round2(anchorBalance + signedNet(account, after));
}

/** Balance at any date D, derived from an anchor — direction-agnostic:
 * transactions between the anchor and D are added when D is after the
 * anchor, backed out when D is before it (the back-filled-statement case). */
export function derivedBalanceAt(
  account: AccountInput,
  anchor: { balance: number; anchorDate: ISODate },
  date: ISODate,
  transactions: TransactionInput[],
): number {
  if (date >= anchor.anchorDate) {
    const between = transactions.filter((t) => t.postedDate > anchor.anchorDate && t.postedDate <= date);
    return round2(anchor.balance + signedNet(account, between));
  }
  const between = transactions.filter((t) => t.postedDate > date && t.postedDate <= anchor.anchorDate);
  return round2(anchor.balance - signedNet(account, between));
}

/** Reconciliation: entered statement balance minus what the effective anchor
 * plus known transactions say that date's balance should be. Positive means
 * unexplained money appeared; negative, unexplained money left. Null when
 * there is no prior anchor to reconcile against. */
export function computeDiscrepancy(
  account: AccountInput,
  effective: { balance: number; anchorDate: ISODate } | null,
  enteredBalance: number,
  enteredDate: ISODate,
  transactions: TransactionInput[],
): number | null {
  if (!effective) return null;
  return round2(enteredBalance - derivedBalanceAt(account, effective, enteredDate, transactions));
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./anchors";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/anchors.test.ts && pnpm typecheck && pnpm test`
Expected: new tests PASS; full suite stays green (275 + 14 new = 289).

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/anchors.ts src/lib/financial-engine/anchors.test.ts src/lib/financial-engine/snapshot-builder.ts src/lib/financial-engine/index.ts
git commit -m "feat(engine): balance-anchor math — effective anchor, roll-forward, reconciliation"
```

---

### Task 2: Engine staleness functions (`staleness.ts`)

**Files:**
- Create: `src/lib/financial-engine/staleness.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./staleness";`)
- Test: `src/lib/financial-engine/staleness.test.ts`

**Interfaces:**
- Consumes: `daysBetween` from `./snapshot-builder`; `ISODate` from `./types`.
- Produces (Tasks 6 and 8 depend on these):

```ts
export const STALE_AFTER_DAYS = 35;
export interface AccountFreshnessInput {
  id: string;
  provider: string;               // "demo" excluded from staleness
  includeInCalculations: boolean;
  archived: boolean;
  anchorDate: ISODate | null;     // effective anchor date
  newestTxnDate: ISODate | null;  // fallback freshness
}
export function accountFreshness(a: AccountFreshnessInput): ISODate | null;
export function householdFreshness(accounts: AccountFreshnessInput[]): ISODate | null;
export function isStale(freshness: ISODate | null, today: ISODate): boolean;
export function nudgeVisible(freshness: ISODate | null, today: ISODate, dismissedOn: ISODate | null): boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/financial-engine/staleness.test.ts
import { describe, expect, it } from "vitest";
import {
  accountFreshness, householdFreshness, isStale, nudgeVisible,
  STALE_AFTER_DAYS, type AccountFreshnessInput,
} from "./staleness";

const acct = (a: Partial<AccountFreshnessInput> & { id: string }): AccountFreshnessInput => ({
  provider: "manual",
  includeInCalculations: true,
  archived: false,
  anchorDate: null,
  newestTxnDate: null,
  ...a,
});

describe("accountFreshness", () => {
  it("prefers the anchor date over the newest transaction date", () => {
    // The anchor is the verified point; newer unanchored txns don't count as "verified through".
    expect(accountFreshness(acct({ id: "a", anchorDate: "2026-07-31", newestTxnDate: "2026-08-05" }))).toBe("2026-07-31");
  });
  it("falls back to newest transaction date, then null", () => {
    expect(accountFreshness(acct({ id: "a", newestTxnDate: "2026-06-15" }))).toBe("2026-06-15");
    expect(accountFreshness(acct({ id: "a" }))).toBeNull();
  });
});

describe("householdFreshness", () => {
  it("is the OLDEST freshness across included, non-archived, non-demo accounts", () => {
    const accounts = [
      acct({ id: "a", anchorDate: "2026-07-31" }),
      acct({ id: "b", anchorDate: "2026-06-30" }),
    ];
    expect(householdFreshness(accounts)).toBe("2026-06-30");
  });

  it("excludes demo, excluded, and archived accounts", () => {
    const accounts = [
      acct({ id: "a", anchorDate: "2026-07-31" }),
      acct({ id: "demo", provider: "demo", anchorDate: "2026-01-01" }),
      acct({ id: "excl", includeInCalculations: false, anchorDate: "2026-01-01" }),
      acct({ id: "arch", archived: true, anchorDate: "2026-01-01" }),
    ];
    expect(householdFreshness(accounts)).toBe("2026-07-31");
  });

  it("skips accounts with no freshness rather than treating them as infinitely stale", () => {
    expect(householdFreshness([acct({ id: "new" }), acct({ id: "a", anchorDate: "2026-07-01" })])).toBe("2026-07-01");
  });

  it("returns null for demo-only households", () => {
    expect(householdFreshness([acct({ id: "d", provider: "demo", anchorDate: "2026-06-01" })])).toBeNull();
  });
});

describe("isStale", () => {
  it("uses the exact 35-day threshold", () => {
    expect(STALE_AFTER_DAYS).toBe(35);
    expect(isStale("2026-06-13", "2026-07-18")).toBe(false); // exactly 35 days — not yet stale
    expect(isStale("2026-06-12", "2026-07-18")).toBe(true);  // 36 days
    expect(isStale(null, "2026-07-18")).toBe(false);         // no data = no nag
  });
});

describe("nudgeVisible", () => {
  const stale = "2026-05-01";
  const today = "2026-07-18";
  it("shows when stale and never dismissed", () => {
    expect(nudgeVisible(stale, today, null)).toBe(true);
  });
  it("hides for 35 days after dismissal, then returns", () => {
    expect(nudgeVisible(stale, today, "2026-07-01")).toBe(false); // 17 days ago
    expect(nudgeVisible(stale, today, "2026-06-01")).toBe(true);  // 47 days ago
  });
  it("never shows when fresh, regardless of dismissal state", () => {
    expect(nudgeVisible("2026-07-10", today, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/staleness.test.ts`
Expected: FAIL — cannot resolve `./staleness`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/financial-engine/staleness.ts
import type { ISODate } from "./types";
import { daysBetween } from "./snapshot-builder";

/** One statement cycle plus slack. Governs both banner appearance and
 * how long a dismissal suppresses it. */
export const STALE_AFTER_DAYS = 35;

export interface AccountFreshnessInput {
  id: string;
  provider: string;
  includeInCalculations: boolean;
  archived: boolean;
  anchorDate: ISODate | null;
  newestTxnDate: ISODate | null;
}

/** How current this account's data verifiably is: the effective anchor date
 * (the verified point), falling back to the newest transaction date. */
export function accountFreshness(a: AccountFreshnessInput): ISODate | null {
  return a.anchorDate ?? a.newestTxnDate ?? null;
}

/** The household is only as fresh as its least-fresh scoring input: the
 * OLDEST freshness across included, non-archived, non-demo accounts.
 * Demo data has fixed end dates and must never trip wall-clock staleness. */
export function householdFreshness(accounts: AccountFreshnessInput[]): ISODate | null {
  const dates = accounts
    .filter((a) => a.provider !== "demo" && a.includeInCalculations && !a.archived)
    .map(accountFreshness)
    .filter((d): d is ISODate => d !== null);
  if (dates.length === 0) return null;
  return dates.reduce((m, d) => (d < m ? d : m));
}

export function isStale(freshness: ISODate | null, today: ISODate): boolean {
  return freshness !== null && daysBetween(freshness, today) > STALE_AFTER_DAYS;
}

/** Banner rule: stale, and either never dismissed or dismissed more than a
 * full cycle ago. Clears automatically when fresh data arrives (freshness
 * moves forward, isStale flips false). */
export function nudgeVisible(
  freshness: ISODate | null,
  today: ISODate,
  dismissedOn: ISODate | null,
): boolean {
  if (!isStale(freshness, today)) return false;
  if (dismissedOn !== null && daysBetween(dismissedOn, today) <= STALE_AFTER_DAYS) return false;
  return true;
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./staleness";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/staleness.test.ts && pnpm typecheck && pnpm test`
Expected: PASS; full suite 289 + 10 = 299.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/staleness.ts src/lib/financial-engine/staleness.test.ts src/lib/financial-engine/index.ts
git commit -m "feat(engine): freshness and staleness-nudge rules with 35-day cycle"
```

---

### Task 3: Migration `0007_balance_anchors` + RLS tests

**Files:**
- Create: `supabase/migrations/0007_balance_anchors.sql`
- Modify: `scripts/test-rls.mts` (5 new checks)

**Interfaces:**
- Produces: table `public.balance_anchors` (columns per spec), owner-only RLS; `user_profiles.stale_nudge_dismissed_at timestamptz` (nullable). Tasks 4–6 read/write these.

- [ ] **Step 1: Write the migration**

```sql
-- 0007_balance_anchors.sql
-- Statement balance anchoring (docs/superpowers/specs/2026-07-18-balance-anchoring-design.md).
-- One row per anchoring event — a statement's ending balance entered at
-- import, or a manual balance edit. Append-only provenance: app code never
-- updates rows, and deletes only via batch undo removing its own anchor.
-- The engine trusts the "effective anchor" (greatest anchor_date, tiebreak
-- created_at); discrepancy records the reconciliation result at creation
-- (null = no prior anchor to reconcile against, 0 = clean).

create table public.balance_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete cascade,
  anchor_date date not null,
  balance numeric(14,2) not null,
  source text not null check (source in ('manual', 'import')),
  import_batch_id uuid,
  discrepancy numeric(14,2),
  created_at timestamptz not null default now()
);

create index balance_anchors_account_idx on public.balance_anchors (account_id, anchor_date desc);

alter table public.balance_anchors enable row level security;

create policy "own_select" on public.balance_anchors for select using (auth.uid() = user_id);
create policy "own_insert" on public.balance_anchors for insert with check (auth.uid() = user_id);
create policy "own_update" on public.balance_anchors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.balance_anchors for delete using (auth.uid() = user_id);

-- Staleness-nudge dismissal (docs spec §4): cleared implicitly by fresh data,
-- re-shown 35 days after dismissal while still stale.
alter table public.user_profiles
  add column stale_nudge_dismissed_at timestamptz;
```

- [ ] **Step 2: Apply to the linked Supabase project**

Run: `supabase db push`
Expected: `0007_balance_anchors.sql` applied cleanly. (CLI is installed; the project links on first use in a fresh worktree — `supabase link --project-ref dgkcmvjfvdlsyuhuewkx` matches `supabase/config.toml` if prompted.)

- [ ] **Step 3: Add RLS checks**

In `scripts/test-rls.mts`, after the `recurring_overrides` block (follow the file's `check(name, ok, detail)` pattern and its two-user `a`/`b` setup; `aAccountId` is the account user A created earlier in the script — reuse the existing variable name for A's account, reading the file to confirm it):

```ts
// ---- Balance anchoring slice: balance_anchors isolation ----
const { error: baInsertOwn } = await a.client.from("balance_anchors")
  .insert({ user_id: a.id, account_id: aAccountId, anchor_date: "2026-07-31", balance: 1500, source: "manual" });
check("balance_anchors: owner can insert", !baInsertOwn, baInsertOwn?.message ?? "");

const { data: baCrossRead } = await b.client.from("balance_anchors").select("id");
check("balance_anchors: cross-user read returns nothing", (baCrossRead ?? []).length === 0);

const { error: baForge } = await b.client.from("balance_anchors")
  .insert({ user_id: a.id, account_id: aAccountId, anchor_date: "2026-07-31", balance: 9999, source: "manual" });
check("balance_anchors: cross-user insert rejected", !!baForge);

await b.client.from("balance_anchors")
  .update({ balance: 0 }).eq("user_id", a.id);
const { data: baAfter } = await a.client.from("balance_anchors")
  .select("balance").eq("account_id", aAccountId).single();
check("balance_anchors: cross-user update is a no-op", Number(baAfter?.balance) === 1500);

const { error: baDeleteOwn } = await a.client.from("balance_anchors")
  .delete().eq("user_id", a.id).eq("account_id", aAccountId);
check("balance_anchors: owner can delete", !baDeleteOwn, baDeleteOwn?.message ?? "");
```

- [ ] **Step 4: Run the RLS suite**

Run: `pnpm test:rls`
Expected: 29/29 (24 existing + 5 new), all passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_balance_anchors.sql scripts/test-rls.mts
git commit -m "feat(db): balance_anchors table with owner-only RLS; stale-nudge dismissal column"
```

---

### Task 4: Anchor-aware balance refresh in `rebuildSnapshots`

Every mutation path (import commit, batch undo, manual transaction add/delete, account edits) already funnels through `finishWithRebuild` → `rebuildSnapshots`. Teaching the rebuild to correct `current_balance` from the effective anchor covers all of them with one change — and the snapshot builder itself stays untouched.

**Files:**
- Modify: `src/lib/data/rebuild-snapshots.ts`

**Interfaces:**
- Consumes: `effectiveAnchor`, `rollForwardBalance`, `type BalanceAnchor` from `@/lib/financial-engine` (Task 1); table `balance_anchors` (Task 3).
- Produces: `rebuildSnapshots` now persists anchor-consistent `current_balance` values before building snapshots. No signature change.

- [ ] **Step 1: Add the anchors fetch**

In `src/lib/data/rebuild-snapshots.ts`, extend the imports:

```ts
import {
  buildDailySnapshots, deriveRebuildConfig, effectiveAnchor, rollForwardBalance,
  type AccountInput, type AccountType, type BalanceAnchor, type RecurringOverride,
} from "@/lib/financial-engine";
```

Add a fifth leg to the existing `Promise.all` (binding it as `anchorRows`):

```ts
paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(PAGE_SIZE, (from, to) =>
  supabase.from("balance_anchors")
    .select("account_id, anchor_date, balance, created_at")
    .order("id", { ascending: true })
    .range(from, to)),
```

- [ ] **Step 2: Correct balances from effective anchors before building**

After the `transactions` array is built and before `deriveRebuildConfig` is called, insert:

```ts
// Anchor-aware balance refresh: for accounts with balance anchors, the
// stored current_balance is DERIVED — effective anchor rolled forward
// through transactions after the anchor date. Correcting it here (inside
// the rebuild every mutation already triggers) keeps the snapshot
// builder's backward replay anchored on a true value, with zero changes
// to the builder itself. Accounts without anchors keep legacy behavior:
// their hand-typed balance stays authoritative.
const anchorsByAccount = new Map<string, BalanceAnchor[]>();
for (const r of anchorRows) {
  const list = anchorsByAccount.get(r.account_id) ?? [];
  list.push({
    accountId: r.account_id,
    anchorDate: r.anchor_date,
    balance: Number(r.balance),
    createdAt: r.created_at,
  });
  anchorsByAccount.set(r.account_id, list);
}
for (const a of accounts) {
  const eff = effectiveAnchor(anchorsByAccount.get(a.id) ?? []);
  if (!eff) continue;
  const corrected = rollForwardBalance(a, eff.balance, eff.anchorDate, transactions);
  if (corrected !== a.currentBalance) {
    const { error: balErr } = await supabase.from("financial_accounts")
      .update({ current_balance: corrected }).eq("id", a.id);
    if (balErr) throw new Error(balErr.message);
    a.currentBalance = corrected;
  }
}
```

Also update the function's doc comment: add one sentence — "For accounts with balance anchors, `current_balance` is corrected from the effective anchor before building (DECISIONS #24); anchorless accounts keep their hand-typed balance."

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: green. (No new unit tests here: the math is Task 1's tested engine functions; this is fetch-and-apply glue, verified live in Task 10 and by Task 9's e2e round-trip. Existing tests pass unchanged because no account has anchor rows in any fixture.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/rebuild-snapshots.ts
git commit -m "feat(server): rebuild corrects current_balance from the effective balance anchor"
```

---

### Task 5: Import server path — anchor at commit, undo removes it

**Files:**
- Modify: `src/lib/validation/imports.ts`
- Modify: `src/app/actions/imports.ts` (`importTransactions`, `undoImport`)

**Interfaces:**
- Consumes: `computeDiscrepancy`, `effectiveAnchor`, `type BalanceAnchor`, `type AccountInput`, `type AccountType`, `type TransactionInput` from `@/lib/financial-engine`; `paginateSelect`.
- Produces: `importTransactionsSchema` accepts optional `endingBalance: number` + `anchorDate: string` (both-or-neither); `ImportResult` gains `anchorDate?: string; anchoredBalance?: number; discrepancy?: number | null`. Task 7's wizard sends and displays these.

- [ ] **Step 1: Extend the validation schema**

In `src/lib/validation/imports.ts`, extend `importTransactionsSchema` (the `isoDate`/`notFuture` helpers already exist at the top of the file):

```ts
export const importTransactionsSchema = z
  .object({
    accountId: z.uuid(),
    rows: z.array(importRowSchema).min(1, "Nothing to import").max(10_000, "Too many rows (max 10,000)"),
    transferPairs: z.array(z.object({ line: z.number().int().min(2), existingId: z.uuid() })).max(2_000),
    endingBalance: z
      .number()
      .min(-10_000_000)
      .max(10_000_000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts use at most 2 decimals")
      .optional(),
    anchorDate: isoDate.refine(notFuture, "Date can't be in the future").optional(),
  })
  .refine((v) => (v.endingBalance === undefined) === (v.anchorDate === undefined), {
    message: "Ending balance and its date go together",
  });
```

(Note: `endingBalance` allows negative values — an overdrawn checking account's statement legitimately ends below zero.)

Extend `ImportResult`:

```ts
export interface ImportResult {
  error: string;
  warning?: string;
  batchId?: string;
  imported?: number;
  skippedDuplicates?: number;
  anchorDate?: string;
  anchoredBalance?: number;
  discrepancy?: number | null;
}
```

- [ ] **Step 2: Anchor at commit in `importTransactions`**

In `src/app/actions/imports.ts`:

Add to imports:

```ts
import {
  computeDiscrepancy, effectiveAnchor,
  type AccountInput, type AccountType, type BalanceAnchor, type TransactionInput,
} from "@/lib/financial-engine";
```

Change the account select to also fetch `type` (needed for liability sign math):

```ts
    .select("id, provider, type, archived_at")
```

After the successful `insertChunked` (immediately before the existing `const finish = await finishWithRebuild(supabase);` line), insert:

```ts
  // Statement anchor (optional): server-side reconciliation over existing +
  // just-inserted rows — the client's preview math is advisory. The anchor
  // row is provenance; the rebuild below derives current_balance from it.
  let anchorFacts: Pick<ImportResult, "anchorDate" | "anchoredBalance" | "discrepancy"> = {};
  if (v.endingBalance !== undefined && v.anchorDate !== undefined) {
    let priorAnchors: BalanceAnchor[] = [];
    try {
      const anchorRows = await paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
        EXISTING_TXN_PAGE_SIZE,
        (from, to) =>
          supabase.from("balance_anchors")
            .select("account_id, anchor_date, balance, created_at")
            .eq("account_id", v.accountId)
            .order("id", { ascending: true })
            .range(from, to),
      );
      priorAnchors = anchorRows.map((r) => ({
        accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at,
      }));
    } catch (e) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: finish.warning ?? `Imported, but the balance anchor could not be saved: ${e instanceof Error ? e.message : "anchor lookup failed"}`,
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }

    const acctForMath: AccountInput = {
      id: v.accountId, type: account.type as AccountType, currentBalance: 0, includeInCalculations: true,
    };
    const mathTxns: TransactionInput[] = [
      ...existing
        .filter((t) => t.accountId === v.accountId)
        .map((t) => ({
          id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount,
          direction: t.direction, description: t.description, category: null,
          essential: null, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
        })),
      ...inserts.map((r, i) => ({
        id: `pending-${i}`, accountId: r.account_id, postedDate: r.posted_date, amount: r.amount,
        direction: r.direction as "inflow" | "outflow", description: r.description, category: null,
        essential: null, isTransfer: r.is_transfer, transferPairId: null,
      })),
    ];
    const eff = effectiveAnchor(priorAnchors);
    const discrepancy = computeDiscrepancy(acctForMath, eff, v.endingBalance, v.anchorDate, mathTxns);

    const { error: anchorInsErr } = await supabase.from("balance_anchors").insert({
      user_id: user.id, account_id: v.accountId, anchor_date: v.anchorDate,
      balance: v.endingBalance, source: "import", import_batch_id: batchId, discrepancy,
    });
    if (anchorInsErr) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: finish.warning ?? `Imported, but the balance anchor could not be saved: ${anchorInsErr.message}`,
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }
    anchorFacts = { anchorDate: v.anchorDate, anchoredBalance: v.endingBalance, discrepancy };
  }
```

And change the final return to include the anchor facts:

```ts
  const finish = await finishWithRebuild(supabase);
  return { ...finish, ...anchorFacts, batchId, imported: inserts.length, skippedDuplicates };
```

- [ ] **Step 3: Undo removes the batch's anchor**

In `undoImport`, after the transaction delete succeeds (the `deleted.length === 0` guard has passed) and before `finishWithRebuild`:

```ts
  // The batch's anchor (if any) claims a statement that no longer exists in
  // the data — remove it; the rebuild re-derives current_balance from the
  // remaining effective anchor.
  const { error: anchorDelErr } = await supabase
    .from("balance_anchors")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("user_id", user.id);
  if (anchorDelErr) return { error: anchorDelErr.message };
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: green. (Server glue over Task 1's tested math; exercised end-to-end by Task 9's e2e and Task 10's live QA, matching this codebase's convention for action-layer code.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/imports.ts src/app/actions/imports.ts
git commit -m "feat(server): import commit stores a reconciled balance anchor; undo removes it"
```

---

### Task 6: Manual anchors, freshness query, dismiss action, import context

**Files:**
- Modify: `src/app/actions/accounts.ts` (`createAccount`, `updateAccount`)
- Create: `src/app/actions/profile.ts` (`dismissStaleNudge`)
- Modify: `src/lib/data/queries.ts` (`getImportContext` extension; new `getFreshnessData`)

**Interfaces:**
- Consumes: `effectiveAnchor`, `accountFreshness`, `householdFreshness`, `nudgeVisible`, `type BalanceAnchor`, `type AccountFreshnessInput` from `@/lib/financial-engine`.
- Produces (Tasks 7–8 depend on these):
  - `getImportContext` return type gains `anchors: Record<string, { anchorDate: string; balance: number }>` (effective anchor per account).
  - `getFreshnessData(supabase): Promise<FreshnessData>` where `export interface FreshnessData { currentThrough: string | null; showNudge: boolean; asOfByAccount: Record<string, string>; }`
  - `dismissStaleNudge(): Promise<{ error: string }>`

- [ ] **Step 1: Manual anchor on account create**

In `src/app/actions/accounts.ts`, `createAccount`: change the insert to return the new id, then record the anchor. Replace the insert block with:

```ts
  const { data: created, error: insertErr } = await supabase
    .from("financial_accounts")
    .insert({
      user_id: user.id, provider: "manual", type: v.type, display_name: v.displayName,
      institution: v.institution || null, current_balance: v.currentBalance,
      credit_limit: v.creditLimit ?? null, interest_rate: v.interestRate ?? null,
    })
    .select("id")
    .single();
  if (insertErr) return { error: insertErr.message };

  // The typed starting balance is the account's first anchor (dated today).
  // Anchor failure degrades to legacy anchorless behavior, not a lost account.
  const { error: anchorErr } = await supabase.from("balance_anchors").insert({
    user_id: user.id, account_id: created.id, anchor_date: new Date().toISOString().slice(0, 10),
    balance: v.currentBalance, source: "manual",
  });

  const finish = await finishWithRebuild(supabase);
  if (anchorErr) return { ...finish, warning: finish.warning ?? `Account saved, but its balance anchor wasn't recorded: ${anchorErr.message}` };
  return finish;
```

- [ ] **Step 2: Manual anchor on balance change in `updateAccount`**

Change the pre-update fetch to include the stored balance:

```ts
    .from("financial_accounts").select("id, provider, current_balance").eq("id", v.id).maybeSingle();
```

After the successful `.update(...)` and before `finishWithRebuild`, insert:

```ts
  // A changed balance is a fresh manual anchor dated today. A rename-only
  // edit (balance unchanged) is not — and deliberately doesn't refresh
  // freshness, since the user re-typed, not re-verified, the number.
  if (v.currentBalance !== Number(account.current_balance)) {
    const { error: anchorErr } = await supabase.from("balance_anchors").insert({
      user_id: user.id, account_id: v.id, anchor_date: new Date().toISOString().slice(0, 10),
      balance: v.currentBalance, source: "manual",
    });
    if (anchorErr) {
      const finish = await finishWithRebuild(supabase);
      return { ...finish, warning: finish.warning ?? `Saved, but the balance anchor wasn't recorded: ${anchorErr.message}` };
    }
  }
```

- [ ] **Step 3: Create the dismiss action**

```ts
// src/app/actions/profile.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Snooze the staleness banner. It returns on its own if the data is still
 * stale a full cycle (35 days) later — see nudgeVisible in the engine. */
export async function dismissStaleNudge(): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_profiles")
    .update({ stale_nudge_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: "" };
}
```

- [ ] **Step 4: Extend `getImportContext` with effective anchors**

In `src/lib/data/queries.ts`, add `effectiveAnchor`/`BalanceAnchor` to the `@/lib/financial-engine` import. Change `getImportContext`'s signature and body: add a third `Promise.all` leg and compute per-account effective anchors:

```ts
export async function getImportContext(
  supabase: SupabaseClient,
): Promise<{ accounts: AccountSummary[]; existing: ExistingTxn[]; anchors: Record<string, { anchorDate: string; balance: number }> }> {
```

Third leg in the `Promise.all` (bind as `anchorRows`):

```ts
    paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
      TRANSACTIONS_PAGE_SIZE,
      (from, to) =>
        supabase.from("balance_anchors")
          .select("account_id, anchor_date, balance, created_at")
          .order("id", { ascending: true })
          .range(from, to)),
```

Before the return, compute and include:

```ts
  const anchorsByAccount = new Map<string, BalanceAnchor[]>();
  for (const r of anchorRows) {
    const list = anchorsByAccount.get(r.account_id) ?? [];
    list.push({ accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at });
    anchorsByAccount.set(r.account_id, list);
  }
  const anchors: Record<string, { anchorDate: string; balance: number }> = {};
  for (const [accountId, list] of anchorsByAccount) {
    const eff = effectiveAnchor(list);
    if (eff) anchors[accountId] = { anchorDate: eff.anchorDate, balance: eff.balance };
  }
  return { accounts, existing, anchors };
```

(`src/app/import/page.tsx` passes context to the wizard — update its destructuring/props in Task 7.)

- [ ] **Step 5: Add `getFreshnessData`**

Append to `src/lib/data/queries.ts` (add `accountFreshness`, `householdFreshness`, `nudgeVisible`, `type AccountFreshnessInput` to the engine import):

```ts
export interface FreshnessData {
  currentThrough: string | null;
  showNudge: boolean;
  asOfByAccount: Record<string, string>;
}

/** Freshness of the user's real (non-demo) data: per-account "as of" dates,
 * the household's weakest-link date, and whether the staleness nudge shows.
 * Wall-clock "today" is supplied here — the engine functions stay pure. */
export async function getFreshnessData(supabase: SupabaseClient): Promise<FreshnessData> {
  const [acctRes, anchorRows, txnRows, profRes] = await Promise.all([
    supabase.from("financial_accounts").select("id, provider, include_in_calculations, archived_at"),
    paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
      TRANSACTIONS_PAGE_SIZE,
      (from, to) =>
        supabase.from("balance_anchors")
          .select("account_id, anchor_date, balance, created_at")
          .order("id", { ascending: true })
          .range(from, to)),
    paginateSelect<{ account_id: string; posted_date: string }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("account_id, posted_date")
        .order("id", { ascending: true })
        .range(from, to)),
    supabase.from("user_profiles").select("stale_nudge_dismissed_at").maybeSingle(),
  ]);
  if (acctRes.error) throw acctRes.error;
  if (profRes.error) throw profRes.error;

  const newestTxn = new Map<string, string>();
  for (const t of txnRows) {
    const cur = newestTxn.get(t.account_id);
    if (!cur || t.posted_date > cur) newestTxn.set(t.account_id, t.posted_date);
  }
  const anchorsByAccount = new Map<string, BalanceAnchor[]>();
  for (const r of anchorRows) {
    const list = anchorsByAccount.get(r.account_id) ?? [];
    list.push({ accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at });
    anchorsByAccount.set(r.account_id, list);
  }

  interface FreshAcctRow { id: string; provider: string; include_in_calculations: boolean; archived_at: string | null }
  const inputs: AccountFreshnessInput[] = (acctRes.data as FreshAcctRow[]).map((a) => ({
    id: a.id,
    provider: a.provider,
    includeInCalculations: a.include_in_calculations,
    archived: a.archived_at !== null,
    anchorDate: effectiveAnchor(anchorsByAccount.get(a.id) ?? [])?.anchorDate ?? null,
    newestTxnDate: newestTxn.get(a.id) ?? null,
  }));

  const currentThrough = householdFreshness(inputs);
  const today = new Date().toISOString().slice(0, 10);
  const dismissedOn = profRes.data?.stale_nudge_dismissed_at?.slice(0, 10) ?? null;

  const asOfByAccount: Record<string, string> = {};
  for (const i of inputs) {
    if (i.provider === "demo") continue;
    const f = accountFreshness(i);
    if (f) asOfByAccount[i.id] = f;
  }

  return { currentThrough, showNudge: nudgeVisible(currentThrough, today, dismissedOn), asOfByAccount };
}
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: FAIL only if `/import/page.tsx` destructures the old two-field context — if so, thread `anchors` through minimally now (pass it to `ImportWizard` as a prop the component doesn't use yet; Task 7 consumes it) so the build is green at this commit boundary.

```bash
git add src/app/actions/accounts.ts src/app/actions/profile.ts src/lib/data/queries.ts src/app/import/page.tsx
git commit -m "feat(server): manual balance anchors, freshness query, stale-nudge dismissal"
```

---

### Task 7: Import wizard UI — ending-balance card with live reconciliation

**Files:**
- Modify: `src/app/import/ImportWizard.tsx`
- Modify: `src/app/import/PreviewStep.tsx`
- Modify: `src/app/import/SummaryStep.tsx`
- Modify: `src/app/import/page.tsx` (pass `anchors` through, if not already done in Task 6)

**Interfaces:**
- Consumes: `getImportContext`'s `anchors` record (Task 6); `importTransactions` accepting `endingBalance`/`anchorDate` and `ImportResult` anchor fields (Task 5); `computeDiscrepancy`, `type AccountInput`, `type TransactionInput` from `@/lib/financial-engine` (engine functions are framework-free and safe to import client-side); `formatDollars` from `@/lib/financial-engine/format`.
- Produces: the anchor entry UX per spec §2.

- [ ] **Step 1: Wizard state and plumbing**

In `ImportWizard.tsx`:
- Props gain `anchors: Record<string, { anchorDate: string; balance: number }>`.
- New state: `const [endingBalance, setEndingBalance] = useState(""); const [anchorDate, setAnchorDate] = useState("");` — both reset (to `""`) in `MapStep`'s `onConfirm` alongside `setRemovedPairs(new Set())`.
- Compute the default anchor date from the preview:

```ts
  const defaultAnchorDate = useMemo(() => {
    if (!preview || preview.fresh.length === 0) return "";
    return preview.fresh.reduce((m, r) => (r.postedDate > m ? r.postedDate : m), preview.fresh[0].postedDate);
  }, [preview]);
```

- In `onCommit`, validate and include the anchor (client-side validation is UX only; the server re-validates):

```ts
  const onCommit = async () => {
    if (!preview || submitting) return;
    const trimmed = endingBalance.trim();
    let anchor: { endingBalance: number; anchorDate: string } | undefined;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        setSubmitError("Ending balance must be a number — or leave it blank to skip anchoring.");
        return;
      }
      anchor = { endingBalance: n, anchorDate: anchorDate || defaultAnchorDate };
    }
    setSubmitting(true);
    setSubmitError("");
    const res = await importTransactions({
      accountId,
      rows: preview.fresh,
      transferPairs: preview.pairs.filter((p) => !removedPairs.has(p.line)),
      ...(anchor ?? {}),
    });
    setSubmitting(false);
    if (res.error) {
      setSubmitError(res.error);
      return;
    }
    setResult(res);
    setStep("summary");
  };
```

- Pass to `PreviewStep`: `accountId`, `anchors`, `endingBalance`, `anchorDate`, `defaultAnchorDate`, `onEndingBalanceChange={setEndingBalance}`, `onAnchorDateChange={setAnchorDate}`.

- [ ] **Step 2: The ending-balance card in `PreviewStep`**

Extend `PreviewStep`'s props:

```ts
  accountId: string;
  anchors: Record<string, { anchorDate: string; balance: number }>;
  endingBalance: string;
  anchorDate: string;
  defaultAnchorDate: string;
  onEndingBalanceChange: (v: string) => void;
  onAnchorDateChange: (v: string) => void;
```

Add imports:

```ts
import { computeDiscrepancy, type AccountInput, type TransactionInput } from "@/lib/financial-engine";
import { formatDollars } from "@/lib/financial-engine/format";
```

Inside the component, compute the live reconciliation (advisory — the server recomputes at commit):

```ts
  const account = accounts.find((a) => a.id === accountId);
  const priorAnchor = anchors[accountId] ?? null;
  const effAnchorDate = anchorDate || defaultAnchorDate;
  const recon = useMemo(() => {
    const n = Number(endingBalance.trim());
    if (endingBalance.trim() === "" || !Number.isFinite(n) || !account || !effAnchorDate) return null;
    const acctForMath: AccountInput = {
      id: accountId, type: account.type, currentBalance: 0, includeInCalculations: true,
    };
    const mathTxns: TransactionInput[] = [
      ...existing
        .filter((t) => t.accountId === accountId)
        .map((t) => ({
          id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount,
          direction: t.direction, description: t.description, category: null,
          essential: null, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
        })),
      ...preview.fresh.map((r) => ({
        id: `line-${r.line}`, accountId, postedDate: r.postedDate, amount: r.amount,
        direction: r.direction, description: r.description, category: null,
        essential: null, isTransfer: false, transferPairId: null,
      })),
    ];
    return { discrepancy: computeDiscrepancy(acctForMath, priorAnchor, n, effAnchorDate, mathTxns) };
  }, [endingBalance, effAnchorDate, account, accountId, existing, preview.fresh, priorAnchor]);
```

Render the card between the transfer-pairs section and the Back/Import buttons:

```tsx
      <section aria-labelledby="anchor-heading" className="rounded-card border border-border-subtle bg-elevated p-3">
        <h3 id="anchor-heading" className="text-sm font-medium text-primary">Statement ending balance</h3>
        <p className="mt-1 text-xs text-secondary">
          Printed on your statement — &ldquo;new balance&rdquo; on credit cards (enter the amount owed as a
          positive number). This anchors the account&apos;s balance so your score stays accurate.
          Optional — skip it and the balance stays as of {priorAnchor ? priorAnchor.anchorDate : "its last manual entry"}.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="anchor-balance" className="mb-1 block text-xs font-medium text-primary">Ending balance ($)</label>
            <input
              id="anchor-balance" type="number" step="0.01" inputMode="decimal"
              value={endingBalance}
              onChange={(e) => onEndingBalanceChange(e.target.value)}
              className="w-40 rounded-xl border border-border-subtle bg-inset px-3 py-2 text-sm text-primary"
            />
          </div>
          <div>
            <label htmlFor="anchor-date" className="mb-1 block text-xs font-medium text-primary">As of</label>
            <input
              id="anchor-date" type="date"
              value={effAnchorDate}
              onChange={(e) => onAnchorDateChange(e.target.value)}
              className="rounded-xl border border-border-subtle bg-inset px-3 py-2 text-sm text-primary"
            />
          </div>
        </div>
        {recon && (
          <p role="status" className="mt-2 text-xs text-secondary">
            {recon.discrepancy === null
              ? "First anchor for this account — nothing to reconcile against yet."
              : recon.discrepancy === 0
                ? "✓ Reconciles cleanly with your existing data."
                : `⚠ ${formatDollars(Math.abs(recon.discrepancy))} unaccounted for between ${priorAnchor?.anchorDate} and ${effAnchorDate} — some transactions may be missing from this period. You can still import; the difference is recorded.`}
          </p>
        )}
      </section>
```

- [ ] **Step 3: Anchor result in `SummaryStep`**

`SummaryStep` already receives `result: ImportResult`. Add (following the file's existing layout — read it first; place after the imported-count line):

```tsx
      {result.anchoredBalance !== undefined && (
        <p className="text-sm text-secondary">
          Balance anchored: <span className="font-medium text-primary">{formatDollars(result.anchoredBalance)}</span> as of {result.anchorDate}.{" "}
          {result.discrepancy === null
            ? "First anchor for this account."
            : result.discrepancy === 0
              ? "Reconciled cleanly."
              : `${formatDollars(Math.abs(result.discrepancy ?? 0))} unaccounted for — recorded for reference.`}
        </p>
      )}
```

(Import `formatDollars` from `@/lib/financial-engine/format` if the file doesn't already.)

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: green (1 pre-existing lint warning only).

- [ ] **Step 5: Commit**

```bash
git add src/app/import
git commit -m "feat(ui): statement ending-balance card with live reconciliation in the import wizard"
```

---

### Task 8: Staleness UI — "current through" line, banner, per-account "as of"

**Files:**
- Create: `src/components/dashboard/StaleDataBanner.tsx`
- Modify: `src/components/dashboard/HomeDashboard.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/accounts/page.tsx`, `src/app/accounts/AccountsView.tsx`

**Interfaces:**
- Consumes: `getFreshnessData` → `FreshnessData` (Task 6); `dismissStaleNudge` (Task 6).
- Produces: `<StaleDataBanner currentThrough={string} />`; `HomeDashboard` prop `freshness: FreshnessData`; `AccountsView` prop `asOfByAccount: Record<string, string>`.

- [ ] **Step 1: The banner component**

```tsx
// src/components/dashboard/StaleDataBanner.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { dismissStaleNudge } from "@/app/actions/profile";

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** No-shame staleness nudge: a fact and an action, dismissible for a cycle.
 * Visibility is decided server-side (nudgeVisible); this only renders + dismisses. */
export function StaleDataBanner({ currentThrough }: { currentThrough: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true); // optimistic — server visibility catches up on refresh
    startTransition(async () => {
      await dismissStaleNudge();
      router.refresh();
    });
  };

  return (
    <p role="status" className="flex items-start gap-2 rounded-card border border-border-subtle bg-elevated p-3 text-sm text-secondary">
      <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="flex-1">
        Your data is current through {formatLongDate(currentThrough)}.{" "}
        <Link href="/import" className="underline">Import your latest statements</Link> to keep your score accurate.
      </span>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label="Dismiss for now"
        className="rounded-lg p-1 text-tertiary transition-colors hover:text-primary disabled:opacity-60"
      >
        <X size={16} aria-hidden />
      </button>
    </p>
  );
}
```

- [ ] **Step 2: Dashboard wiring**

`HomeDashboard.tsx`:
- Props gain `freshness: { currentThrough: string | null; showNudge: boolean };` (add to `HomeDashboardProps` and destructure).
- Import `StaleDataBanner`.
- Render the banner directly above the existing `{staleIndex && (...)}` block:

```tsx
      {freshness.showNudge && freshness.currentThrough && (
        <StaleDataBanner currentThrough={freshness.currentThrough} />
      )}
```

- Add the "current through" line inside the chart card's header area, right under the range picker row (near the "Personal Index" heading block — read the surrounding JSX and place it as a full-width small line below the header row, above the chart):

```tsx
        {freshness.currentThrough && (
          <p className="mt-1 text-xs text-tertiary">
            Data current through{" "}
            <Link href="/accounts" className="underline decoration-dotted underline-offset-2 hover:text-secondary">
              {formatLongDate(freshness.currentThrough)}
            </Link>
          </p>
        )}
```

with a local `formatLongDate` helper identical to the banner's (this file's idiom is local helpers; `Link` is already imported or add it).

`src/app/page.tsx`: add `getFreshnessData` to the queries import, fetch it after the (possibly re-run) `getDashboardData` call, and pass it through:

```ts
  const freshness = await getFreshnessData(supabase);
```

```tsx
        <HomeDashboard
          ...
          freshness={freshness}
        />
```

(`EmptyDashboard` needs no freshness — an empty household has no data to be stale.)

- [ ] **Step 3: Per-account "as of" on `/accounts`**

`src/app/accounts/page.tsx`: add `getFreshnessData` to the `Promise.all`, pass `asOfByAccount={freshness.asOfByAccount}` to `AccountsView`.

`AccountsView.tsx`: props gain `asOfByAccount: Record<string, string>`. In the account row (where the existing `chipCls` chips render — next to the `demo` chip), add:

```tsx
              {asOfByAccount[a.id] && (
                <span className={chipCls}>as of {asOfByAccount[a.id]}</span>
              )}
```

(Demo accounts are absent from the map by construction, so they get no chip.)

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard src/app/page.tsx src/app/accounts
git commit -m "feat(ui): data-current-through line, staleness nudge banner, per-account as-of chips"
```

---

### Task 9: E2e — anchored import journey and undo round-trip

**Files:**
- Create: `e2e/fixtures/checking-statement.csv`
- Modify: `e2e/smoke.spec.ts`

Playwright runs `workers: 1` and `smoke.spec.ts` shares one onboarded user/page in file order. Insert the two new tests **after** the recurring-section tests and **before** "sign out returns to login".

**Known behavioral subtlety the tests are designed around:** creating a manual account writes a `manual` anchor dated *today* (Task 6). A statement anchor dated in the past would NOT supersede it (effective anchor = greatest date). The tests therefore set the anchor date to **today** in the wizard, making the statement anchor the effective one (same date, later `created_at` wins the tiebreak).

- [ ] **Step 1: The fixture**

```csv
Date,Description,Amount
2026-07-01,Paycheck,2000.00
2026-07-05,Groceries,-150.25
2026-07-10,Rent,-800.00
```

Save as `e2e/fixtures/checking-statement.csv` (signed single-amount column — the format the CSV parser's auto-detection was built for; dates are in the past and stay valid forever).

- [ ] **Step 2: The tests**

```ts
test("anchored CSV import updates the account balance", async () => {
  // Create a fresh manual account to import into.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  await page.locator("#acct-name").fill("Anchor QA Checking");
  await page.locator("#acct-balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Anchor QA Checking")).toBeVisible({ timeout: 30_000 });

  // Import the fixture statement.
  await page.goto("/import");
  await page.locator("#import-account").selectOption({ label: "Anchor QA Checking" });
  await page.locator("#import-file").setInputFiles("e2e/fixtures/checking-statement.csv");
  await page.getByRole("button", { name: "Preview import" }).click();

  // Anchor: ending balance 1500 as of today (so this statement anchor
  // supersedes the account-creation anchor, which is also dated today).
  const today = new Date().toISOString().slice(0, 10);
  await page.locator("#anchor-balance").fill("1500");
  await page.locator("#anchor-date").fill(today);
  await page.getByRole("button", { name: /^Import 3 transactions/ }).click();
  await expect(page.getByText(/Balance anchored/)).toBeVisible({ timeout: 30_000 });

  // The account now shows the anchored balance, not the typed 1000.
  await page.goto("/accounts");
  const row = page.getByText("Anchor QA Checking").locator("..").locator("..");
  await expect(row.getByText("$1,500")).toBeVisible();
  await expect(row.getByText(/as of/)).toBeVisible();
});

test("undoing the import restores the pre-anchor balance", async () => {
  await page.goto("/accounts");
  // Undo the batch just imported (newest entry in Recent Imports).
  await page.getByRole("button", { name: /undo/i }).first().click();
  // Two-step confirm if present:
  const confirm = page.getByRole("button", { name: /confirm|yes/i }).first();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  // Anchor removed with the batch → balance re-derives from the creation
  // anchor (1000, dated today, no post-anchor transactions).
  const row = page.getByText("Anchor QA Checking").locator("..").locator("..");
  await expect(row.getByText("$1,000")).toBeVisible({ timeout: 30_000 });
});
```

**Implementer note (not a placeholder — a verification step):** before running, read `e2e/smoke.spec.ts`'s existing locator idioms, `RecentImports.tsx`'s actual undo button label/flow, and `AccountsView.tsx`'s row DOM to adjust the three marked locators (`Add account` first/last disambiguation, the undo button name, and the row-scoping `locator("..")` chain) to the real markup. The assertions (balance $1,500 → $1,000, "Balance anchored", "as of") are the contract and must not be weakened. If `formatDollars` renders `$1,500.00` rather than `$1,500`, match the app's actual format.

- [ ] **Step 3: Run the e2e suite twice**

Run: `pnpm test:e2e && pnpm test:e2e`
Expected: 11/11 both runs (9 existing + 2 new), no collisions.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/checking-statement.csv e2e/smoke.spec.ts
git commit -m "test(e2e): anchored import updates balance; undo restores it"
```

---

### Task 10: Documentation + final verification

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/DATA_MODEL.md`, `docs/CURRENT_PHASE.md`

- [ ] **Step 1: DECISIONS.md — append entry #24**

```markdown
## 24. 2026-07-18 — Statement balance anchoring: append-only anchors + roll-forward, snapshot builder untouched

**Decision:** account balances are anchored by append-only `balance_anchors` rows — (date, balance) truth points from statement ending balances entered at CSV import (source `import`, reconciled server-side with the discrepancy recorded) or from manual balance entry (source `manual`, dated that day; account creation and balance-changing edits write one automatically). The engine trusts the *effective anchor* (greatest `anchor_date`, tiebreak `created_at`); `rebuildSnapshots` corrects `financial_accounts.current_balance` to the effective anchor rolled forward through post-anchor transactions on every mutation, so the snapshot builder itself is untouched — its backward replay from `current_balance` now hangs off a maintained value instead of a stale hand-typed one. Anchor entry at import is encouraged but skippable; reconciliation warns (in dollars) and never blocks. Anchorless accounts keep legacy behavior (hand-typed balance authoritative, no roll-forward). Displayed balances are honestly "as of" the anchor — slightly behind reality, provably correct; a 35-day staleness nudge (dismissible, DB-backed, demo data excluded) prompts the monthly ritual.

**Alternatives:** two columns on `financial_accounts` (single anchor, no history — loses the audit trail and per-import discrepancy record; Plaid would force the table later anyway); a multi-anchor engine pinning history piecewise between anchors (a snapshot-builder rewrite; overkill for monthly anchors); requiring the balance at import (blocks users whose exports lack one).

**Reasoning:** transactions determine changes, never levels — the engine needs a trusted (date, balance) point, and a statement's ending balance is the cleanest one that exists (posted-only, bank-reconciled, exact close date — none of the pending-transaction fuzziness of a typed-in app-screen number). Reconciliation gives gap *detection* for free: a mismatch is mathematical proof of missing transactions. ROADMAP Phase 7 (Plaid) becomes "anchor rows from a new source, daily" on the same machinery.

**Consequences:** an import now moves balances for anchored accounts (upgrading the old "adding transactions reshapes history backward and never changes today's balance" quirk into correct behavior for post-anchor transactions); a statement anchor dated earlier than a newer manual anchor does not supersede it — reconciliation surfaces the disagreement instead (KNOWN_LIMITATIONS); batch undo removes its anchor row; discrepancies and freshness are recorded but do not yet feed score confidence (deferred — versioned methodology change).
```

- [ ] **Step 2: KNOWN_LIMITATIONS.md updates**

Replace the "**Manual `current_balance` is authoritative.**" bullet with:

```markdown
- **Balances are anchor-derived for anchored accounts; hand-typed for the rest.** Accounts with `balance_anchors` rows (DECISIONS #24) get `current_balance` recomputed on every rebuild — effective anchor rolled forward through post-anchor transactions — so imports and manual transactions now move today's balance correctly; transactions dated before the anchor are absorbed into backward-replayed history as before. Accounts with no anchors keep the legacy rule (typed balance authoritative; adding transactions reshapes history backward). Nuances: displayed balances are "as of" the effective anchor (statement close), deliberately behind live reality until Plaid-style anchors arrive (ROADMAP Phase 7); a statement anchor dated earlier than a newer manual anchor records and reconciles but does not supersede it; re-affirming an unchanged balance in the account sheet doesn't write a fresh anchor (rename-only edits must not refresh freshness, so balance-unchanged edits are skipped wholesale); reconciliation discrepancies and freshness dates are recorded but not yet wired into score confidence (a versioned methodology change, deferred).
```

- [ ] **Step 3: DATA_MODEL.md — add the table**

Append to the tables section, matching the file's existing style (read it first):

```markdown
### balance_anchors (implemented)

Append-only (date, balance) truth points per account — statement ending balances entered at import (`source = 'import'`, with the server-computed reconciliation `discrepancy` recorded; `import_batch_id` ties the anchor to its batch so undo removes it) and manual balance entries (`source = 'manual'`). The engine trusts the *effective anchor*: greatest `anchor_date`, tiebreak latest `created_at`. `balance` uses the same positive-owed convention as `financial_accounts.current_balance`. Owner-only RLS. See DECISIONS #24.
```

- [ ] **Step 4: CURRENT_PHASE.md**

Update per the established pattern: new "Completed (this phase — statement balance anchoring & staleness)" section summarizing Tasks 1–10 (engine anchor/staleness modules, migration 0007, rebuild integration, import-wizard anchor card with reconciliation, staleness surfaces, e2e); demote the recurring-detection section to "previous phase"; update "Next three priorities" to (1) Phase 4 kickoff (AI financial interpreter), (2) verify production magic-link email flow, (3) wire e2e into CI; update "Test status" with the final counts from Step 5.

- [ ] **Step 5: Final verification**

Run: `pnpm check && pnpm test:rls && pnpm test:e2e`
Expected: all green — unit 299 (Task 1: +14, Task 2: +10 over the 275 baseline; record the true count), RLS 29/29, e2e 11/11. Then live browser QA per CLAUDE.md at **390×844 first**, then 1280×900, against real Supabase:
- Full anchored import in a real browser: create account → import fixture-style CSV → enter ending balance → watch reconciliation line update live → commit → `/accounts` shows the new balance and "as of" chip.
- Dashboard shows "Data current through {date}" linking to `/accounts`; no nudge banner (fresh data).
- Skip-path import (no balance entered) still commits and shows the skip note.
- Clean up any QA test user afterward via the service-role admin API.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: record balance-anchoring slice (DECISIONS #24)"
```

---

## Plan Self-Review Notes

- **Spec coverage:** data model (Task 3), wizard UX incl. skippable entry + live reconciliation + summary + undo (Tasks 5, 7), balance math incl. effective anchor/roll-forward/back-fill (Tasks 1, 4), manual anchors on create/edit (Task 6), staleness incl. demo exclusion + 35-day nudge + DB-backed dismissal (Tasks 2, 6, 8), tests (Tasks 1–3, 9), docs incl. the deferred-confidence note (Task 10).
- **Type consistency:** `BalanceAnchor`/`AccountFreshnessInput`/`FreshnessData` shapes match across Tasks 1, 2, 4, 5, 6, 7, 8; `computeDiscrepancy` takes `{ balance, anchorDate } | null` (not a full `BalanceAnchor`) everywhere it's called (Tasks 5, 7).
- **Known judgment calls encoded:** anchor-date-precedence over newer transactions in freshness (verified-through semantics); statement-vs-newer-manual-anchor non-supersession (tested via the e2e today-date workaround, documented in KNOWN_LIMITATIONS); balance-unchanged edits don't re-anchor.
- **E2e locator caveat:** three locators in Task 9 are explicitly marked for adjustment against real markup; the assertions are the contract.
