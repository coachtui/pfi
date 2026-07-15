# Supabase Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PFI from in-memory demo data onto real rails: Supabase magic-link auth, a six-table Postgres schema with default-deny RLS, a deterministic snapshot pipeline, onboarding, and demo data seeded through the same path real imports will use.

**Architecture:** Vertical slice (Approach A from the spec). The engine stays framework-free; a new pure `buildDailySnapshots()` replays transactions into `DailySnapshot[]`. Server components fetch via `@supabase/ssr`; server actions mutate. Demo data becomes accounts + transactions inserted as `provider='demo'`, snapshots derived server-side.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Zod 4, React Hook Form, Vitest, Supabase CLI (project `dgkcmvjfvdlsyuhuewkx`, already linked; `.env.local` has URL + publishable key).

**Spec:** `docs/superpowers/specs/2026-07-15-supabase-infrastructure-design.md`

## Global Constraints

- Strict TypeScript; `pnpm check` (lint + typecheck + test + build) must pass at every commit.
- No financial formulas in React components — calculations live in `src/lib/financial-engine/` (no React/Next imports there, ever).
- Mobile-first: build and verify at ~390px before desktop.
- RLS default-deny: every table gets `enable row level security` + owner-only policies; no anon policies.
- Never commit secrets. `.env.local` is gitignored; only `NEXT_PUBLIC_*` values reach the browser.
- Transaction source columns are immutable after insert; corrections go in `user_override`.
- Snapshots store **raw dollar components only** (no index/baseline/waterline); the engine indexes at read time.
- `ENGINE_VERSION = "1.0.0"` stamps every snapshot row.
- Demo end date is fixed: `2026-07-15`. Demo seed is deterministic (mulberry32, seed `20260715`).
- Accessibility: labels on all inputs, `aria-` states, never color alone for positive/negative.

---

### Task 1: Dependencies + required env validation

**Files:**
- Modify: `package.json` (via pnpm), `src/lib/config/env.ts`, `.env.example`
- Test: `src/lib/config/env.test.ts`

**Interfaces:**
- Produces: `env.NEXT_PUBLIC_SUPABASE_URL: string`, `env.NEXT_PUBLIC_SUPABASE_ANON_KEY: string` (now required, non-optional), `validateEnv(source?)`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @supabase/supabase-js @supabase/ssr react-hook-form @hookform/resolvers
pnpm add -D tsx
```

- [ ] **Step 2: Write failing test**

Create `src/lib/config/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateEnv } from "./env";

const valid = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
} as NodeJS.ProcessEnv;

