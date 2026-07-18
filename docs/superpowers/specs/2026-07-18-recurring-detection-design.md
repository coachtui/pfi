# Recurring Transaction Detection — Design

_Date: 2026-07-18. Status: approved in brainstorming; supersedes the 28-day obligations proxy (KNOWN_LIMITATIONS "Obligations v1")._

## Goal

Detect recurring transaction series (bills, subscriptions, paychecks, debt payments) deterministically from existing transaction history, and use them to replace the snapshot builder's 28-day previous-cycle proxy for obligation windows that extend past known history. Ship a minimal user-facing surface so detection is inspectable and correctable.

This completes ROADMAP Phase 3's remaining scope.

## Architecture (Approach A — pure-function detection, override-only persistence)

Detection is a pure, deterministic function over transactions — nothing detected is ever stored. It reruns wherever snapshots are built, so results never go stale and no refresh pipeline exists. The only persistence is user intent (confirm/dismiss), stored in a small `recurring_overrides` table mirroring the existing `user_override` correction pattern.

Alternatives considered and rejected:

- **Persisted `recurring_items` table** — stable row IDs for free, but introduces a second source of truth that can go stale (the same sync class the snapshot rebuild already manages) plus a refresh pipeline to build and test.
- **Hybrid (persist confirmed items only)** — the same concept in two representations, with permanent reconciliation complexity.

## 1. Detection module — `src/lib/financial-engine/recurring.ts`

Framework-free, pure, deterministic: reference date is passed in (the snapshot config's `endDate`), never `Date.now()`.

**Input:** the snapshot builder's transactions. `TransactionInput` gains a required `description: string` field (loaders already fetch it; they just don't pass it through today).

**Algorithm:**

