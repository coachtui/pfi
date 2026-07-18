# Statement Balance Anchoring & Staleness — Design

_Date: 2026-07-18. Status: approved in brainstorming. Precedes Phase 4 (AI interpreter) deliberately: the weekly brief and recommendation cards presume reasonably fresh data, and this slice is what makes "fresh" verifiable._

## Problem

A diligent user can already keep their data current (re-run the CSV import monthly; dedupe makes overlapping exports safe), but the path has three gaps:

1. **The hidden second step.** Importing transactions never moves an account's balance. The snapshot builder anchors on `financial_accounts.current_balance` and replays history backward from it, so a monthly import *reshapes the past under a stale balance* instead of advancing today's position. The correct ritual — import, then manually edit each account's balance to the statement's ending balance — is documented nowhere in the product.
2. **Manually typed balances are fuzzy.** The number on a banking app's home screen may be current balance or available balance, with or without pending transactions, at an unknown moment. A statement's ending balance has none of that ambiguity: posted-only, bank-reconciled, as of an exact close date.
3. **No staleness awareness.** Nothing tells the user their data is 45 days old, warns about coverage gaps between imports, or prompts the monthly ritual.

## Core insight

Transactions alone determine *changes*, never *levels*. The engine needs at least one trusted (date, balance) anchor per account; today that anchor is a hand-typed balance with no date. Statements hand us a fresh, unambiguous anchor every month — and a free integrity check: if a new statement's figures don't reconcile against the prior anchor rolled forward, that's mathematical proof of missing transactions, quantifiable to the dollar.

Forward-looking: ROADMAP Phase 7 (Plaid/MX) makes this a *living* day-to-day score by supplying live balances daily. Those are just anchor rows from a new source feeding the same machinery — nothing in this slice is throwaway.

## Decisions taken in brainstorming

- **Anchor source:** statement ending balances, entered (v1) in the CSV import wizard. PDF statement ingestion is a separate future slice (extraction is the hard, risky part — likely AI-assisted, needing its own verification design under the "deterministic code calculates" rule); everything built here is the substrate it will reuse.
- **Anchor entry is encouraged, skippable.** An import without a balance commits exactly as today; the preview notes the balance stays "as of" the older anchor. No blocking.
- **Score honesty over liveness (v1):** displayed balances/score are "as of" the newest anchor — deliberately slightly behind reality but provably correct, labeled honestly in the UI.
- **Scope:** anchoring + reconciliation + "as of" labels + staleness nudge. Saved per-account column mappings and PDF ingestion are out.

## Architecture (Approach A — anchor history table + roll-forward at import)

Alternatives rejected: **(B)** two columns on `financial_accounts` (single anchor, no history — loses the audit trail and per-import discrepancy record; Plaid would force the table into existence later anyway; this codebase consistently keeps provenance — import batches, `user_override`); **(C)** a multi-anchor engine pinning history piecewise between anchors (most historically correct, but a genuine snapshot-builder rewrite; overkill while anchors are monthly and sparse).

### 1. Data model — migration `0007_balance_anchors`

```sql
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
```

