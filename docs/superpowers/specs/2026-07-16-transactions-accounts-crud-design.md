# Transactions Drill-Down & Accounts Management — Design

_Date: 2026-07-16 · Status: approved design, pre-plan · Slice of Phase 3 scope pulled forward per CURRENT_PHASE.md priority #1 and DECISIONS.md #12._

## Purpose

The first non-demo data path: users can see every transaction behind their index, correct categorization, add manual transactions, and manage accounts — all as drill-downs beneath the Home dashboard diagnosis, never as a new nav destination.

## Scope

**In:**

- `/transactions`: filterable cross-account transaction list, transaction detail, manual add/delete, recategorization via `user_override`.
- `/accounts`: accounts management — add manual account, edit account fields, include-in-calculations toggle, archive/unarchive.
- Dashboard drill-down wiring (Available Capital → `/accounts`; driver rows → date-filtered `/transactions`).
- Snapshot rebuild on balance-affecting mutations; stale-index detection.
- Migration `0003_manual_data` (adds `financial_accounts.archived_at`).

**Out (later slices):** CSV import, transfer pairing UI, splits, essential/discretionary marking UI, recurring detection, editing amount/date in place (edit model below), account deletion (archive only).

## Decisions locked during brainstorm

1. **Uniform override edit model.** All edits — demo or manual — write `user_override` (jsonb). Overridable fields this slice: `category`, `description`, `notes`. Amount/date mistakes on manual transactions are fixed by delete + re-add. The `transactions_immutable_source` trigger (migration 0002) stays untouched; provenance rule holds for every provider.
2. **Entry points:** Available Capital card and "What moved your line" driver rows. Drivers are `financial_events` (no category), so a driver deep-link is a **date-window filter**: `/transactions?from=<event date>&to=<event date>` plus a context banner naming the event, with one-tap clear.
3. **Fuller accounts management** is in scope (add/edit/include-toggle/archive), but as a drill-down; bottom nav stays four tabs (DECISIONS #12 is binding).
4. **Approach A — two flat routes** over account-scoped hierarchy or a tabbed hub: each screen has one job, and the filterable list is built once and serves every entry point.

## Information architecture

### `/transactions`

- Month-grouped rows: event-type icon, description, category chip, signed amount (sign + text, never color alone).
- Filters as query params: `account`, `category`, `direction`, `from`/`to`. Filter chips across the top; active-filter state shows a clear affordance.
- Floating "Add transaction" button.
- Row tap → detail **bottom-sheet** (mobile) / dialog (desktop): all fields, recategorize control, notes, delete (manual provider only). Add reuses the sheet in create mode.
- Corrected transactions (non-null `user_override`) show a "corrected" indicator; original values visible in the detail sheet.

### `/accounts`

- Account cards grouped by kind (cash / credit / loans / investments / property): balance, provider badge (demo/manual), include-in-calculations state, archived badge.
- Actions: add manual account (display name, type, institution, current balance, credit limit / interest rate where relevant), edit those fields, toggle include-in-calculations, archive/unarchive.
- Each card links to `/transactions?account=<id>`.

### Dashboard wiring

- Available Capital card → `/accounts`.
- Driver row → `/transactions?from=X&to=X` with context banner.
- Both routes: back affordance to Home; no bottom-nav tab highlighted (same treatment as onboarding).
- Mobile-first at 390px; desktop widens the same layout, sheets become dialogs/side panels.

## Data layer

### Migration `0003_manual_data`

- `alter table financial_accounts add column archived_at timestamptz` (null = active). Archived accounts: excluded from calculations and account pickers; transactions retained.
- No transactions schema change. New column inherits existing owner-only default-deny RLS.

### Effective-transaction merge (engine, pure)

- `src/lib/financial-engine/overrides.ts`: `applyOverride(txn)` merges `user_override` onto source columns → effective transaction + `corrected: boolean`.
- Every consumer (list UI, report engine, future metrics) reads effective transactions through this helper.
- **Invariant (tested):** overrides never touch `amount`/`posted_date`/`direction`, therefore never change balances or the index.

### Reads

- `getTransactionsData(filters)` and `getAccountsData()` server-side, RLS-bound client only, beside the existing `getDashboardData`. Transaction list paginated by month.

## Write path

Server actions in `src/app/actions/transactions.ts` and `src/app/actions/accounts.ts`, all Zod-validated:

- `createTransaction`, `deleteTransaction` (server-side reject for non-manual providers), `overrideTransaction(id, {category?, description?, notes?})`.
- `createAccount`, `updateAccount`, `setAccountIncluded`, `archiveAccount`, `unarchiveAccount`.

### Snapshot rebuild

- Balance-affecting mutations (transaction create/delete; account create, balance edit, include toggle, archive/unarchive) finish with `rebuildSnapshots(userId)`: read active accounts + transactions via RLS-bound client, run existing `buildDailySnapshots` backward replay, replace the user's `daily_snapshots` rows.
- Override edits skip the rebuild (invariant above).
- Manual accounts use demo semantics: user enters the **current** balance; history replays backward from it.
- Full rebuild per write is O(history) but trivially correct — accepted trade at household data volume; revisit only if measurably slow.

## States & error handling

- **Loading:** skeleton rows (`/transactions`) and skeleton cards (`/accounts`).
- **Empty:** true-empty list → explainer + "Add transaction" / "Load demo data"; zero-match filtered view → "No transactions match — clear filters" (distinct states). `/accounts` empty → "Add your first account".
- **Error:** query failure → inline retry panel; action failure → dismissible sheet error, user input preserved.
- **Partial:** archived/excluded accounts show a badge with a "Why?" affordance (excluded ≠ gone).
- Zod errors map to field-level messages (amount > 0, date not in future, name required).
- Delete/hard-edit of demo/CSV transactions: blocked in UI, rejected in the action, DB trigger as final backstop; copy points to recategorize.
- Rebuild failure after successful write: write stands; action returns "recalculating failed — data saved, refresh to retry"; rebuild retried on next mutation or dashboard load. `getDashboardData` cheaply checks `daily_snapshots` freshness vs latest transaction change and shows a stale-index notice — no silent divergence.

## Testing

- **Engine (Vitest, pure):** `applyOverride` merge rules; overrides-don't-change-balances invariant; rebuild identity (seed N transactions then rebuild ≡ build once, existing snapshot-builder tests as oracle); archive/exclude filtering.
- **Actions:** validation rejections; provider guards (delete of demo txn rejected); rebuild-trigger matrix (which mutations rebuild; override doesn't).
- **RLS:** extend `pnpm test:rls` with cross-tenant create/override/delete attempts on the new paths.
- **Manual:** `pnpm check` green; both routes × all four states at 390px and desktop; live drill-down links from Home.

## Consequences to record at implementation time

- New DECISIONS.md entry for the uniform override edit model (and archive-not-delete for accounts).
- KNOWN_LIMITATIONS: edits-by-delete-and-re-add UX for manual transactions; full-history rebuild cost note.
- CURRENT_PHASE.md updated when the slice lands.