1. **Group candidates** by `(normalized description, accountId, direction)`. Normalization: lowercase, strip digits/dates/reference codes, collapse whitespace — "NETFLIX.COM 4529" and "NETFLIX.COM 8817" group together. Transfers are excluded, *except* those whose `transferPairId` resolves to a liability account (debt payments recur and already count toward obligations).
2. **Classify cadence** from the median gap between consecutive occurrences, into tolerance buckets: weekly (7±2), biweekly (14±3), semimonthly (~15; 1st/15th pattern), monthly (28–33), quarterly (85–95), annual (350–380). A series requires **≥3 occurrences**, and every consecutive gap must fall within the matched bucket's tolerance band.
3. **Amount check:** typical amount = median. A series qualifies when **at least 75% of its amounts fall within ±20% of the median** (allows variable utilities); a qualifying series with any amount outside ±5% of the median is flagged `variableAmount`.
4. **Output** `RecurringSeries[]`: `seriesKey`, cadence, typical amount, last seen date, next expected date(s), occurrence count, `variableAmount`, essential flag (majority vote of the underlying transactions' `essential`), and a confidence grade derived from occurrence count + gap regularity — per the product rule, data gaps lower **confidence**, never silently the numbers. A series whose last occurrence is more than 1.5× its cadence interval before the reference date is marked `lapsed` and drops out of projections.

**`seriesKey` (the load-bearing detail):** a stable hash of `(accountId, direction, normalized description)` **only**. Cadence and amount are deliberately excluded so that when more data arrives and a series reclassifies (e.g. monthly → biweekly), the user's confirm/dismiss override still sticks to it.

## 2. Obligations integration — `snapshot-builder.ts`

Changes are confined to the snapshot builder. Historical windows keep using actual transactions; recurrence only takes over where real data runs out. Windows fully inside known history do not change at all, so score history is unaffected retroactively.

- **Window length (income side).** Today, with no known income date after `date`, the window falls back to `medianGap` (silently 15 days when income history is empty). New: if a detected recurring **income** series (non-dismissed) projects a next expected date beyond known history, use it; otherwise fall back to `medianGap` as today.
- **Window contents (outflow side).** Today a window extending past `endDate` shifts wholesale back 28 days. New: **split the window.** The in-history portion (≤ `endDate`) sums actual transactions exactly as now. The portion beyond `endDate` sums projected occurrences of each active, non-dismissed recurring outflow series expected to land in that span, at its typical amount. Debt-payment series count toward `nearTerm` (matching today's transfer-pair handling); a series contributes to `essential` per its majority-vote essential flag.
- **Overrides.** Dismissed series never project. Confirmed series always project (even at low confidence). Unreviewed detected series project by default — detection is useful before curation.
- **Fallback.** If no recurring outflow series are detected at all, the current 28-day shift remains, so sparse accounts never get a worse answer than today.
- **Determinism.** Projections derive only from `(transactions, overrides, endDate)` — same inputs, same snapshots; rebuilds stay reproducible.

## 3. Persistence & server actions

**Migration `0006_recurring_overrides.sql`:**

```sql
create table public.recurring_overrides (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  series_key text not null,
  status text not null check (status in ('confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, series_key)
);
```

RLS: per-user isolation, same policy shape as existing tables (owner-only select/insert/update/delete), covered by new `pnpm test:rls` cases.

**Also in this migration: drop the unused `transactions.recurring_status` column.** It is referenced nowhere in code; this slice supersedes its intent (series-level detection instead of per-transaction tagging). Migration 0005 set the precedent for dropping dead columns; leaving it would invite confusion about which mechanism is authoritative.

**Server actions** (existing transactions/accounts action pattern):

- `setRecurringOverride(seriesKey, status)` — upsert `confirmed` | `dismissed`
- `clearRecurringOverride(seriesKey)` — delete the row; series returns to default (detected, unreviewed)

Both revalidate affected paths so dashboard obligations refresh after a confirm/dismiss.

**Loaders.** Dashboard and `/accounts` loaders fetch the user's overrides (bounded query per the pagination-audit conventions) and pass them into the engine alongside transactions. Detection runs in the page loader / rebuild path, where snapshots are built today — no new pipeline, no background jobs.

## 4. UI — `/accounts` "Recurring" section

New section alongside Import CSV / Recent Imports:

- **List.** One row per detected series: cleaned-up name, cadence label ("Monthly"), typical amount (`~`-prefixed when `variableAmount`), next expected date, confidence indicator as text label + icon — never color alone. Sorted by next expected date. Income and outflow series visually grouped (income must not read as a bill).
- **Actions.** Confirm / Dismiss per row. Confirmed rows show a "Confirmed" badge with undo (calls `clearRecurringOverride`). Dismissed series collapse into a "Dismissed (n)" disclosure — recoverable, not gone. Two-step inline confirm (no native dialogs), per the clear-demo-data pattern.
- **States.** Loading skeleton; empty state explaining detection needs ~3 similar occurrences, linking to `/import`; error state; partial data is inherent to the list.
- **Explainability.** (a) The section gets its own "How is this calculated?" covering grouping, the ≥3-occurrence threshold, cadence buckets, and what confirm/dismiss changes. (b) The dashboard obligations explainer is updated: obligations beyond known history are projected from detected recurring items, linking to this section.
- **Viewport.** Mobile-first at 390px (rows stack metadata); desktop widens to a tabular layout.

## 5. Testing & verification

- **`recurring.test.ts`:** normalizer (reference codes stripped, groups merge); cadence classification per bucket including edge gaps; ≥3-occurrence threshold; amount tolerance + `variableAmount`; lapsed detection; `seriesKey` stability (added data → same key; cadence reclassification → same key); determinism (same input → identical output). Fixture-driven cases: biweekly paycheck, monthly rent, variable utility, annual insurance, lapsed gym membership, one-off noise that must not qualify, debt-payment transfer pair.
- **`snapshot-builder.test.ts` additions:** window split at `endDate` (actuals + projections sum correctly); dismissed excluded; confirmed low-confidence included; income-series-driven window length; fallback to 28-day proxy when nothing detected; existing proxy tests keep passing for the fallback path.
- **RLS tests:** `recurring_overrides` cross-user read/write blocked; owner CRUD allowed.
- **E2e:** one Playwright spec — Recurring section renders on `/accounts` for the seeded user; a dismiss round-trips (row moves into the Dismissed disclosure).
- **Live verification before completion claims:** `pnpm check` green; `pnpm test:rls` green; browser pass at 390px and desktop against a seeded account with known recurring patterns, confirming detected list contents and that a dismiss visibly changes the dashboard obligations figure.

## 6. Documentation

- DECISIONS.md entry: design choices, alternatives, and the `recurring_status` column drop.
- KNOWN_LIMITATIONS.md: obligations proxy narrowed to fallback-only; v1 detection limits recorded (no fuzzy merchant matching across accounts, fixed cadence buckets, no user-created manual recurring items yet).
- CURRENT_PHASE.md updated after the slice lands.

## Out of scope (v1)

- Manual recurring items (user-created series with no transaction history)
- Editing detected series (cadence/amount overrides beyond confirm/dismiss)
- Upcoming-bills calendar view
- Fuzzy merchant matching across accounts or description drift beyond the normalizer
- Notifications for upcoming/missed recurring items
