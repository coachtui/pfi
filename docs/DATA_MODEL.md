# Data Model

Status: Plaid Slice 1 tables/columns/RPCs landed in migration 0015 (see the end of Entities). Six core tables **implemented** (migration `0001_core`, integrity hardening in `0002_integrity`) — `user_profiles`, `personal_companies`, `financial_accounts`, `transactions`, `financial_events`, `daily_snapshots`. All have default-deny RLS with owner-only policies (see SECURITY_MODEL.md), verified by `pnpm test:rls`. `financial_goals`, `recommendations`, `cohorts`/`cohort_benchmarks`, and `challenges`/`achievements` remain **drafts** — no SQL yet, target shape below. Where the implemented schema differs from the original draft, the implementation wins; deviations are recorded in DECISIONS.md (#8).

## Design reasoning

- **Snapshots are first-class.** Charts read `daily_snapshots`, never recompute from raw transactions per request. Snapshots are derived data: rebuildable deterministically from transactions + balances, so they can be restated when data is corrected.
- **Sources are immutable; corrections are overlays.** `transactions` keeps imported values forever; user corrections live in override columns (or a sibling table) with an audit trail. The engine reads corrected values.
- **Public and private data never share a table.** Leaderboards read `cohort_benchmarks` and `public_profiles` only.
- **Everything derived carries provenance:** engine version, confidence, and coverage metadata.

## Entities

### user_profiles — implemented (migration 0001)
`id (= auth.users.id, FK, cascade delete)`, `username (unique)`, `age_cohort`, `income_band`, `household_type`, `col_cohort`, `objective`, `privacy_settings (jsonb, default '{}')`, `onboarding_completed_at`, `created_at`.

Cohort fields are **bands, never exact values** (privacy by construction). `display_prefs` from the original draft is not yet a column — add when a display-preference UI exists.

### personal_companies — implemented (migration 0001)
`id`, `user_id (unique FK)`, `name`, `ticker`, `logo_path`, `public_profile_enabled (default false)`, `data_coverage_state (default 'demo')`, `created_at`. Matches the original draft.

### financial_accounts — implemented (migration 0001)
`id`, `user_id (FK)`, `provider (check: 'demo' | 'manual' | 'csv')`, `institution`, `type` (check: checking, savings, money_market, credit_card, mortgage, auto_loan, student_loan, personal_loan, brokerage, retirement, property, other_asset, other_liability), `subtype`, `display_name`, `mask`, `currency (default 'USD')`, `current_balance`, `available_balance`, `credit_limit`, `interest_rate`, `include_in_calculations (default true)`, `include_in_public_score (default false)`, `connection_status (default 'ok')`, `last_synced_at`, `created_at`. `provider` allows `demo`/`manual`/`csv`/`plaid` (migration 0015). Plaid accounts also carry `plaid_item_id (FK plaid_items)`, `external_account_id` (Plaid account id; unique per Item via a partial index on `(plaid_item_id, external_account_id)`), and `roster_status` (`shared` | `unshared` | `closed`); `connection_status`/`last_synced_at` mirror the Item's state for `plaid` accounts.

### transactions — implemented (migration 0001 + 0002 integrity + 0004 CSV import)
`id`, `account_id (FK)`, `user_id (FK)`, `posted_date`, `authorized_date`, `amount (check >= 0)`, `direction (check: 'inflow' | 'outflow')`, `description`, `category`, `subcategory`, `txn_type` (renamed from the draft's `type` — reserved-adjacent name avoided), `recurring_status`, `essential (bool | null)`, `is_transfer (default false)`, `transfer_pair_id`, `confidence (check 0–1)`, `user_override (jsonb)`, `notes`, `import_batch_id (uuid, added 0004)`, `external_id` (provider transaction id, unique per account via a partial index — makes sync idempotent; added 0015), `category_confidence` (Plaid's category confidence, `very_high`…`unknown`; display-only, never PFI's `confidence`), `pfc_primary`/`pfc_detailed` (Plaid's raw taxonomy values, verbatim), `category_taxonomy_version` (`v1` | `v2`), `created_at`. Migration 0002 adds two triggers: `transactions_immutable_source` blocks updates to any source column after insert (corrections go through `user_override` only — see KNOWN_LIMITATIONS on backfills), and `transactions_account_ownership` rejects insert/update if `account_id` doesn't belong to `user_id` (relies on RLS visibility of `financial_accounts`, SECURITY INVOKER). Migration 0004 extends the immutable-source trigger to cover `import_batch_id` (set once at insert for CSV-imported rows, never updated) and adds a partial index on `(user_id, import_batch_id) where import_batch_id is not null` — batch summaries are derived by grouping on this column at read time, not stored in a separate table (DECISIONS.md #15).

### financial_events — implemented (migration 0001)
`id`, `user_id (FK)`, `date`, `type` (check: paycheck, bonus, mortgage_payment, large_purchase, insurance_payment, investment_contribution, debt_payment, debt_payoff, tax_payment, unexpected_expense), `label`, `amount (check >= 0, added in 0002)`, `direction`, `created_at`. Implemented as its own table (not derived from transactions) — resolves the "decision pending" note from the original draft.

### daily_snapshots — implemented (migration 0001), raw-components shape
`user_id`, `date` (composite PK), `liquid_assets`, `revolving_balances`, `near_term_obligations`, `essential_obligations`, `safety_buffer`, `net_worth`, `engine_version`, `data_coverage_confidence (default 'demo')`, `created_at`.

This is the raw-dollar-components shape, not the original draft's shape (which included `available_position`, `baseline`, `waterline`, `owner_created_equity`, `financial_index`, `health_score`, `score_version` as stored columns). Those derived values are computed at read time from the stored components by `src/lib/financial-engine` — see DECISIONS.md #8 and FINANCIAL_INDEX_METHODOLOGY.md's "Snapshot derivation (v1)" section. `health_score`/`score_version` remain deferred to Phase 2.

### balance_anchors (implemented)

Append-only (date, balance) truth points per account — statement ending balances entered at import (`source = 'import'`, with the server-computed reconciliation `discrepancy` recorded; `import_batch_id` ties the anchor to its batch so undo removes it) and manual balance entries (`source = 'manual'`). The engine trusts the *effective anchor*: greatest `anchor_date`, tiebreak latest `created_at`. `balance` uses the same positive-owed convention as `financial_accounts.current_balance`. Owner-only RLS. See DECISIONS #24.

### plaid_items — implemented (migration 0015)
One row per linked Plaid Item (an institution login): `id`, `user_id (FK)`, `item_id (unique, Plaid's)`, `institution_id`, `institution_name`, `status` (`initializing` → `history_loading` → `connected`; `login_required`, `error`, `disconnect_pending`, `disconnected`), `update_status` (last `transactions_update_status` verbatim), `history_complete_at` (set once when `HISTORICAL_UPDATE_COMPLETE` is first seen; null = partial history, the household is then "historical data incomplete"), `error_code`, `transactions_cursor`, `last_synced_at`, `last_sync_attempt_at`, `consent_expires_at`, `created_at`. Owner-only four-policy RLS. Non-secret only.

### plaid_item_secrets — implemented (migration 0015)
`plaid_item_id (PK, FK cascade)`, `access_token_ciphertext` (base64 iv‖ciphertext‖tag, AES-256-GCM at the application layer — `src/lib/plaid/crypto.ts`), `key_version`, `created_at`, `rotated_at`. RLS enabled with **no policies and no grants** to `authenticated`/`anon`: only the service role can read or write it, so the browser client (which runs as the owner) can never see a token even through RLS.

### balance_anchors — freshness columns (migration 0015)
`source` now also allows `sync`. New provenance: `observed_at` (when PFI received the balance), `source_updated_at` (Plaid's institution timestamp, usually null), `freshness` (`entered` for typed/statement values, `cached` for balances that arrived with `/accounts/get`, `realtime` reserved for a future Balance-product call). "Synced" never means "live."

### import_batches — sync columns (migration 0015)
`plaid_item_id`, `sync_metadata (jsonb: request_ids, update_status, cursor_before/after, counts)`, `rebuild_completed_at` (null after a sync commits until `finishWithRebuild` succeeds; dashboard load repairs it under the rebuild lease below). `reconciliation_results` carries per-sync audit: provider retractions (external id, prior amount/date/description, action, reason), roster changes, ambiguous transfers, anchor discrepancies.

### user_profiles — rebuild lease (migration 0015)
`rebuild_claimed_at`, `rebuild_claim_token`: a 2-minute lease claimed by a conditional update with a fresh UUID; release is token-scoped, so a worker that outran its lease cannot clear a newer worker's claim.

### RPCs (migration 0015)
- **`commit_connected_sync(p_batch_id uuid, p_plan jsonb)`** — the only writer of sync results. `security invoker` (RLS applies inside), granted to `authenticated`/`service_role` only. Asserts `auth.uid()` ownership of the batch (must be `connected_account`/`extracting`), the Item, and every transaction id in `updates`/`deletes`/`unpair_ids` (count-equality checks) **before** any write, then applies roster ops, deletes (unpairing survivors), explicit unpairs, in-place provider-column updates, idempotent inserts (`on conflict do nothing` on the external index), transfer pairing by `pair_key`, `sync` anchors, Item cursor/status/`history_complete_at`, account mirrors, and batch confirmation — in one transaction. Plan shape is documented in the migration header.
- **`delete_connected_item_data(p_item_id uuid)`** — "disconnect and delete": removes the Item's accounts, transactions, anchors, and batches after an ownership assertion; counterparts on other accounts are unpaired, not deleted.
- **Provider-write mode.** The immutability trigger (`transactions_prevent_source_update`, re-created in 0015) keeps `id`/`account_id`/`user_id`/`txn_type`/`essential`/`confidence`/`created_at`/`import_batch_id`/`external_id` frozen in every mode, and permits the provider-owned set (`posted_date`, `authorized_date`, `amount`, `direction`, `description`, `category`, `subcategory`, `category_confidence`, `pfc_*`, `category_taxonomy_version`, `is_transfer`, `transfer_pair_id`) to change only while the transaction-local setting `pfi.provider_write` names an in-flight `connected_account` batch or a Plaid Item owned by the row's owner. That setting is an **implementation detail, not an authorization boundary**: only the two RPCs set it, after their own ownership assertions, and `set_config` is unreachable through PostgREST.

### financial_goals
`id`, `user_id`, `type`, `name`, `target_amount`, `target_date`, `current_amount`, `monthly_target`, `priority`, `status`.

### recommendations
`id`, `user_id`, `type`, `observation`, `explanation`, `suggested_action`, `estimated_impact (calculated by code)`, `assumptions`, `confidence`, `category ('green'|'yellow')`, `status`, `dismissed_at`, `completed_at`.

### cohorts / cohort_benchmarks
`cohorts`: `id`, `age_band`, `income_band`, `household_type`, `col_category`, `region_category`, `min_size`.
`cohort_benchmarks` (aggregates only, never raw): `cohort_id`, `period`, `user_count`, `median_metrics (jsonb)`, `percentiles (jsonb)`, `trends (jsonb)`, `suppressed (bool — true when user_count < min_size)`.

### challenges / achievements
`challenge_type`, `eligibility`, `start/end`, `progress`, `completion`, `badge`, `reward_type`, `public_visibility`.

## Provider abstraction (Phase 3/7)

```ts
interface FinancialDataProvider {
  connect(): Promise<ConnectionResult>;
  syncAccounts(): Promise<Account[]>;
  syncTransactions(): Promise<Transaction[]>;
  refreshBalances(): Promise<BalanceSnapshot[]>;
}
```

Mock provider first; Plaid/MX later behind the same interface.