- Owner-only RLS, same four-policy shape as `recurring_overrides` (`own_select`/`own_insert`/`own_update`/`own_delete` on `auth.uid() = user_id`).
- Append-only from app code (provenance data): no updates or deletes except batch undo removing its own anchor row.
- `discrepancy` = entered ending balance − derived balance at that date, recorded at anchor creation. `null` when no prior anchor existed to reconcile against; `0` when clean.
- `balance` uses the same sign convention as `financial_accounts.current_balance`: positive-owed for liability accounts (a credit-card statement's "new balance" of $1,402 stores as `1402`). No new convention.
- Multiple anchors on one date are allowed; effective-anchor selection disambiguates.
- Also in this migration: `user_profiles.stale_nudge_dismissed_at timestamptz` (nullable) for nudge dismissal.

`financial_accounts.current_balance` keeps its role as the engine's anchor input, now maintained by math for anchored accounts: an anchored import (and every later transaction mutation) sets it to the effective anchor's balance rolled forward through transactions dated after the anchor.

### 2. Import wizard changes

The wizard keeps its four steps (upload → map columns → preview → summary).

- **Preview step gains a "Statement ending balance" card** after the dedupe summary. Two fields: ending balance (copy: "printed on your statement — 'new balance' on credit cards") and its "as of" date, defaulting to the latest transaction date in the file but editable (statements often close a few quiet days after the last transaction). Both optional; skipping leaves behavior identical to today, with a note that the balance stays "as of" the older anchor.
- **Live reconciliation** once a balance is entered: import context (extended with the existing effective anchor) computes the *derived balance at the entered date* and compares. Derived balance at date D is defined once, direction-agnostic: the effective anchor's balance adjusted by the net effect of transactions (existing + about-to-import) dated between D and the anchor date — added when D is after the anchor, backed out when D is before it (the back-filled-statement case). Two outcomes, text + icon, never color alone: "Reconciles cleanly" or "$X unaccounted for between {anchor date} and {entered date} — some transactions may be missing from this period." Never blocks commit.
- **Commit** (`importTransactions`) gains optional `endingBalance`/`anchorDate`. Per the established trust boundary, the server ignores client math and re-derives: insert transactions → compute discrepancy server-side → insert anchor row (source `import`, linked `import_batch_id`, discrepancy recorded) → recompute `current_balance` from the effective anchor → `finishWithRebuild`.
- **Summary step** reports "Balance anchored: $X as of {date}" with the reconciliation result restated.
- **Batch undo also undoes the anchor**: deletes the anchor row carrying that `import_batch_id` and recomputes `current_balance` from the remaining effective anchor rolled forward — otherwise undo leaves the balance claiming a statement that no longer exists in the data.
- **Manual balance edits** (existing account-edit sheet) now also insert an anchor row — source `manual`, dated today — completing the audit trail and giving staleness one uniform question: "when was this account last anchored?"

### 3. Balance math & engine surface

- **Effective anchor** = the account's anchor row with the greatest `anchor_date` (tiebreak: latest `created_at`). Back-filling an older statement stores its anchor (and still reconciles it — validating history) without moving today's balance. Out-of-order imports just work.
- **`rollForwardBalance(accountType, anchorBalance, anchorDate, transactions)`** lives in `src/lib/financial-engine` (framework-free, tested): anchor balance plus the net effect of that account's transactions dated strictly after the anchor, reusing the engine's existing liability sign logic (defined once, never duplicated).
- **Recompute triggers:** every transaction mutation for anchored accounts — import commit, batch undo, manual transaction add/delete — via one shared server helper in the `finishWithRebuild` path. This upgrades a documented quirk into correct behavior: a transaction dated after the anchor now properly moves today's balance forward; a transaction dated before the anchor is absorbed into backward-replayed history exactly as before.
- **Anchorless accounts keep legacy behavior untouched.** No backfill migration — we can't invent a date for an existing hand-typed balance. Accounts acquire their first anchor naturally (next balance edit or next anchored import).
- **Snapshot builder: zero changes.** `current_balance` is kept mathematically consistent with the effective anchor over the same transaction set the builder sees, so backward replay from `endDate` reproduces the correct balance at every date including the anchor date. The anchor date may sit a few quiet days past the last transaction; snapshots still end at the last transaction date (no transactions ⇒ no balance change between the two); the "as of" label uses the anchor date.
- Reconciliation math and effective-anchor selection are pure engine functions (unit-testable), invoked from server code.

### 4. Staleness surfaces

- **Freshness dates.** Per-account = effective anchor date (fallback: newest transaction date). Household = the *oldest* per-account freshness across included, non-archived accounts — the weakest link, since the score is only as current as its least-fresh input.
- **Demo exclusion (critical).** Demo datasets have fixed end dates; wall-clock staleness would permanently nag every demo profile. Staleness and "as of" compute over non-demo accounts only; a user with only demo data sees no banner and no stale labeling.
- **"As of" labels:** one quiet household-level line near the dashboard chart header ("Data current through Jul 31", linking to `/accounts`) — not per-metric-card; and a per-account "as of {date}" on each `/accounts` row so the user can see which account drags freshness down.
- **Nudge banner:** dashboard-only, styled like the existing stale-index notice (`role="status"`, icon + text, never color alone). Appears when household freshness exceeds **35 days** (one statement cycle plus slack). No-shame copy — fact plus action, no guilt: "Your data is current through Jul 31. Import your latest statements to keep your score accurate." Links to `/import`. Dismissible; dismissal stored in `user_profiles.stale_nudge_dismissed_at` (DB, not localStorage — survives devices; this is a PWA). Reappears if still stale 35 days after dismissal; clears automatically when an anchored import lands.
- Staleness derivation is a pure function (per-account and household-min, demo exclusion) with unit tests. Wall-clock "today" is supplied by the caller (loaders may use real time; the engine stays deterministic).

### 5. Testing & verification

- **Engine unit tests:** `rollForwardBalance` (asset vs. liability signs; transactions before/on/after the anchor date — only strictly-after counts; transfers; empty history; exact-cents arithmetic); reconciliation/discrepancy computation (including `null` prior-anchor case); effective-anchor selection (date ordering, `created_at` tiebreak, out-of-order back-fill); staleness derivation (per-account, household min, demo exclusion).
- **RLS tests:** `balance_anchors` owner-only cases, same five-check shape as last slice's `recurring_overrides` additions — owner insert, cross-user read empty, cross-user insert rejected, cross-user update no-op, owner delete (suite 24 → 29).
- **E2e (first coverage of the import flow at all):** one journey in `smoke.spec.ts` — upload a small fixture CSV for a manual account, map columns, enter an ending balance, see it reconcile, commit, verify the balance and "as of" date on `/accounts`; a second spec: batch undo restores the prior balance. The nudge banner is not e2e-testable with a fresh user (its data is never 35 days old) — banner logic relies on unit tests; the "Data current through" label is asserted.
- **Live browser QA** at 390×844 first, then 1280×900, against real Supabase, before completion claims. `pnpm check` green throughout.

### 6. Documentation

- DECISIONS #24: anchor model, effective-anchor rule, alternatives B/C rejected, the "import now moves balances for anchored accounts" behavior change.
- KNOWN_LIMITATIONS: rewrite the "Manual `current_balance` is authoritative" bullet (anchored accounts roll forward; anchorless accounts keep legacy behavior); add the "balance is as-of statement close, not live" semantics; add the deferral below.
- DATA_MODEL.md: `balance_anchors` table.
- CURRENT_PHASE.md updated after landing.

## Explicitly deferred

- **Confidence wiring.** The binding rule says material data gaps lower displayed confidence. `discrepancy` values and freshness dates are exactly the inputs the confidence engine needs, but wiring them in touches versioned score methodology — its own future slice.
- PDF statement ingestion (extraction + verification design; reuses the anchor substrate).
- Saved per-account column mappings.
- Plaid/MX live anchors (ROADMAP Phase 7; anchor rows from a new `source`).
- Coverage-gap *repair* tooling (this slice detects and quantifies gaps; filling them stays manual — import the missing statement).