describe("validateEnv", () => {
  it("accepts a complete environment", () => {
    const env = validateEnv(valid);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("throws when Supabase URL is missing", () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _omit, ...rest } = valid;
    expect(() => validateEnv(rest as NodeJS.ProcessEnv)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the anon key is empty", () => {
    expect(() =>
      validateEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" } as NodeJS.ProcessEnv),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/config/env.test.ts`
Expected: FAIL — "throws when Supabase URL is missing" fails because the schema still marks it `.optional()`.

- [ ] **Step 4: Make env vars required**

In `src/lib/config/env.ts`, replace the schema and module-scope export:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});
```

Also update the comment block (Supabase is now wired) and update `.env.example` to say the two variables are required. Keep `export const env = validateEnv();` — but guard it so importing this module in Vitest (where `.env.local` isn't loaded) doesn't throw:

```ts
export const env: Env =
  process.env.VITEST !== undefined
    ? envSchema.parse({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
      })
    : validateEnv();
```

- [ ] **Step 5: Run tests, typecheck**

Run: `pnpm vitest run src/lib/config/env.test.ts && pnpm typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/config/env.ts src/lib/config/env.test.ts .env.example
git commit -m "feat: require Supabase env vars, add supabase/ssr + RHF deps"
```

---

### Task 2: Migration 0001_core — schema + RLS, pushed to the linked project

**Files:**
- Create: `supabase/migrations/0001_core.sql`

**Interfaces:**
- Produces: tables `user_profiles`, `personal_companies`, `financial_accounts`, `transactions`, `financial_events`, `daily_snapshots` with owner-only RLS. Column names exactly as below — the mappers in Task 7 depend on them.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_core.sql`:

```sql
-- PFI core schema. Owner-only RLS on every table; no anon access.
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  age_cohort text not null,
  income_band text not null,
  household_type text not null,
  col_cohort text not null,
  objective text not null,
  privacy_settings jsonb not null default '{}',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.personal_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.user_profiles (id) on delete cascade,
  name text not null,
  ticker text not null,
  logo_path text,
  public_profile_enabled boolean not null default false,
  data_coverage_state text not null default 'demo',
  created_at timestamptz not null default now()
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  provider text not null check (provider in ('demo','manual','csv')),
  institution text,
  type text not null check (type in ('checking','savings','money_market','credit_card','mortgage','auto_loan','student_loan','personal_loan','brokerage','retirement','property','other_asset','other_liability')),
  subtype text,
  display_name text not null,
  mask text,
  currency text not null default 'USD',
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  credit_limit numeric(14,2),
  interest_rate numeric(6,4),
  include_in_calculations boolean not null default true,
  include_in_public_score boolean not null default false,
  connection_status text not null default 'ok',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.financial_accounts (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  posted_date date not null,
  authorized_date date,
  amount numeric(14,2) not null check (amount >= 0),
  direction text not null check (direction in ('inflow','outflow')),
  description text not null,
  category text,
  subcategory text,
  txn_type text,
  recurring_status text,
  essential boolean,
  is_transfer boolean not null default false,
  transfer_pair_id uuid,
  confidence numeric(3,2),
  user_override jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  date date not null,
  type text not null check (type in ('paycheck','bonus','mortgage_payment','large_purchase','insurance_payment','investment_contribution','debt_payment','debt_payoff','tax_payment','unexpected_expense')),
  label text not null,
  amount numeric(14,2) not null,
  direction text not null check (direction in ('inflow','outflow')),
  created_at timestamptz not null default now()
);

create table public.daily_snapshots (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  date date not null,
  liquid_assets numeric(14,2) not null,
  revolving_balances numeric(14,2) not null,
  near_term_obligations numeric(14,2) not null,
  essential_obligations numeric(14,2) not null,
  safety_buffer numeric(14,2) not null,
  net_worth numeric(14,2) not null,
  engine_version text not null,
  data_coverage_confidence text not null default 'demo',
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index transactions_user_date_idx on public.transactions (user_id, posted_date);
create index financial_events_user_date_idx on public.financial_events (user_id, date);
create index financial_accounts_user_idx on public.financial_accounts (user_id);

-- RLS: default deny, owner-only.
alter table public.user_profiles enable row level security;
alter table public.personal_companies enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.financial_events enable row level security;
alter table public.daily_snapshots enable row level security;

create policy "own_select" on public.user_profiles for select using (auth.uid() = id);
create policy "own_insert" on public.user_profiles for insert with check (auth.uid() = id);
create policy "own_update" on public.user_profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own_delete" on public.user_profiles for delete using (auth.uid() = id);

create policy "own_select" on public.personal_companies for select using (auth.uid() = user_id);
create policy "own_insert" on public.personal_companies for insert with check (auth.uid() = user_id);
create policy "own_update" on public.personal_companies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.personal_companies for delete using (auth.uid() = user_id);

create policy "own_select" on public.financial_accounts for select using (auth.uid() = user_id);
create policy "own_insert" on public.financial_accounts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.financial_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.financial_accounts for delete using (auth.uid() = user_id);

create policy "own_select" on public.transactions for select using (auth.uid() = user_id);
create policy "own_insert" on public.transactions for insert with check (auth.uid() = user_id);
create policy "own_update" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.transactions for delete using (auth.uid() = user_id);

create policy "own_select" on public.financial_events for select using (auth.uid() = user_id);
create policy "own_insert" on public.financial_events for insert with check (auth.uid() = user_id);
create policy "own_update" on public.financial_events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.financial_events for delete using (auth.uid() = user_id);

create policy "own_select" on public.daily_snapshots for select using (auth.uid() = user_id);
create policy "own_insert" on public.daily_snapshots for insert with check (auth.uid() = user_id);
create policy "own_update" on public.daily_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.daily_snapshots for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Push to the linked project**

Run: `supabase db push`
Expected: "Applying migration 0001_core.sql... Finished supabase db push." If it prompts for confirmation in a non-TTY shell, run `supabase db push --yes`.

- [ ] **Step 3: Verify migration applied**

Run: `supabase migration list`
Expected: `0001_core` listed with both Local and Remote timestamps. (Deep behavioral verification happens in Task 13's RLS test.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_core.sql
git commit -m "feat: core schema with default-deny RLS (migration 0001)"
```

---

### Task 3: Supabase clients + auth project config

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

**Interfaces:**
- Produces: `createClient()` (browser, from `client.ts`) and `createClient(): Promise<SupabaseClient>` (server, from `server.ts`). All later tasks import these.

- [ ] **Step 1: Browser client**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/config/env";

/** Browser-side Supabase client. Use only in client components (login form). */
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

- [ ] **Step 2: Server client**

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/config/env";

/** Server-side Supabase client bound to the request's cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — middleware refreshes sessions instead.
        }
      },
    },
  });
}
```

- [ ] **Step 3: Configure auth redirect URLs on the project**

Run (uses the CLI's stored access token):

```bash
TOKEN=$(cat ~/.supabase/access-token)
curl -sS -X PATCH "https://api.supabase.com/v1/projects/dgkcmvjfvdlsyuhuewkx/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"site_url":"http://localhost:3000","uri_allow_list":"http://localhost:3000/auth/callback,http://localhost:3000/**"}'
```

Expected: JSON response echoing `"site_url":"http://localhost:3000"`. If the token file doesn't exist, check `~/Library/Application Support/supabase/access-token` (macOS path) or ask the user to re-run `supabase login` in a terminal.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add src/lib/supabase
git commit -m "feat: supabase browser/server clients, auth URL config"
```

---

### Task 4: Snapshot builder — backward balance replay

**Files:**
- Create: `src/lib/financial-engine/snapshot-builder.ts`
- Test: `src/lib/financial-engine/snapshot-builder.test.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./snapshot-builder";`)

**Interfaces:**
- Consumes: `DailySnapshot`, `ISODate` from `./types`.
- Produces (exact — Tasks 5, 6, 8, 12 depend on these):

```ts
export const ENGINE_VERSION = "1.0.0";
export type AccountType = "checking" | "savings" | "money_market" | "credit_card" | "mortgage" | "auto_loan" | "student_loan" | "personal_loan" | "brokerage" | "retirement" | "property" | "other_asset" | "other_liability";
export interface AccountInput { id: string; type: AccountType; currentBalance: number; includeInCalculations: boolean; }
export interface TransactionInput { id: string; accountId: string; postedDate: ISODate; amount: number; direction: "inflow" | "outflow"; category: string | null; essential: boolean | null; isTransfer: boolean; transferPairId: string | null; }
export interface SnapshotBuilderConfig { startDate: ISODate; endDate: ISODate; safetyBuffer: number; }
export function buildDailySnapshots(accounts: AccountInput[], transactions: TransactionInput[], config: SnapshotBuilderConfig): DailySnapshot[];
```

Semantics: `currentBalance` is the balance **as of endDate**, positive for liabilities too (a card owing $1,000 has `currentBalance: 1000`). For asset accounts a day's delta is `inflow − outflow`; for liability accounts it is `outflow − inflow` (purchases raise the balance, payments lower it). The builder replays **backward** from `endDate` to reconstruct each account's daily balance, then walks forward emitting one `DailySnapshot` per day. This task implements `liquidAssets`, `revolvingBalances`, `netWorth`, and `safetyBuffer`; obligations are 0 until Task 5.

- [ ] **Step 1: Write failing tests (hand-computed scenario)**

Create `src/lib/financial-engine/snapshot-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDailySnapshots, type AccountInput, type TransactionInput } from "./snapshot-builder";

const accounts: AccountInput[] = [
  { id: "chk", type: "checking", currentBalance: 5000, includeInCalculations: true },
  { id: "card", type: "credit_card", currentBalance: 1000, includeInCalculations: true },
  { id: "ignored", type: "savings", currentBalance: 99999, includeInCalculations: false },
];

const txn = (t: Partial<TransactionInput> & { id: string; accountId: string; postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
  category: null, essential: null, isTransfer: false, transferPairId: null, ...t,
});

// Timeline (endDate 2026-01-16, checking ends at 5000, card ends at 1000):
//  Jan 01  paycheck +2000  (chk, income)
//  Jan 02  rent    −1200   (chk, essential)
//  Jan 05  coffee   −50    (card outflow → card balance +50)
//  Jan 08  card payment: chk −300 (transfer) paired with card +300 (transfer)
//  Jan 10  groceries −100  (chk, essential)
//  Jan 15  paycheck +2000  (chk, income)
const transactions: TransactionInput[] = [
  txn({ id: "t1", accountId: "chk", postedDate: "2026-01-01", amount: 2000, direction: "inflow", category: "income" }),
  txn({ id: "t2", accountId: "chk", postedDate: "2026-01-02", amount: 1200, direction: "outflow", essential: true }),
  txn({ id: "t3", accountId: "card", postedDate: "2026-01-05", amount: 50, direction: "outflow" }),
  txn({ id: "t4", accountId: "chk", postedDate: "2026-01-08", amount: 300, direction: "outflow", isTransfer: true, transferPairId: "t5" }),
  txn({ id: "t5", accountId: "card", postedDate: "2026-01-08", amount: 300, direction: "inflow", isTransfer: true, transferPairId: "t4" }),
  txn({ id: "t6", accountId: "chk", postedDate: "2026-01-10", amount: 100, direction: "outflow", essential: true }),
  txn({ id: "t7", accountId: "chk", postedDate: "2026-01-15", amount: 2000, direction: "inflow", category: "income" }),
];

const config = { startDate: "2026-01-01", endDate: "2026-01-16", safetyBuffer: 500 };

describe("buildDailySnapshots — balance replay", () => {
  const snaps = buildDailySnapshots(accounts, transactions, config);

  it("emits one snapshot per day, oldest first", () => {
    expect(snaps).toHaveLength(16);
    expect(snaps[0].date).toBe("2026-01-01");
    expect(snaps[15].date).toBe("2026-01-16");
  });

  it("reconstructs checking backward from the current balance", () => {
    // chk end Jan16 = 5000. Working backward: Jan15 +2000 ⇒ Jan14 = 3000;
    // Jan10 −100 ⇒ Jan09 = 3100; Jan08 −300 ⇒ Jan07 = 3400;
    // Jan02 −1200 ⇒ Jan01 = 4600; Jan01 +2000 ⇒ Dec31 = 2600.
    expect(snaps.find((s) => s.date === "2026-01-16")!.liquidAssets).toBe(5000);
    expect(snaps.find((s) => s.date === "2026-01-14")!.liquidAssets).toBe(3000);
    expect(snaps.find((s) => s.date === "2026-01-09")!.liquidAssets).toBe(3100);
    expect(snaps.find((s) => s.date === "2026-01-01")!.liquidAssets).toBe(4600);
  });

  it("reconstructs the card as a liability (purchases raise it, payments lower it)", () => {
    // card end = 1000. Backward: Jan08 payment −300 ⇒ Jan07 = 1300;
    // Jan05 purchase +50 ⇒ Jan04 = 1250.
    expect(snaps.find((s) => s.date === "2026-01-16")!.revolvingBalances).toBe(1000);
    expect(snaps.find((s) => s.date === "2026-01-07")!.revolvingBalances).toBe(1300);
    expect(snaps.find((s) => s.date === "2026-01-04")!.revolvingBalances).toBe(1250);
  });

  it("excludes accounts flagged out of calculations", () => {
    expect(snaps[0].liquidAssets).toBeLessThan(10000); // savings 99999 not counted
  });

  it("computes net worth as assets minus liabilities and carries the safety buffer", () => {
    const last = snaps[15];
    expect(last.netWorth).toBe(5000 - 1000);
    expect(last.safetyBuffer).toBe(500);
  });

  it("is deterministic", () => {
    expect(buildDailySnapshots(accounts, transactions, config)).toEqual(snaps);
  });

  it("returns empty for an empty date range or no accounts", () => {
    expect(buildDailySnapshots([], transactions, config)).toEqual([]);
    expect(buildDailySnapshots(accounts, [], { ...config, endDate: "2025-12-31" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/snapshot-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder core**

Create `src/lib/financial-engine/snapshot-builder.ts`:

```ts
import type { DailySnapshot, ISODate } from "./types";

export const ENGINE_VERSION = "1.0.0";

export type AccountType =
  | "checking" | "savings" | "money_market" | "credit_card" | "mortgage"
  | "auto_loan" | "student_loan" | "personal_loan" | "brokerage"
  | "retirement" | "property" | "other_asset" | "other_liability";

const LIQUID_TYPES: ReadonlySet<AccountType> = new Set(["checking", "savings", "money_market"]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability",
]);

export interface AccountInput {
  id: string;
  type: AccountType;
  /** Balance as of config.endDate. Positive for liabilities too. */
  currentBalance: number;
  includeInCalculations: boolean;
}

export interface TransactionInput {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  /** "income" marks income events used for obligation windows. */
  category: string | null;
  essential: boolean | null;
  isTransfer: boolean;
  transferPairId: string | null;
}

export interface SnapshotBuilderConfig {
  startDate: ISODate;
  endDate: ISODate;
  safetyBuffer: number;
}

export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function enumerateDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Signed balance change for an account on one day. */
function dayDelta(account: AccountInput, txns: TransactionInput[]): number {
  let delta = 0;
  for (const t of txns) {
    if (t.accountId !== account.id) continue;
    const flow = t.direction === "inflow" ? t.amount : -t.amount;
    delta += LIABILITY_TYPES.has(account.type) ? -flow : flow;
  }
  return delta;
}

export function buildDailySnapshots(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
): DailySnapshot[] {
  const included = accounts.filter((a) => a.includeInCalculations);
  if (included.length === 0 || config.startDate > config.endDate) return [];

  const dates = enumerateDates(config.startDate, config.endDate);
  const byDate = new Map<ISODate, TransactionInput[]>();
  for (const t of transactions) {
    const list = byDate.get(t.postedDate) ?? [];
    list.push(t);
    byDate.set(t.postedDate, list);
  }

  // Backward replay: balance at end of each day, per account.
  const balances = new Map<ISODate, Map<string, number>>();
  let cursor = new Map(included.map((a) => [a.id, a.currentBalance]));
  balances.set(config.endDate, cursor);
  for (let i = dates.length - 1; i > 0; i--) {
    const day = dates[i];
    const dayTxns = byDate.get(day) ?? [];
    const prev = new Map(cursor);
    for (const a of included) {
      prev.set(a.id, (prev.get(a.id) ?? 0) - dayDelta(a, dayTxns));
    }
    balances.set(dates[i - 1], prev);
    cursor = prev;
  }

  return dates.map((date) => {
    const bal = balances.get(date)!;
    let liquid = 0;
    let revolving = 0;
    let assets = 0;
    let liabilities = 0;
    for (const a of included) {
      const b = bal.get(a.id) ?? 0;
      if (LIQUID_TYPES.has(a.type)) liquid += b;
      if (a.type === "credit_card") revolving += b;
      if (LIABILITY_TYPES.has(a.type)) liabilities += b;
      else assets += b;
    }
    const obligations = computeObligations(date, included, transactions, config);
    return {
      date,
      liquidAssets: round2(liquid),
      revolvingBalances: round2(revolving),
      nearTermObligations: round2(obligations.nearTerm),
      essentialObligations: round2(obligations.essential),
      safetyBuffer: config.safetyBuffer,
      netWorth: round2(assets - liabilities),
    };
  });
}

// Implemented in Task 5. Returning zeros keeps Task 4 green in isolation.
function computeObligations(
  _date: ISODate,
  _accounts: AccountInput[],
  _transactions: TransactionInput[],
  _config: SnapshotBuilderConfig,
): { nearTerm: number; essential: number } {
  return { nearTerm: 0, essential: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

Add to `src/lib/financial-engine/index.ts`:

```ts
export * from "./snapshot-builder";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/snapshot-builder.test.ts && pnpm typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine
git commit -m "feat: snapshot builder — backward balance replay"
```

---

### Task 5: Snapshot builder — income detection + obligation windows

**Files:**
- Modify: `src/lib/financial-engine/snapshot-builder.ts`
- Test: `src/lib/financial-engine/snapshot-builder.test.ts` (append)

**Interfaces:**
- Consumes/Produces: same `buildDailySnapshots` signature; fills `nearTermObligations` and `essentialObligations`.

Rules (v1, documented): an **income date** is any day with a non-transfer inflow of `category === "income"` into a liquid account. For day *d*, the window is `(d, nextIncomeDate]`; if no future income exists, gap = median historical inter-income gap (default 15 days). `nearTermObligations` = non-transfer outflows from liquid accounts in the window **plus** transfer-outflows from liquid accounts whose pair lands on a liability account (card payments are real cash needs; investment transfers are not obligations). `essentialObligations` = the `essential === true` subset of non-transfer outflows. When the window extends past `endDate` (the last days of history), the window is evaluated 28 days earlier as a previous-cycle proxy.

- [ ] **Step 1: Append failing tests**

Append to `snapshot-builder.test.ts`:

```ts
describe("buildDailySnapshots — obligations", () => {
  const snaps = buildDailySnapshots(accounts, transactions, config);

  it("sums non-transfer liquid outflows plus card-payment transfers before next income", () => {
    // Day Jan 01 → next income Jan 15. Window (Jan01, Jan15]:
    // rent 1200 (Jan02) + card payment transfer 300 (Jan08, pair on card)
    // + groceries 100 (Jan10) = 1600. Coffee (t3) is on the card, not liquid — excluded.
    expect(snaps.find((s) => s.date === "2026-01-01")!.nearTermObligations).toBe(1600);
  });

  it("counts only essential non-transfer outflows as essential obligations", () => {
    // Window (Jan01, Jan15]: rent 1200 + groceries 100 = 1300.
    expect(snaps.find((s) => s.date === "2026-01-01")!.essentialObligations).toBe(1300);
  });

  it("shrinks the window as the next income approaches", () => {
    // Day Jan 09 → window (Jan09, Jan15]: groceries 100 only.
    expect(snaps.find((s) => s.date === "2026-01-09")!.nearTermObligations).toBe(100);
    expect(snaps.find((s) => s.date === "2026-01-09")!.essentialObligations).toBe(100);
  });

  it("uses a previous-cycle proxy when the window runs past endDate", () => {
    // Day Jan 16 has no future income within history. Median gap = 14 (Jan01→Jan15),
    // so the window (Jan16, Jan30] shifts back 28 days to (Dec19, Jan02], which
    // contains the Jan02 rent (1200). Finite, and never reads past endDate.
    expect(snaps.find((s) => s.date === "2026-01-16")!.nearTermObligations).toBe(1200);
    expect(snaps.find((s) => s.date === "2026-01-16")!.essentialObligations).toBe(1200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/financial-engine/snapshot-builder.test.ts`
Expected: FAIL — obligations currently hard-coded to 0 make the 1600/1300/100 assertions fail.

- [ ] **Step 3: Implement obligations**

Replace the stub `computeObligations` in `snapshot-builder.ts` with:

```ts
const DEFAULT_INCOME_GAP_DAYS = 15;
const PROXY_SHIFT_DAYS = 28;

function median(xs: number[]): number {
  if (xs.length === 0) return DEFAULT_INCOME_GAP_DAYS;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

interface ObligationContext {
  incomeDates: ISODate[];
  medianGap: number;
  liquidIds: Set<string>;
  liabilityIds: Set<string>;
  txnById: Map<string, TransactionInput>;
}

function buildObligationContext(
  accounts: AccountInput[],
  transactions: TransactionInput[],
): ObligationContext {
  const liquidIds = new Set(accounts.filter((a) => LIQUID_TYPES.has(a.type)).map((a) => a.id));
  const liabilityIds = new Set(
    accounts.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.id),
  );
  const incomeDates = [
    ...new Set(
      transactions
        .filter(
          (t) =>
            t.direction === "inflow" && !t.isTransfer && t.category === "income" &&
            liquidIds.has(t.accountId),
        )
        .map((t) => t.postedDate),
    ),
  ].sort();
  const gaps = incomeDates.slice(1).map((d, i) => daysBetween(incomeDates[i], d));
  return {
    incomeDates,
    medianGap: median(gaps),
    liquidIds,
    liabilityIds,
    txnById: new Map(transactions.map((t) => [t.id, t])),
  };
}

function computeObligations(
  date: ISODate,
  ctx: ObligationContext,
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
): { nearTerm: number; essential: number } {
  const nextIncome = ctx.incomeDates.find((d) => d > date);
  const gap = nextIncome ? daysBetween(date, nextIncome) : ctx.medianGap;
  let windowStart = date;
  let windowEnd = addDays(date, gap);
  if (windowEnd > config.endDate) {
    windowStart = addDays(windowStart, -PROXY_SHIFT_DAYS);
    windowEnd = addDays(windowEnd, -PROXY_SHIFT_DAYS);
  }

  let nearTerm = 0;
  let essential = 0;
  for (const t of transactions) {
    if (t.direction !== "outflow" || !ctx.liquidIds.has(t.accountId)) continue;
    if (!(t.postedDate > windowStart && t.postedDate <= windowEnd)) continue;
    if (t.isTransfer) {
      const pair = t.transferPairId ? ctx.txnById.get(t.transferPairId) : undefined;
      if (pair && ctx.liabilityIds.has(pair.accountId)) nearTerm += t.amount; // debt payment
      continue;
    }
    nearTerm += t.amount;
    if (t.essential === true) essential += t.amount;
  }
  return { nearTerm, essential };
}
```

And update the call site inside `buildDailySnapshots` — build the context once before the `dates.map`:

```ts
const ctx = buildObligationContext(included, transactions);
```

then inside the map: `const obligations = computeObligations(date, ctx, transactions, config);`

- [ ] **Step 4: Run all engine tests**

Run: `pnpm vitest run src/lib/financial-engine && pnpm typecheck`
Expected: PASS (all files) / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine
git commit -m "feat: snapshot builder — income windows and obligation derivation"
```

---

### Task 6: Demo generator refactor — emit accounts + transactions + events

**Files:**
- Modify: `src/lib/demo-data/koa-holdings.ts` (rewrite), `src/lib/demo-data/koa-holdings.test.ts` (rewrite), `src/app/page.tsx` (temporary builder call)

**Interfaces:**
- Consumes: `AccountInput`, `TransactionInput`, `buildDailySnapshots`, `SnapshotBuilderConfig` from the engine; `FinancialEvent`.
- Produces (Tasks 8 and 12 depend on these exact shapes):

```ts
export interface DemoAccount extends AccountInput { provider: "demo"; displayName: string; institution: string; subtype: string | null; mask: string; }
export interface DemoTransaction extends TransactionInput { description: string; }
export interface DemoDataset {
  profile: typeof koaProfile;
  accounts: DemoAccount[];
  transactions: DemoTransaction[];
  events: FinancialEvent[];
  config: SnapshotBuilderConfig;
}
export function generateKoaHoldings(): DemoDataset;
```

- [ ] **Step 1: Rewrite the generator**

Rewrite `src/lib/demo-data/koa-holdings.ts`. Keep: `koaProfile`, seed `20260715`, end date `2026-07-15`, 430 days, the schedule constants (PAYCHECK 3200 +250 raise in 2026, MORTGAGE 2850 on 1st, UTILITIES 380 on 5th, INSURANCE 210 on 10th, INVESTMENT 500 on 12th, CC_PAYMENT 640 on 13th, BONUS 2500 on the 20th of Feb/May/Aug/Nov, ESSENTIAL_DAILY 70 ± noise, card spend 13+rand*16, large purchases at p≈0.024, SAFETY_BUFFER 2500), and the event emission. Change: every cash movement becomes a `DemoTransaction`; balances are tracked forward and the **final** balances become each account's `currentBalance`.

Full replacement for the simulation section (the file keeps `koaProfile` and the `Day`/`enumerateDays`/`BONUS_MONTHS`/`daysToNextPaycheck` helpers as-is; `scheduledOutflows` is deleted — obligations now come from the snapshot builder):

```ts
import type { FinancialEvent, ISODate } from "../financial-engine/types";
import type {
  AccountInput,
  SnapshotBuilderConfig,
  TransactionInput,
} from "../financial-engine/snapshot-builder";
import { mulberry32 } from "./prng";

// … koaProfile, constants, Day helpers unchanged …

export interface DemoAccount extends AccountInput {
  provider: "demo";
  displayName: string;
  institution: string;
  subtype: string | null;
  mask: string;
}

export interface DemoTransaction extends TransactionInput {
  description: string;
}

export interface DemoDataset {
  profile: typeof koaProfile;
  accounts: DemoAccount[];
  transactions: DemoTransaction[];
  events: FinancialEvent[];
  config: SnapshotBuilderConfig;
}

const CHK = "koa-checking";
const CARD = "koa-card";
const BRK = "koa-brokerage";
const PROP = "koa-property";
const MTG = "koa-mortgage";

export function generateKoaHoldings(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 14_000;
  let card = 2_400;
  let brokerage = 88_000;

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
    const id = `koa-t-${tSeq++}`;
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
    events.push({ id: `koa-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `koa-t-${tSeq}`;
    const inId = `koa-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? PAYCHECK + 250 : PAYCHECK;
    if (day.d === 1 || day.d === 15) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    if (day.d === 20 && BONUS_MONTHS.has(day.m)) {
      checking += BONUS;
      pushTxn(day, CHK, BONUS, "inflow", "Quarterly bonus", { category: "income" });
      pushEvent(day, "bonus", "Bonus", BONUS, "inflow");
    }
    if (day.d === 1) {
      checking -= MORTGAGE;
      pushTxn(day, CHK, MORTGAGE, "outflow", "Mortgage payment", { category: "housing", essential: true });
      pushEvent(day, "mortgage_payment", "Mortgage", MORTGAGE, "outflow");
    }
    if (day.d === 5) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 10) {
      checking -= INSURANCE;
      pushTxn(day, CHK, INSURANCE, "outflow", "Auto insurance", { category: "insurance", essential: true });
      pushEvent(day, "insurance_payment", "Auto Insurance", INSURANCE, "outflow");
    }
    if (day.d === 12) {
      checking -= INVESTMENT;
      brokerage += INVESTMENT;
      transfer(day, CHK, BRK, INVESTMENT, "Brokerage contribution");
      pushEvent(day, "investment_contribution", "Investment", INVESTMENT, "outflow");
    }
    if (day.d === 13) {
      const payment = Math.min(CC_PAYMENT, card);
      if (payment > 0) {
        checking -= payment;
        card -= payment;
        transfer(day, CHK, CARD, payment, "Credit card payment");
        pushEvent(day, "debt_payment", "Credit Card", payment, "outflow");
      }
    }

    const essentials = ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 30);
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    const cardSpend = Math.round(13 + rand() * 16);
    card += cardSpend;
    pushTxn(day, CARD, cardSpend, "outflow", "Card purchases", { category: "discretionary", essential: false });

    if (rand() < 0.024) {
      const amount = Math.round(250 + rand() * 450);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Large purchase", { category: "shopping", essential: false });
      pushEvent(day, "large_purchase", "Large Purchase", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Everyday Checking", institution: "Pacific Bank", subtype: null, mask: "4821" },
    { id: CARD, type: "credit_card", currentBalance: Math.round(card), includeInCalculations: true, provider: "demo", displayName: "Rewards Card", institution: "Pacific Bank", subtype: null, mask: "7710" },
    { id: BRK, type: "brokerage", currentBalance: Math.round(brokerage), includeInCalculations: true, provider: "demo", displayName: "Brokerage", institution: "Island Invest", subtype: null, mask: "0093" },
    { id: PROP, type: "property", currentBalance: 640_000, includeInCalculations: true, provider: "demo", displayName: "Primary Residence", institution: "—", subtype: "primary_residence", mask: "0001" },
    { id: MTG, type: "mortgage", currentBalance: 412_000, includeInCalculations: true, provider: "demo", displayName: "Home Mortgage", institution: "Pacific Bank", subtype: null, mask: "5540" },
  ];

  return {
    profile: koaProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
```

Note: brokerage market drift is intentionally dropped (owner-created equity story; drift returns with real investment data). Property and mortgage have no transactions, so their balances replay as constants.

- [ ] **Step 2: Rewrite the demo tests**

Rewrite `src/lib/demo-data/koa-holdings.test.ts`:

```ts
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
```

If the plausibility or improving-arc assertions fail, tune **demo constants only** (starting balances, ESSENTIAL_DAILY, card spend) — never the engine — and record the tuning in the commit message.

- [ ] **Step 3: Keep the app compiling — temporary page change**

In `src/app/page.tsx`, replace the body with:

```tsx
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { buildDailySnapshots } from "@/lib/financial-engine";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";

// Temporary: still in-memory. Task 12 swaps this for Supabase queries.
export default function HomePage() {
  const { profile, accounts, transactions, events, config } = generateKoaHoldings();
  const snapshots = buildDailySnapshots(accounts, transactions, config);
  return <HomeDashboard profile={profile} snapshots={snapshots} events={events} />;
}
```

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass (34+ tests).

- [ ] **Step 5: Visually sanity-check the chart still renders**

Run: `pnpm dev` (background), open http://localhost:3000, confirm the dashboard chart renders with all three lines. Stop after checking.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demo-data src/app/page.tsx
git commit -m "feat: demo generator emits accounts+transactions; snapshots derived by builder"
```

---

### Task 7: Row mappers + data queries

**Files:**
- Create: `src/lib/data/mappers.ts`, `src/lib/data/queries.ts`
- Test: `src/lib/data/mappers.test.ts`

**Interfaces:**
- Consumes: engine types; `DemoAccount`, `DemoTransaction` from Task 6.
- Produces (Tasks 8 and 12 depend on these):

```ts
// mappers.ts
export interface SnapshotRow { user_id: string; date: string; liquid_assets: number; revolving_balances: number; near_term_obligations: number; essential_obligations: number; safety_buffer: number; net_worth: number; engine_version: string; data_coverage_confidence: string; }
export interface EventRow { id?: string; user_id: string; date: string; type: string; label: string; amount: number; direction: string; }
export function snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow;
export function rowToSnapshot(row: SnapshotRow): DailySnapshot;
export function eventToRow(userId: string, e: FinancialEvent): EventRow;
export function rowToEvent(row: EventRow & { id: string }): FinancialEvent;
export function demoAccountToRow(userId: string, a: DemoAccount): Record<string, unknown>;
export function demoTransactionToRow(userId: string, accountIdMap: Map<string, string>, txnIdMap: Map<string, string>, t: DemoTransaction): Record<string, unknown>;

// queries.ts (server-only)
export interface ProfileRow { id: string; username: string; age_cohort: string; income_band: string; household_type: string; col_cohort: string; objective: string; onboarding_completed_at: string | null; }
export interface CompanyRow { id: string; user_id: string; name: string; ticker: string; }
export async function getProfile(supabase: SupabaseClient): Promise<ProfileRow | null>;
export async function getCompany(supabase: SupabaseClient): Promise<CompanyRow | null>;
export async function getDashboardData(supabase: SupabaseClient): Promise<{ snapshots: DailySnapshot[]; events: FinancialEvent[] }>;
```

- [ ] **Step 1: Write failing mapper tests**

Create `src/lib/data/mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rowToSnapshot, snapshotToRow, eventToRow, rowToEvent } from "./mappers";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import { ENGINE_VERSION } from "@/lib/financial-engine";

const snapshot: DailySnapshot = {
  date: "2026-07-15", liquidAssets: 17015, revolvingBalances: 2100,
  nearTermObligations: 4040, essentialObligations: 3200, safetyBuffer: 2500, netWorth: 320000,
};

const event: FinancialEvent = {
  id: "e1", date: "2026-07-15", type: "paycheck", label: "Paycheck", amount: 3450, direction: "inflow",
};

describe("mappers", () => {
  it("snapshot round-trips through its row shape", () => {
    const row = snapshotToRow("user-1", snapshot);
    expect(row.user_id).toBe("user-1");
    expect(row.engine_version).toBe(ENGINE_VERSION);
    expect(rowToSnapshot(row)).toEqual(snapshot);
  });

  it("event round-trips through its row shape", () => {
    const row = eventToRow("user-1", event);
    expect(row.user_id).toBe("user-1");
    expect(rowToEvent({ ...row, id: "e1" })).toEqual(event);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement mappers**

Create `src/lib/data/mappers.ts`:

```ts
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import { ENGINE_VERSION } from "@/lib/financial-engine";
import type { DemoAccount, DemoTransaction } from "@/lib/demo-data/koa-holdings";

export interface SnapshotRow {
  user_id: string; date: string; liquid_assets: number; revolving_balances: number;
  near_term_obligations: number; essential_obligations: number; safety_buffer: number;
  net_worth: number; engine_version: string; data_coverage_confidence: string;
}

export function snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow {
  return {
    user_id: userId, date: s.date, liquid_assets: s.liquidAssets,
    revolving_balances: s.revolvingBalances, near_term_obligations: s.nearTermObligations,
    essential_obligations: s.essentialObligations, safety_buffer: s.safetyBuffer,
    net_worth: s.netWorth, engine_version: ENGINE_VERSION, data_coverage_confidence: "demo",
  };
}

export function rowToSnapshot(row: SnapshotRow): DailySnapshot {
  return {
    date: row.date, liquidAssets: Number(row.liquid_assets),
    revolvingBalances: Number(row.revolving_balances),
    nearTermObligations: Number(row.near_term_obligations),
    essentialObligations: Number(row.essential_obligations),
    safetyBuffer: Number(row.safety_buffer), netWorth: Number(row.net_worth),
  };
}

export interface EventRow {
  id?: string; user_id: string; date: string; type: string; label: string;
  amount: number; direction: string;
}

export function eventToRow(userId: string, e: FinancialEvent): EventRow {
  return { user_id: userId, date: e.date, type: e.type, label: e.label, amount: e.amount, direction: e.direction };
}

export function rowToEvent(row: EventRow & { id: string }): FinancialEvent {
  return {
    id: row.id, date: row.date, type: row.type as FinancialEvent["type"],
    label: row.label, amount: Number(row.amount),
    direction: row.direction as FinancialEvent["direction"],
  };
}

export function demoAccountToRow(userId: string, a: DemoAccount): Record<string, unknown> {
  return {
    user_id: userId, provider: a.provider, institution: a.institution, type: a.type,
    subtype: a.subtype, display_name: a.displayName, mask: a.mask,
    current_balance: a.currentBalance, include_in_calculations: a.includeInCalculations,
    connection_status: "ok", last_synced_at: new Date().toISOString(),
  };
}

/**
 * Demo transactions carry generator-local ids ("koa-t-3"); the DB assigns
 * uuids. `accountIdMap` maps generator account ids → DB uuids and `txnIdMap`
 * maps generator txn ids → pre-allocated DB uuids so transfer pairs stay linked.
 */
export function demoTransactionToRow(
  userId: string,
  accountIdMap: Map<string, string>,
  txnIdMap: Map<string, string>,
  t: DemoTransaction,
): Record<string, unknown> {
  return {
    id: txnIdMap.get(t.id), account_id: accountIdMap.get(t.accountId), user_id: userId,
    posted_date: t.postedDate, amount: t.amount, direction: t.direction,
    description: t.description, category: t.category, essential: t.essential,
    is_transfer: t.isTransfer,
    transfer_pair_id: t.transferPairId ? (txnIdMap.get(t.transferPairId) ?? null) : null,
  };
}
```

- [ ] **Step 4: Implement queries**

Create `src/lib/data/queries.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import { rowToSnapshot, rowToEvent, type SnapshotRow, type EventRow } from "./mappers";

export interface ProfileRow {
  id: string; username: string; age_cohort: string; income_band: string;
  household_type: string; col_cohort: string; objective: string;
  onboarding_completed_at: string | null;
}

export interface CompanyRow { id: string; user_id: string; name: string; ticker: string; }

export async function getProfile(supabase: SupabaseClient): Promise<ProfileRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("user_profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCompany(supabase: SupabaseClient): Promise<CompanyRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("personal_companies").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDashboardData(
  supabase: SupabaseClient,
): Promise<{ snapshots: DailySnapshot[]; events: FinancialEvent[] }> {
  const [snapRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (eventRes.error) throw eventRes.error;
  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}
```

Install the guard package: `pnpm add server-only`

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `pnpm vitest run src/lib/data && pnpm typecheck`
Expected: PASS / clean.

```bash
git add src/lib/data package.json pnpm-lock.yaml
git commit -m "feat: row mappers and server data queries"
```

---

### Task 8: Server actions — seed, clear, rebuild

**Files:**
- Create: `src/app/actions/demo.ts`

**Interfaces:**
- Consumes: `generateKoaHoldings`, `buildDailySnapshots`, mappers, server `createClient`.
- Produces: `loadDemoData(): Promise<void>` and `clearDemoData(): Promise<void>` server actions (Task 11 onboarding and Task 12 empty state call `loadDemoData`).

- [ ] **Step 1: Implement**

Create `src/app/actions/demo.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";
import { buildDailySnapshots } from "@/lib/financial-engine";
import { demoAccountToRow, demoTransactionToRow, eventToRow, snapshotToRow } from "@/lib/data/mappers";

const CHUNK = 500;

async function insertChunked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  rows: Record<string, unknown>[],
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}

export async function loadDemoData(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Idempotent: clear any prior demo rows so a re-seed can't violate the
  // daily_snapshots PK or duplicate accounts.
  await clearDemoRows(supabase, user.id);

  const { accounts, transactions, events, config } = generateKoaHoldings();

  // Accounts first (need their DB ids for transactions).
  const accountRows = accounts.map((a) => demoAccountToRow(user.id, a));
  const { data: insertedAccounts, error: accErr } = await supabase
    .from("financial_accounts").insert(accountRows).select("id, display_name");
  if (accErr) throw new Error(`insert accounts failed: ${accErr.message}`);

  const accountIdMap = new Map<string, string>();
  accounts.forEach((a) => {
    const match = insertedAccounts!.find((r) => r.display_name === a.displayName)!;
    accountIdMap.set(a.id, match.id);
  });

  // Pre-allocate txn uuids so transfer pairs stay linked.
  const txnIdMap = new Map(transactions.map((t) => [t.id, randomUUID()]));
  await insertChunked(
    supabase, "transactions",
    transactions.map((t) => demoTransactionToRow(user.id, accountIdMap, txnIdMap, t)),
  );
  await insertChunked(supabase, "financial_events", events.map((e) => eventToRow(user.id, e)));

  const snapshots = buildDailySnapshots(accounts, transactions, config);
  await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));

  revalidatePath("/");
}

async function clearDemoRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  // Transactions cascade from accounts. Events and snapshots are demo-only in this phase.
  const del1 = await supabase.from("financial_accounts").delete().eq("provider", "demo");
  if (del1.error) throw new Error(del1.error.message);
  const del2 = await supabase.from("financial_events").delete().eq("user_id", userId);
  if (del2.error) throw new Error(del2.error.message);
  const del3 = await supabase.from("daily_snapshots").delete().eq("user_id", userId);
  if (del3.error) throw new Error(del3.error.message);
}

export async function clearDemoData(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  await clearDemoRows(supabase, user.id);
  revalidatePath("/");
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (Behavioral verification: Task 12 end-to-end + Task 13 RLS script.)

```bash
git add src/app/actions/demo.ts
git commit -m "feat: demo seed/clear server actions through the real pipeline"
```

---

### Task 9: Login page, auth callback, sign-out

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`, `src/app/auth/callback/route.ts`, `src/app/actions/auth.ts`, `src/components/nav/SignOutButton.tsx`

**Interfaces:**
- Produces: `/login` route, `/auth/callback` code exchange, `signOut()` server action, `<SignOutButton />` (Task 12 renders it).

- [ ] **Step 1: Auth callback route**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
```

- [ ] **Step 2: Sign-out action + button**

Create `src/app/actions/auth.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

Create `src/components/nav/SignOutButton.tsx`:

```tsx
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="flex items-center gap-1.5 text-xs text-tertiary transition-colors hover:text-primary"
      >
        <LogOut size={13} aria-hidden />
        Sign out
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Login page**

Create `src/app/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: `Sign in — ${branding.productName}` };

export default function LoginPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">{branding.productName}</h1>
        <p className="mt-1 text-sm text-secondary">{branding.tagline}</p>
      </header>
      <LoginForm />
      <p className="text-center text-xs text-tertiary">
        {branding.productName} is an educational analytics tool, not financial advice.
      </p>
    </div>
  );
}
```

Create `src/app/login/LoginForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const params = useSearchParams();
  const linkError = params.get("error");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <Card className="p-6">
      {status === "sent" ? (
        <p className="text-sm text-primary" role="status">
          Check your email — we sent a sign-in link to <span className="font-medium">{email}</span>.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium text-primary">
            Sign in with your email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {(status === "error" || linkError) && (
            <p className="text-sm text-negative" role="alert">
              {linkError ? "That sign-in link expired or was invalid. Try again." : "Could not send the link. Check the address and try again."}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
```

Note: `useSearchParams` requires a Suspense boundary in the page — wrap `<LoginForm />` in `<Suspense>` in `page.tsx` (`import { Suspense } from "react"`).

- [ ] **Step 4: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean; `/login` and `/auth/callback` appear in the route list.

```bash
git add src/app/login src/app/auth src/app/actions/auth.ts src/components/nav/SignOutButton.tsx
git commit -m "feat: magic-link login, auth callback, sign-out"
```

---

### Task 10: Middleware route guard

**Files:**
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: env vars.
- Produces: session refresh + redirects (unauthed → `/login`; authed on `/login` → `/`).

- [ ] **Step 1: Implement**

Create `src/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/config/env";

const PUBLIC_PREFIXES = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Required between createServerClient and any response logic — refreshes the session.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
```

- [ ] **Step 2: Verify the guard in a browser**

Run: `pnpm dev` (background). Open http://localhost:3000 in a fresh session.
Expected: redirected to `/login`, which renders the email form. `/rankings` also redirects.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: session-refresh middleware with route guard"
```

---

### Task 11: Onboarding flow

**Files:**
- Create: `src/lib/config/cohorts.ts`, `src/lib/validation/onboarding.ts`, `src/app/actions/onboarding.ts`, `src/app/onboarding/page.tsx`, `src/app/onboarding/OnboardingForm.tsx`
- Test: `src/lib/validation/onboarding.test.ts`

**Interfaces:**
- Consumes: `loadDemoData` (Task 8), server client, `ProfileRow`.
- Produces: `/onboarding` route; `completeOnboarding(values: OnboardingValues): Promise<{ error?: string }>`; `onboardingSchema` (Zod) + `OnboardingValues` type.

- [ ] **Step 1: Cohort constants**

Create `src/lib/config/cohorts.ts`:

```ts
/** Broad bands only — exact ages/incomes are never collected (privacy by construction). */
export const AGE_COHORTS = ["18–29", "30–39", "40–49", "50–59", "60+"] as const;
export const INCOME_BANDS = ["<$50k", "$50k–$100k", "$100k–$150k", "$150k–$200k", "$200k+"] as const;
export const HOUSEHOLD_TYPES = ["Single", "Couple", "Family with children", "Multi-generational", "Other"] as const;
export const COL_CATEGORIES = ["Low-Cost Region", "Mid-Cost Region", "High-Cost Region"] as const;
export const OBJECTIVES = [
  { value: "increase_liquidity", label: "Build cash cushion" },
  { value: "reduce_debt", label: "Pay down debt" },
  { value: "build_emergency_fund", label: "Build emergency fund" },
  { value: "grow_investments", label: "Grow investments" },
  { value: "buy_home", label: "Save for a home" },
  { value: "financial_independence", label: "Financial independence" },
] as const;
```

- [ ] **Step 2: Failing validation tests**

Create `src/lib/validation/onboarding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./onboarding";

const valid = {
  companyName: "Koa Holdings", ticker: "KOAH", username: "IslandBuilder",
  ageCohort: "40–49", incomeBand: "$150k–$200k", householdType: "Couple",
  colCohort: "High-Cost Region", objective: "increase_liquidity", loadDemo: true,
};

describe("onboardingSchema", () => {
  it("accepts a valid payload", () => {
    expect(onboardingSchema.parse(valid)).toMatchObject({ ticker: "KOAH" });
  });

  it("uppercases and validates tickers", () => {
    expect(onboardingSchema.parse({ ...valid, ticker: "koah" }).ticker).toBe("KOAH");
    expect(() => onboardingSchema.parse({ ...valid, ticker: "TOOLONG1" })).toThrow();
  });

  it("rejects usernames with spaces or symbols", () => {
    expect(() => onboardingSchema.parse({ ...valid, username: "island builder" })).toThrow();
  });

  it("rejects unknown cohort values", () => {
    expect(() => onboardingSchema.parse({ ...valid, ageCohort: "exactly 43" })).toThrow();
  });
});
```

Run: `pnpm vitest run src/lib/validation` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement schema**

Create `src/lib/validation/onboarding.ts`:

```ts
import { z } from "zod";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";

export const onboardingSchema = z.object({
  companyName: z.string().trim().min(2).max(40),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "2–5 letters"),
  username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers, underscores"),
  ageCohort: z.enum(AGE_COHORTS),
  incomeBand: z.enum(INCOME_BANDS),
  householdType: z.enum(HOUSEHOLD_TYPES),
  colCohort: z.enum(COL_CATEGORIES),
  objective: z.enum(OBJECTIVES.map((o) => o.value) as [string, ...string[]]),
  loadDemo: z.boolean(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
```

Run: `pnpm vitest run src/lib/validation` — Expected: PASS.

- [ ] **Step 4: Server action**

Create `src/app/actions/onboarding.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { loadDemoData } from "./demo";

export async function completeOnboarding(values: OnboardingValues): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { error: profileErr } = await supabase.from("user_profiles").insert({
    id: user.id, username: v.username, age_cohort: v.ageCohort, income_band: v.incomeBand,
    household_type: v.householdType, col_cohort: v.colCohort, objective: v.objective,
    onboarding_completed_at: new Date().toISOString(),
  });
  if (profileErr) {
    return { error: profileErr.code === "23505" ? "That username is taken." : profileErr.message };
  }

  const { error: companyErr } = await supabase.from("personal_companies").insert({
    user_id: user.id, name: v.companyName, ticker: `$${v.ticker}`,
  });
  if (companyErr) return { error: companyErr.message };

  if (v.loadDemo) await loadDemoData();
  redirect("/");
}
```

(`redirect` throws, so the success path never returns — the return type covers the error path.)

- [ ] **Step 5: Onboarding UI**

Create `src/app/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/queries";
import { branding } from "@/lib/config/branding";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: `Get started — ${branding.productName}` };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (profile?.onboarding_completed_at) redirect("/");
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-primary">Create your personal company</h1>
        <p className="mt-1 text-sm text-secondary">
          Your finances, presented like a public company. Only your company name, ticker, and
          username can ever be visible to others — never your real identity or balances.
        </p>
      </header>
      <OnboardingForm />
    </div>
  );
}
```

Create `src/app/onboarding/OnboardingForm.tsx` — a two-step client form (React Hook Form + `zodResolver`; if `zodResolver` type-errors with Zod 4, use `standardSchemaResolver` from `@hookform/resolvers/standard-schema`):

```tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { completeOnboarding } from "@/app/actions/onboarding";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";
import { Card } from "@/components/ui/Card";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function OnboardingForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { loadDemo: true } as Partial<OnboardingValues> as OnboardingValues,
    mode: "onTouched",
  });
  const { register, handleSubmit, trigger, formState: { errors, isSubmitting } } = form;

  async function next() {
    if (await trigger(["companyName", "ticker", "username"])) setStep(2);
  }

  async function onSubmit(values: OnboardingValues) {
    setServerError(null);
    const result = await completeOnboarding(values);
    if (result?.error) setServerError(result.error);
  }

  return (
    <Card className="p-6">
      <p className="mb-4 text-xs text-tertiary" aria-live="polite">Step {step} of 2</p>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {step === 1 && (
          <>
            <Field label="Company name" error={errors.companyName?.message}>
              <input className={inputCls} placeholder="Koa Holdings" {...register("companyName")} />
            </Field>
            <Field label="Ticker (2–5 letters)" error={errors.ticker?.message}>
              <input className={`${inputCls} uppercase`} placeholder="KOAH" maxLength={5} {...register("ticker")} />
            </Field>
            <Field label="Username" error={errors.username?.message}>
              <input className={inputCls} placeholder="IslandBuilder" {...register("username")} />
            </Field>
            <button type="button" onClick={next} className="mt-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base">
              Continue
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="Age range" error={errors.ageCohort?.message}>
              <Select options={AGE_COHORTS} {...register("ageCohort")} />
            </Field>
            <Field label="Household income" error={errors.incomeBand?.message}>
              <Select options={INCOME_BANDS} {...register("incomeBand")} />
            </Field>
            <Field label="Household type" error={errors.householdType?.message}>
              <Select options={HOUSEHOLD_TYPES} {...register("householdType")} />
            </Field>
            <Field label="Cost of living" error={errors.colCohort?.message}>
              <Select options={COL_CATEGORIES} {...register("colCohort")} />
            </Field>
            <Field label="Primary objective" error={errors.objective?.message}>
              <select className={inputCls} defaultValue="" {...register("objective")}>
                <option value="" disabled>Select…</option>
                {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" {...register("loadDemo")} className="size-4" />
              Load sample data so I can explore first
            </label>
            {serverError && <p className="text-sm text-negative" role="alert">{serverError}</p>}
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary">
                Back
              </button>
              <button type="submit" disabled={isSubmitting} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
                {isSubmitting ? "Creating…" : "Create my company"}
              </button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className="text-xs text-negative" role="alert">{error}</p>}
    </div>
  );
}

function Select({ options, ...rest }: { options: readonly string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={inputCls} defaultValue="" {...rest}>
      <option value="" disabled>Select…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
```

- [ ] **Step 6: Run checks and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green; `/onboarding` in the route list.

```bash
git add src/lib/config/cohorts.ts src/lib/validation src/app/actions/onboarding.ts src/app/onboarding
git commit -m "feat: onboarding flow (identity, cohorts, objective, demo seed)"
```

---

### Task 12: Dashboard on real data + empty/loading states

**Files:**
- Modify: `src/app/page.tsx`, `src/components/dashboard/HomeDashboard.tsx` (profile prop type)
- Create: `src/components/dashboard/EmptyDashboard.tsx`, `src/app/loading.tsx`

**Interfaces:**
- Consumes: `getProfile`, `getCompany`, `getDashboardData`, `loadDemoData`, `SignOutButton`.
- Produces: `DashboardIdentity` type exported from `HomeDashboard.tsx`:

```ts
export interface DashboardIdentity { companyName: string; ticker: string; username: string; level?: number; }
```

- [ ] **Step 1: Decouple HomeDashboard from the demo profile type**

In `src/components/dashboard/HomeDashboard.tsx`: remove `import type { koaProfile } ...`; add the exported `DashboardIdentity` interface above the props; change the prop to `profile: DashboardIdentity`. `CompanyHeader` usage is unchanged (it already takes the four fields).

- [ ] **Step 2: Empty state**

Create `src/components/dashboard/EmptyDashboard.tsx`:

```tsx
import { Database } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoData } from "@/app/actions/demo";

export function EmptyDashboard({ companyName }: { companyName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-primary">{companyName}</h1>
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-neutral-muted text-secondary">
          <Database size={24} />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">No financial data yet</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            Load the sample dataset to explore, or add accounts once manual entry ships.
          </p>
        </div>
        <form action={loadDemoData}>
          <button type="submit" className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base">
            Load demo data
          </button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Loading skeleton**

Create `src/app/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading dashboard" role="status">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-elevated" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-elevated" />
          <div className="h-3 w-20 rounded bg-elevated" />
        </div>
      </div>
      <div className="h-96 rounded-card bg-elevated" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-card bg-elevated" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the home page**

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getDashboardData, getProfile } from "@/lib/data/queries";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { EmptyDashboard } from "@/components/dashboard/EmptyDashboard";
import { SignOutButton } from "@/components/nav/SignOutButton";

export default async function HomePage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  const { snapshots, events } = await getDashboardData(supabase);

  return (
    <div className="flex flex-col gap-6">
      {snapshots.length === 0 ? (
        <EmptyDashboard companyName={company.name} />
      ) : (
        <HomeDashboard
          profile={{ companyName: company.name, ticker: company.ticker, username: profile.username }}
          snapshots={snapshots}
          events={events}
        />
      )}
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Full check + end-to-end browser verification (mobile first)**

Run: `pnpm check` — Expected: green.

Then verify the real flow. Magic-link email can't be clicked headlessly, so generate a session link with the admin API. First fetch the service-role key into `.env.local`:

```bash
supabase projects api-keys --project-ref dgkcmvjfvdlsyuhuewkx | grep service_role
# append to .env.local:  SUPABASE_SERVICE_ROLE_KEY=<value>
```

Create `scripts/dev-login.ts` (committed — dev utility, reads env, no secrets inline):

```ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const email = process.argv[2] ?? "dev@example.com";

const admin = createClient(url, service);
const { data: existing } = await admin.auth.admin.listUsers();
if (!existing.users.some((u) => u.email === email)) {
  await admin.auth.admin.createUser({ email, email_confirm: true });
}
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error) throw error;
console.log(data.properties.action_link);
```

Run: `pnpm exec tsx --env-file=.env.local scripts/dev-login.ts dev@example.com`
Open the printed link in the browser (388–392px viewport): expect redirect through `/auth/callback` → `/onboarding`. Complete onboarding with demo data checked → dashboard renders Koa Holdings from **database rows**. Check desktop (1280px) too. Confirm no console errors and that sign-out returns to `/login`.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/loading.tsx src/components/dashboard scripts/dev-login.ts
git commit -m "feat: dashboard reads Supabase; empty + loading states; dev login utility"
```

---

### Task 13: RLS tenant-isolation test

**Files:**
- Create: `scripts/test-rls.ts`
- Modify: `package.json` (add script `"test:rls": "tsx --env-file=.env.local scripts/test-rls.ts"`)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.

- [ ] **Step 1: Write the isolation test**

Create `scripts/test-rls.ts`:

```ts
/**
 * Tenant-isolation test: creates two throwaway users, seeds a profile and an
 * account for user A, then asserts user B cannot read, write, update, or
 * delete any of A's rows through the anon-key client. Exits 1 on any failure.
 * Cleans up both users (cascades wipe their rows).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey);
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

async function makeUser(tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `rls-test-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const client = createClient(url, anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
  return { id: data.user.id, client };
}

const a = await makeUser("a");
const b = await makeUser("b");

try {
  // A creates their rows.
  const { error: pErr } = await a.client.from("user_profiles").insert({
    id: a.id, username: `rls_a_${randomUUID().slice(0, 6)}`, age_cohort: "30–39",
    income_band: "$50k–$100k", household_type: "Single", col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
  });
  check("A can insert own profile", !pErr, pErr?.message);

  const { data: acct, error: aErr } = await a.client.from("financial_accounts")
    .insert({ user_id: a.id, provider: "manual", type: "checking", display_name: "A checking" })
    .select("id").single();
  check("A can insert own account", !aErr && !!acct, aErr?.message);

  // B (needs own profile to satisfy FKs on their own writes).
  await b.client.from("user_profiles").insert({
    id: b.id, username: `rls_b_${randomUUID().slice(0, 6)}`, age_cohort: "30–39",
    income_band: "$50k–$100k", household_type: "Single", col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
  });

  // B attempts to touch A's data.
  const { data: readProfiles } = await b.client.from("user_profiles").select("*").eq("id", a.id);
  check("B cannot read A's profile", (readProfiles ?? []).length === 0);

  const { data: readAccounts } = await b.client.from("financial_accounts").select("*").eq("user_id", a.id);
  check("B cannot read A's accounts", (readAccounts ?? []).length === 0);

  const { error: forgeErr } = await b.client.from("financial_accounts")
    .insert({ user_id: a.id, provider: "manual", type: "checking", display_name: "forged" });
  check("B cannot insert rows owned by A", !!forgeErr);

  const { data: updated } = await b.client.from("financial_accounts")
    .update({ display_name: "hacked" }).eq("id", acct!.id).select();
  check("B cannot update A's account", (updated ?? []).length === 0);

  const { data: deleted } = await b.client.from("financial_accounts")
    .delete().eq("id", acct!.id).select();
  check("B cannot delete A's account", (deleted ?? []).length === 0);

  const { data: snapForge } = await b.client.from("daily_snapshots")
    .insert({
      user_id: a.id, date: "2026-01-01", liquid_assets: 0, revolving_balances: 0,
      near_term_obligations: 0, essential_obligations: 0, safety_buffer: 0, net_worth: 0,
      engine_version: "test",
    }).select();
  check("B cannot insert snapshots for A", (snapForge ?? []).length === 0 || snapForge === null);

  const anonClient = createClient(url, anonKey);
  const { data: anonRead } = await anonClient.from("user_profiles").select("*");
  check("Unauthenticated client reads nothing", (anonRead ?? []).length === 0);
} finally {
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
}

console.log(failures === 0 ? "\nRLS isolation: ALL CHECKS PASSED" : `\nRLS isolation: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Add the npm script and run it**

Add to `package.json` scripts: `"test:rls": "tsx --env-file=.env.local scripts/test-rls.ts"`.

Run: `pnpm test:rls`
Expected: every line `✓`, exit 0. If any `✗`, the RLS policies are wrong — fix migration (new migration file, never edit an applied one), push, rerun.

If `tsx` rejects `--env-file`, use the Node loader form instead:
`node --env-file=.env.local --import tsx scripts/test-rls.ts` (update the npm script accordingly).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-rls.ts package.json
git commit -m "test: automated RLS tenant-isolation checks"
```

---

### Task 14: Documentation + final verification

**Files:**
- Modify: `docs/CURRENT_PHASE.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/ROADMAP.md`, `README.md`, `docs/FINANCIAL_INDEX_METHODOLOGY.md`

- [ ] **Step 1: Record decisions**

Append to `docs/DECISIONS.md` (entry #7, dated 2026-07-15): infrastructure phase pulled forward ahead of remaining Phase 1 screens (user decision; supersedes the sequencing implied by #3 — note that #3's env-flip consequence has now happened); snapshots store raw dollar components with index computed at read time; magic-link-only auth; demo data seeds through the real pipeline. Include alternatives + consequences per the house format.

- [ ] **Step 2: Update the other docs**

- `DATA_MODEL.md`: mark the six implemented tables as “implemented (migration 0001)”; update `daily_snapshots` field list to the raw-components shape; note goals/recommendations/cohorts remain drafts.
- `SECURITY_MODEL.md`: move RLS/tenant isolation from “rules for Phase 3+” to “implemented”, reference `pnpm test:rls`; note service-role key usage is confined to `scripts/` via `.env.local`.
- `FINANCIAL_INDEX_METHODOLOGY.md`: add a “Snapshot derivation (v1)” section documenting income-date detection, obligation windows, the 28-day previous-cycle proxy, and liability-vs-asset replay semantics.
- `KNOWN_LIMITATIONS.md`: add — obligations v1 uses actual forward transactions (recurrence detection comes with real imports); mortgage/property balances static (no principal amortization); demo market drift removed; magic-link email deliverability on default SMTP; `clearDemoData` clears all events/snapshots (fine while demo is the only source).
- `ROADMAP.md`: insert “Phase 1.5 — Infrastructure ✅” with a one-line scope; adjust Phase 3 to “manual data + CSV (persistence already live)”.
- `README.md`: status line (auth + database live), add `pnpm test:rls`, quick note that `.env.local` needs the two public vars (+ service key for RLS tests).
- `CURRENT_PHASE.md`: full rewrite — completed (this phase), next three priorities (suggest: rankings screen on mock cohort data; manual accounts/transactions CRUD; remaining demo profiles), test status including RLS run, deployment status.

- [ ] **Step 2b: Update CLAUDE.md if needed**

Check `CLAUDE.md` architecture bullets still hold (they do — Supabase arriving is already anticipated; update the sentence that says env vars “flip from optional to required then” to past tense).

- [ ] **Step 3: Final full verification**

Run: `pnpm check && pnpm test:rls`
Expected: all green. Then a final browser pass at 390px and 1280px on `/login`, `/onboarding`, `/` (with data), `/` after `clearDemoData` (empty state renders — trigger by temporarily wiring a button or via SQL delete; verify empty state at minimum by direct navigation with a fresh user).

- [ ] **Step 4: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs: record infrastructure phase (decisions, security, methodology, status)"
```
