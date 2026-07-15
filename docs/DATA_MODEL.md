# Data Model

Status: **drafted** (Phase 0). Only `DailySnapshot`, `FinancialEvent`, and the demo profile exist as TypeScript types today (`src/lib/financial-engine/types.ts`). The SQL schema lands with Supabase in Phase 3. This draft is the target shape; document deviations in DECISIONS.md.

## Design reasoning

- **Snapshots are first-class.** Charts read `daily_snapshots`, never recompute from raw transactions per request. Snapshots are derived data: rebuildable deterministically from transactions + balances, so they can be restated when data is corrected.
- **Sources are immutable; corrections are overlays.** `transactions` keeps imported values forever; user corrections live in override columns (or a sibling table) with an audit trail. The engine reads corrected values.
- **Public and private data never share a table.** Leaderboards read `cohort_benchmarks` and `public_profiles` only.
- **Everything derived carries provenance:** engine version, confidence, and coverage metadata.

## Entities

### user_profiles
`user_id (auth FK)`, `username`, `display_prefs`, `age_cohort`, `income_band`, `household_type`, `col_cohort`, `objective`, `privacy_settings (jsonb)`, `onboarding_completed_at`.

Cohort fields are **bands, never exact values** (privacy by construction).

### personal_companies
`id`, `user_id`, `name`, `ticker`, `logo_path`, `public_profile_enabled`, `created_at`, `data_coverage_state`.

### financial_accounts
`id`, `user_id`, `provider ('manual' | 'csv' | 'plaid' | …)`, `institution`, `type` (checking, savings, money_market, credit_card, mortgage, auto_loan, student_loan, personal_loan, brokerage, retirement, property, other_asset, other_liability), `subtype`, `display_name`, `mask`, `currency`, `current_balance`, `available_balance`, `credit_limit`, `interest_rate`, `include_in_calculations`, `include_in_public_score`, `connection_status`, `last_synced_at`.

### transactions
`id`, `account_id`, `user_id`, `posted_date`, `authorized_date`, `amount`, `direction`, `description`, `category`, `subcategory`, `type`, `recurring_status`, `essential (bool | null)`, `is_transfer`, `transfer_pair_id`, `confidence`, `user_override (jsonb)`, `notes`.

### financial_events
Typed notable events (paycheck, bonus, mortgage payment, large purchase, insurance, investment contribution, debt payoff, tax payment, unexpected expense) — chart markers and driver inputs. May be derived from transactions rather than stored, decision pending (DECISIONS.md when Phase 3 starts).

### daily_snapshots
`user_id`, `date`, `liquid_assets`, `current_liabilities`, `near_term_obligations`, `essential_obligations`, `safety_buffer`, `available_position`, `baseline`, `waterline`, `net_worth`, `owner_created_equity`, `financial_index`, `health_score`, `score_version`, `data_coverage_confidence`.

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
