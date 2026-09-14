# Plaid Link & Sync — Slice 1 (link + user-driven sync, sandbox-first) — Design

_Date: 2026-09-14. Status: **frozen** — approved in brainstorming, revised after owner review, then four final acceptance criteria added (§13) and go-ahead given for the implementation plan (DECISIONS #43). Opens ROADMAP Phase 7 (account aggregation) early, for a single real user; friends-and-family scale and webhooks/cron are later slices._

## Problem

The only real-data paths today are manual entry, CSV import, and PDF statement import. All three work, but each is a monthly ritual and each leaves balances "as of" the last statement (DECISIONS #24). The owner wants to run the product against their own live accounts, end to end, while keeping manual accounts for holdings that no aggregator sees (cash on hand, a property, an informal loan).

Aggregation was always the plan: `financial_accounts.provider`, `balance_anchors`, `import_batches.source_type = 'connected_account'`, `connection_status`/`last_synced_at`, and the single `rebuildSnapshots` choke point were all designed for it. This slice lands the first provider (Plaid) through those existing pipes and changes as little of the engine as possible.

## Core insight

A Plaid sync is an import batch with a cursor. Everything below the ingestion boundary — anchors, roll-forward, snapshots, score, confidence, imports list — already exists. Slice 1 is: a new `provider` value, a token vault, deterministic Plaid→PFI mappers, one pure sync-plan reducer, and one transactional commit function.

Running sync only from a signed-in server action (button or dashboard load) keeps RLS scoping and `rebuildSnapshots` unchanged. Background execution (webhooks, cron) needs a user-scoped rebuild refactor and is deliberately Slice 3.

## Four principles (from the owner's review)

1. **A connection can exist before its data is ready.** Plaid fills history asynchronously; the first sync may return nothing.
2. **A sync commits atomically.** Cursor, inserts, deletes, modifications, anchors, roster changes, and batch status advance together or not at all.
3. **Plaid's category confidence is not PFI's financial confidence.** Stored separately, never blended.
4. **"Synced" does not mean "live".** Balances from `/transactions/sync` are cached; the product says "last synced with Plaid."

## Decisions taken in brainstorming

- **Plaid, not MX/Teller/SimpleFIN.** Chosen by the owner. Sandbox is free; Production is pay-as-you-go with a card on file. Transactions is billed per active Item, and the subscription continues while an Item sits in an error state, so unit economics are computed per connected Item, not per user, from the dashboard's actual pricing before Slice 2.
- **Manual accounts stay first-class.** A "Cash" line item is a `provider='manual'` account with a manual balance anchor, exactly as today. No new manual mechanism; the `/accounts` add/edit flow is untouched.
- **User-driven sync only in Slice 1.** "Sync now" per institution plus an auto-sync on dashboard load. No `src/app/api` route handlers, no webhooks, no cron.
- **Posted transactions only.** Pending transactions are never ingested.
- **Provider-owned vs user-owned fields are explicit** (§6). Plaid modifications update provider-owned columns in place inside the commit function; user-owned columns survive. Provider removals are hard deletes of the canonical row with a full audit record. User deletion of imported rows stays forbidden (DECISIONS #13 unchanged).
- **One Postgres function commits a sync.** This is the first PostgREST-callable RPC in the schema. It runs `security invoker` under the caller's session, so RLS still governs every statement; it is the only code path allowed to rewrite provider-owned source columns, via a transaction-local flag the immutability trigger honors.
- **Balances arrive as `sync` anchors** flagged `cached`, reconciled with the existing `computeDiscrepancy`. The daily-anchor history-restatement concern for brokerage/retirement accounts (DECISIONS #24's rejected "piecewise anchors") is out of scope here and tracked in KNOWN_LIMITATIONS.
- **Access tokens are encrypted at the application layer** (AES-256-GCM, key in a server-only env var, versioned for rotation) in a table with **no grants to `authenticated`**. Supabase Vault was the alternative; app-level encryption is unit-testable, adds no PostgREST-exposed functions, and has one rotation path.
- **Deterministic categorization from Plaid's `personal_finance_category`.** A pure map from PFC primary/detailed to PFI's 13 categories. AI never touches it.
- **Transfer pairing is conservative.** Only unique, unambiguous matches pair automatically; anything else stays unpaired for the user.
- **Investments are balance-only in Slice 1.** Holdings, securities, and market appreciation get their own spec.
- **Demo data is not blocked, only warned.** Connecting while demo accounts exist shows a notice pointing to the existing "Clear demo data" action, which already preserves manual accounts.

## Architecture

### 1. Data model — migration `0015_plaid_link_sync`

```sql
-- Provider and anchor-source enums widen.
alter table public.financial_accounts
  drop constraint financial_accounts_provider_check,
  add constraint financial_accounts_provider_check
    check (provider in ('demo','manual','csv','plaid'));
alter table public.balance_anchors
  drop constraint balance_anchors_source_check,
  add constraint balance_anchors_source_check
    check (source in ('manual','import','sync'));

-- Balance freshness provenance (principle 4). Existing rows: observed_at = created_at,
-- source_updated_at null, freshness 'entered' (typed/statement values are neither).
alter table public.balance_anchors
  add column observed_at timestamptz not null default now(),
  add column source_updated_at timestamptz,
  add column freshness text not null default 'entered'
    check (freshness in ('entered','cached','realtime'));

-- One row per linked Plaid Item (an institution login). Non-secret metadata only.
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'initializing' check (status in (
    'initializing',       -- exchanged, no sync attempted yet
    'history_loading',    -- Plaid reports NOT_READY or INITIAL_UPDATE_COMPLETE
    'connected',          -- HISTORICAL_UPDATE_COMPLETE seen at least once
    'login_required',     -- ITEM_LOGIN_REQUIRED / consent expiring: Link update mode
    'error',              -- other ITEM_/INSTITUTION_ errors; error_code set
    'disconnect_pending', -- /item/remove failed; retryable, still billable
    'disconnected'        -- /item/remove succeeded
  )),
  update_status text,                           -- last transactions_update_status verbatim
  history_complete_at timestamptz,              -- first time HISTORICAL_UPDATE_COMPLETE was seen; null = partial history
  error_code text,
  transactions_cursor text,
  last_synced_at timestamptz,                   -- last successful commit
  last_sync_attempt_at timestamptz,
  consent_expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- Owner-only RLS, four-policy shape as balance_anchors.

-- Secrets: service-role only. RLS enabled with NO policies and NO grants, so the
-- browser client (which runs as the owner) can never read a token even through RLS.
create table public.plaid_item_secrets (
  plaid_item_id uuid primary key references public.plaid_items (id) on delete cascade,
  access_token_ciphertext text not null,        -- base64: iv || ciphertext || tag
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
alter table public.plaid_item_secrets enable row level security;
revoke all on public.plaid_item_secrets from authenticated, anon;

-- Accounts remember their Item and Plaid account id; uniqueness is per Item so a
-- fresh Item at the same institution never collides, and update mode (same Item)
-- never duplicates.
alter table public.financial_accounts
  add column plaid_item_id uuid references public.plaid_items (id) on delete set null,
  add column external_account_id text,
  add column roster_status text check (roster_status is null or roster_status in ('shared','unshared','closed'));
create unique index financial_accounts_item_external_idx
  on public.financial_accounts (plaid_item_id, external_account_id)
  where plaid_item_id is not null and external_account_id is not null;

-- Transactions: provider id (idempotent sync) and Plaid's *category* confidence,
-- kept apart from transactions.confidence, which stays PFI-owned (principle 3).
alter table public.transactions
  add column external_id text,
  add column category_confidence text
    check (category_confidence is null or category_confidence in ('very_high','high','medium','low','unknown')),
  add column pfc_primary text,                  -- Plaid's raw primary category, preserved verbatim
  add column pfc_detailed text,                 -- Plaid's raw detailed category, preserved verbatim
  add column category_taxonomy_version text
    check (category_taxonomy_version is null or category_taxonomy_version in ('v1','v2'));
create unique index transactions_external_idx
  on public.transactions (account_id, external_id)
  where external_id is not null;

-- Import batches: sync bookkeeping and the post-commit rebuild flag.
alter table public.import_batches
  add column plaid_item_id uuid references public.plaid_items (id) on delete set null,
  add column sync_metadata jsonb not null default '{}',   -- request_ids, update_status, cursor_before/after, counts
  add column rebuild_completed_at timestamptz;            -- null after commit until finishWithRebuild succeeds

-- Per-user rebuild claim for the dashboard-load repair path (§5 step 7).
alter table public.user_profiles
  add column rebuild_claimed_at timestamptz,
  add column rebuild_claim_token uuid;
```

- `external_id`, `category_confidence`, `pfc_primary`, `pfc_detailed`, and `category_taxonomy_version` join the frozen-column list in the 0002/0004 immutability trigger.
- `commit_connected_sync(p_batch_id uuid, p_plan jsonb) returns jsonb` — plpgsql, `security invoker`, granted to `authenticated`. Every statement inside runs under RLS as the calling user. **Authorization is explicit ownership proof, not RLS side effects and not the trigger flag:** before any write, the function asserts `auth.uid()` equals `user_id` on the batch, the Item, every account named in the plan, and every existing transaction the plan updates or deletes (a `select count(*)` over the plan's ids must equal the plan's count), and raises otherwise. Only after those assertions does it `set_config('pfi.provider_write', p_batch_id::text, true)` — transaction-local, scoped to this batch id — and the immutability trigger permits provider-owned column changes (§6) only while that setting equals the row's `import_batch_id`-bearing batch. The flag is an internal implementation detail that lets one audited code path rewrite provider columns; it never authorizes anything by itself. No other function reads it, `set_config` is not reachable through PostgREST (only `public` is exposed), and the function is the only member of `public` that sets it. It then performs, in one transaction: roster upserts/archives, transaction deletes, in-place provider updates, inserts (`on conflict do nothing` on the external index), anchor inserts, `plaid_items` cursor/status/`history_complete_at`/`last_synced_at` update, account `connection_status`/`last_synced_at` mirror, batch `status='confirmed'` with `reconciliation_results` and `sync_metadata`. Any `raise` rolls everything back and the batch is marked `failed` by the action afterward. The cursor never advances outside this function.
- `pnpm test:rls` gains (acceptance criteria, all must pass live): cross-user cannot read `plaid_items`; an authenticated owner session gets a permission error (not an empty set) on `plaid_item_secrets`; the service role can read it; `commit_connected_sync` called by user B with user A's batch id raises; a plan that names an account or transaction id owned by another user raises even when the batch is the caller's; `supabase.rpc('set_config', …)` from an authenticated session is rejected by PostgREST; a direct `update transactions set amount` outside the function still raises the immutability error, before and after any RPC call in the same session; no function other than `commit_connected_sync` in `public` references `pfi.provider_write` (a migration-text assertion in the test).

### 2. Env & config

`src/lib/config/env.server.ts` gains a lazy `plaidConfig()` returning `null` when unset and throwing on a partial set:

| Var | Purpose |
|---|---|
| `PLAID_CLIENT_ID` | dashboard credential |
| `PLAID_SECRET` | per-environment secret |
| `PLAID_ENV` | `sandbox` \| `production` (default `sandbox`) |
| `PLAID_TOKEN_ENCRYPTION_KEY` | 32 bytes, base64; AES-256-GCM key, version 1 |
| `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` | optional; the prior key during rotation |

Absent config disables the feature the way a missing `AI_GATEWAY_API_KEY` disables narration: the Connected-institutions card renders a "not configured" state. `.env.example` documents all five. Playwright's `webServer` leaves them unset so e2e never touches Plaid.

**Key rotation procedure:** set the new key as `PLAID_TOKEN_ENCRYPTION_KEY` and the old as `_PREVIOUS`; `decryptToken` tries the version recorded on the row; `scripts/rotate-plaid-key.mts` (service role) re-encrypts every secret row under the current key, bumps `key_version`, sets `rotated_at`; then unset `_PREVIOUS`. Documented in SECURITY_MODEL.md.

Dependencies: `plaid` (official Node SDK, MIT, v47 at time of writing) server-side only, and `react-plaid-link` (MIT) for the Link hook. Both go through the dependency-audit skill before install.

### 3. Module layout

```
src/lib/plaid/                 server-only orchestration + pure mappers
  types.ts                     plain typed shapes (no SDK types leak past client.ts)
  client.ts                    PlaidApi factory from plaidConfig(); wraps calls to capture request_id  [server-only]
  crypto.ts                    encryptToken/decryptToken with key versions (webcrypto AES-GCM)   pure, tested
  map-account.ts               Plaid type/subtype → AccountType + display fields  pure, tested
  map-category.ts              PFC primary/detailed → Category            pure, tested
  map-transaction.ts           Plaid txn → provider-owned column set       pure, tested
  pair-transfers.ts            conservative cross-account pairing         pure, tested
  roster.ts                    Plaid account list vs PFI accounts → create/archive/flag  pure, tested
  sync-plan.ts                 pages + existing rows → SyncPlan (jsonb payload for the RPC)  pure, tested
  sync.ts                      run the loop, call the RPC, finish          [server-only]
src/app/actions/plaid.ts       createLinkToken, exchangePublicToken, syncItem, syncAll,
                               disconnectItem, deleteItemData
src/app/accounts/ConnectedInstitutionsCard.tsx   card + Link button + per-item rows
```

Pure modules take plain shapes from `types.ts`, never SDK classes. `sync.ts` is the only module that touches the SDK and the admin client. `client.ts` logs, on error, only `error_type`, `error_code`, and `request_id`; never tokens, public tokens, account ids, or amounts. `request_id`s are appended to `sync_metadata.request_ids` for support.

### 4. Link flow

1. `createLinkToken()` server action: auth check → `plaidConfig()` → `/link/token/create` with `client_user_id = user.id`, `products: ['transactions']`, `transactions.days_requested: 730`, `country_codes: ['US']`. Returns the token only.
2. Client: `usePlaidLink({ token, onSuccess })` in `ConnectedInstitutionsCard`. Nothing financial passes through the browser except the short-lived `public_token`.
3. `exchangePublicToken({ publicToken, institution })` server action: auth check → `/item/public_token/exchange` → **duplicate-institution guard**: if an existing non-disconnected Item has the same `institution_id`, and `/accounts/get` on the new Item returns an account whose `(type, mask)` matches one of that Item's accounts, call `/item/remove` on the new Item immediately (no billable Item lingers) and return "This institution is already connected. Use Reconnect on the existing connection." → otherwise insert `plaid_items` (`status='initializing'`) → encrypt and insert `plaid_item_secrets` (admin client) → roster create for every shared account (`provider='plaid'`, mapped type, `display_name = official_name ?? name`, `mask`, `institution`, `external_account_id`, `roster_status='shared'`, `credit_limit` from `balances.limit`) → run the first sync (§5) → `finishWithRebuild`.
4. Errors surface as `MutationResult.error` on the card. A failure after the Item exists marks it `error` with the code; it is retryable or disconnectable, never silently orphaned.

OAuth institutions in Production need a registered redirect URI; sandbox does not. That is a Slice 2 item, together with privacy-policy and financial-data consent language on `/privacy` and `/consent` before any real account is linked.

### 5. Sync algorithm (`sync.ts`)

Per Item, inside a signed-in server action after an RLS-scoped read proves ownership:

1. Decrypt the access token via the admin client. Throttle: refuse if `last_sync_attempt_at` is under 10 minutes old unless `force`; under 1 minute while `initializing`/`history_loading` (the card polls these states).
2. Insert `import_batches`: `source_type='connected_account'`, `status='extracting'`, `plaid_item_id`, `detected_institution`.
3. Call `/accounts/get` once (not the billable Balance endpoint) for the **complete roster and cached balances**. The `accounts` array on `/transactions/sync` lists only accounts that had transactions and may omit investment accounts entirely, so it is never used for roster or anchors. Then page `/transactions/sync` from the saved cursor with `options.personal_finance_category_version = 'v2'` until `has_more` is false, accumulating `added`/`modified`/`removed` and the final `transactions_update_status`. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, restart from the saved cursor once. Nothing is written during paging.
4. **Readiness (principle 1).** Map `transactions_update_status`: `NOT_READY` or `INITIAL_UPDATE_COMPLETE` → Item `history_loading`; `HISTORICAL_UPDATE_COMPLETE` → `connected` and, if null, `history_complete_at = now()`; `UNKNOWN` → keep the prior status. Whatever the status, the pages received are committed (partial history is real data) and the cursor advances. **Partial-history product state:** while any non-disconnected Item has `history_complete_at` null, the household is `historical_data_complete = false`. Slice 1 chooses **available but marked incomplete** over withholding: the dashboard, `/score`, and `/report` render, with a persistent notice "Transaction history is still loading from Plaid. Index and score are provisional until it completes," and `confidence.ts` adds a strong "history incomplete" reason (§10). Withholding was rejected because the user just connected and should see something, and the existing confidence machinery is the honest channel; charts are not re-anchored while incomplete (the index anchor recomputes on each rebuild anyway).
5. `buildSyncPlan(pages, existingRows, pfiAccounts, today)` (pure) returns a `SyncPlan`:
   - **roster** (`roster.ts`, fed by `/accounts/get`): Plaid accounts not in PFI → create; PFI `plaid` accounts of this Item absent from Plaid's list → `roster_status='unshared'`, `archived_at=now` (history preserved, excluded from calculations per existing archive semantics); accounts Plaid reports closed → `roster_status='closed'` + archive; a previously unshared account that reappears → un-archive, `roster_status='shared'`. Any roster change is recorded in `reconciliation_results` and surfaced on the card as "Account selection changed."
   - **inserts**: `added` with `pending === false`, mapped via `map-transaction` (Plaid positive amount → `outflow`, negative → `inflow`, for every account type; this matches `signedNet`'s liability convention). `category` via `map-category(version, primary, detailed)`; `pfc_primary`/`pfc_detailed` stored verbatim and `category_taxonomy_version` from the response (`v2` requested; `v1` handled if Plaid returns it for an older Item); `category_confidence` from Plaid's `confidence_level` lower-cased; `transactions.confidence` left null. Rows whose `(account_id, external_id)` already exist are dropped.
   - **updates**: `modified` rows that exist in PFI → the provider-owned column set only (§6). Name/category-only changes update `description`/`category`/`category_confidence` but never touch `user_override`, so a user recategorization still wins at read time. If `amount`, `posted_date`, or `direction` changed and the row is part of a transfer pair, both rows are unpaired (`is_transfer=false`, `transfer_pair_id=null`) and re-enter pairing.
   - **deletes**: `removed` rows that exist in PFI. Each carries an audit record: `external_id`, prior `posted_date`/`amount`/`direction`/`description`, `action='removed'`, `reason` (Plaid removed), batch id, timestamp. Deleting a row that was a transfer counterpart unpairs the survivor.
   - **anchors**: one per shared account from `/accounts/get` with `balances.current` (investment accounts included, which sync's own `accounts` array would miss): `balance = current` (Plaid reports liabilities as positive owed, matching `financial_accounts.current_balance`), `freshness='cached'`, `observed_at=now`, `source_updated_at = balances.last_updated_datetime` (institution-dependent, often null), `anchor_date` = the date of `source_updated_at` if present else today, `discrepancy` via the existing `computeDiscrepancy` against the effective prior anchor. Skipped when an identical `(account, anchor_date, balance)` sync anchor already exists.
   - **pairing** (§7) over inserts plus the user's existing transactions in the window.
   - **item**: `transactions_cursor` (next), `update_status`, derived `status`.
6. **Commit (principle 2):** `supabase.rpc('commit_connected_sync', { p_batch_id, p_plan })`. One transaction. On error the action marks the batch `failed` with `failure_reason` and the Item's `last_sync_attempt_at`; the cursor, rows, anchors, and roster are untouched, so the next attempt repeats the same pages.
7. `finishWithRebuild(supabase)`. On success set `import_batches.rebuild_completed_at`. On failure the batch stays `confirmed` with `rebuild_completed_at` null and the action returns the existing "saved, recalculation pending" warning. `getDashboardData`'s stale-index check gains a second trigger: any confirmed `connected_account` batch with `rebuild_completed_at` null forces a rebuild on load (the existing newest-transaction proxy misses removal-only syncs). **Dedup guard (lease with a unique token):** the dashboard-load repair generates a `claimToken = randomUUID()` and claims with a single conditional update (`set rebuild_claim_token = $token, rebuild_claimed_at = now() where id = auth.uid() and (rebuild_claimed_at is null or rebuild_claimed_at < now() - interval '2 minutes')`); zero rows updated means another tab or refresh holds a live lease and this load renders the stale-index notice instead of starting a second rebuild. Release is token-scoped: `set rebuild_claim_token = null, rebuild_claimed_at = null where id = auth.uid() and rebuild_claim_token = $token`, in a `finally`. A worker whose rebuild outran the 2-minute lease therefore cannot clear or overwrite a newer worker's claim — its release matches zero rows and is a no-op. The expiry covers a crashed holder. The card shows "Synced, recalculating…" until `rebuild_completed_at` is set.

Plaid error handling: `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT` → Item `login_required`, accounts `connection_status='login_required'`, card offers Reconnect (link token with `access_token`, update mode; same Item, so no duplicates). Other `ITEM_ERROR`/`INSTITUTION_ERROR` → `error` with `error_code`, batch `failed`. `RATE_LIMIT_EXCEEDED` → "try again in a few minutes." Every error path records `request_id`.

### 6. Provider-owned vs user-owned transaction fields

| Provider-owned (Plaid may rewrite inside the RPC) | PFI/user-owned (never touched by sync) |
|---|---|
| `posted_date`, `authorized_date`, `amount`, `direction`, `description`, `category`, `subcategory`, `category_confidence`, `external_id`, `import_batch_id` (set at insert only) | `user_override` (category/description), `notes`, `essential` (user flag), `recurring_status`, `confidence` (PFI), `is_transfer`/`transfer_pair_id` (PFI pairing; only unpaired by sync when the provider amount/date changes, never re-paired without the rules in §7), `created_at`, `id` |

The immutability trigger enforces this table: with the flag on, only the left column may change; without it, nothing in either column may change. Provider rewrites of `category` are the *source* category; a `user_override.category` continues to win at read time via the existing override application.

### 7. Transfer pairing (conservative)

`pairTransfers(candidates, existing, windowDays = 3)` pairs two rows automatically only when **all** hold:

- opposite directions, equal amounts to the cent;
- distinct accounts, both owned by the user and not archived;
- compatible kinds: `TRANSFER_OUT`↔`TRANSFER_IN`, or `LOAN_PAYMENTS_*` outflow ↔ inflow on an account whose type is in `LIABILITY_TYPES`;
- posted dates within the window;
- **exactly one candidate on each side** in that window. Two equal-amount transfers, a recurring identical payment, or an already-paired counterpart makes the match ambiguous and nothing pairs.

Unpaired `LOAN_PAYMENTS_*` rows stay `debt_payment` (money left the tracked household); unpaired `TRANSFER_*` rows become `other` and are listed under "Possible transfers to review" on `/transactions` (existing recategorize UI; a manual "mark as transfer" action is deferred, KNOWN_LIMITATIONS). The CSV-era one-sidedness (existing counterpart row cannot be updated) is lifted for `plaid` rows because pairing updates run inside the RPC with the provider flag; `csv`/`demo` counterparts still cannot be touched and remain one-sided.

### 8. Mapping tables (normative; unit-tested)

**Account type** (Plaid `type`/`subtype` → `AccountType`): depository/checking, cash management, paypal → `checking`; savings, cd, hsa → `savings`; money market → `money_market`; credit/* → `credit_card`; loan/mortgage, home equity → `mortgage`; loan/auto → `auto_loan`; loan/student → `student_loan`; other loan subtypes → `personal_loan`; investment/401k, 403b, 457b, ira, roth, roth 401k, sep ira, simple ira, pension, tsp, hsa-investment → `retirement`; every other investment subtype → `brokerage`; other/* → `other_asset`.

**Category** (PFC → `Category`, **taxonomy-version-aware**): `mapCategory(version: 'v1' | 'v2', primary, detailed)` keys on the detailed value first, then the primary. The sync request asks for `v2`; Items that still return `v1` are mapped by the v1 table. Both tables are generated from Plaid's published taxonomy CSVs checked into `src/lib/plaid/fixtures/` and are tested against every row of each CSV (every detailed value maps; no `Category` is unreachable; the v2 detailed values that do not exist in v1 are covered explicitly). Primary-level rules, shared by both versions: `INCOME_*` → `income`; `LOAN_PAYMENTS_MORTGAGE_PAYMENT` → `housing`; other `LOAN_PAYMENTS_*` → `debt_payment`; `RENT_AND_UTILITIES_RENT` → `housing`; other `RENT_AND_UTILITIES_*` → `utilities`; `FOOD_AND_DRINK_GROCERIES` → `groceries`; other `FOOD_AND_DRINK_*` → `dining`; `TRANSPORTATION_*` → `transport`; `MEDICAL_*` → `health`; `GENERAL_SERVICES_INSURANCE` → `insurance`; `GENERAL_MERCHANDISE_*` → `shopping`; `HOME_IMPROVEMENT_*` → `housing`; `ENTERTAINMENT_*`, `TRAVEL_*`, `PERSONAL_CARE_*` → `discretionary`; `TRANSFER_IN/OUT_*` → pairing, else `other`; `BANK_FEES_*`, `GOVERNMENT_AND_NON_PROFIT_*`, non-insurance `GENERAL_SERVICES_*`, unknown → `other`. Tests assert every PFC primary maps and every PFI category is reachable.

### 9. UI (mobile-first, `/accounts`)

A new **Connected institutions** card above the accounts list:

- Not configured: explanatory copy, no button.
- Empty: "Connect a bank" (opens Link). If demo accounts exist, an inline notice linking to the demo card's clear action.
- Rows per Item: institution name; status glyph + text, never color alone — hourglass "Preparing history" (`initializing`/`history_loading`, with copy "Connected. Plaid is preparing your transaction history. Check again shortly." and an automatic re-sync when the card is viewed), check "Connected", warning-triangle "Needs reconnect", x-circle "Error", clock "Disconnect pending"; "Last synced with Plaid 2h ago" from `last_synced_at` (never the word "live"); actions: Sync now, Reconnect, Disconnect. Sync shows pending state and then the batch summary (added, updated, removed, account-selection changes, anchor as-of date).
- Accounts list: `plaid` accounts show a "Synced" chip and mask; edit stays disabled for non-manual providers (existing guard); include/exclude and archive keep working; `roster_status` unshared/closed accounts show that reason in the archived group.
- Recent imports: synced batches appear automatically (grouped by `import_batch_id`), labeled "Synced."
- Dashboard: `getDashboardData` triggers `syncAll` when the newest `plaid_items.last_synced_at` is older than 12 hours; failures degrade to the stale-index notice, never block render. While `historical_data_complete` is false, the dashboard, `/score`, and `/report` show the persistent "history still loading… provisional" notice (§5 step 4), paired with an hourglass glyph, never color alone.
- **Disconnect** (two-step confirm): `/item/remove` first; on success → `status='disconnected'`, secret row deleted, accounts archived (`roster_status='unshared'`), history kept. On failure → `status='disconnect_pending'`, secret kept, "Retry disconnect" shown, and the row stays visible so a still-billable Item is never hidden. A second option, **Disconnect and delete this institution's data**, additionally removes the Item's accounts, their transactions, anchors, and batches (one RPC, `delete_connected_item_data`, same transactional pattern), then rebuilds. This is the data-deletion policy for connected data: disconnect keeps the ledger, delete removes it entirely; both are the user's choice.
- Stale-Item cleanup: Items in `error` or `login_required` for over 30 days show a "Still billable — reconnect or disconnect" line.

### 10. Engine & confidence touch points (principle 3)

- `transactions.confidence` stays PFI's field and stays null for synced rows in Slice 1; `category_confidence` is display-only (a "Category: high confidence" line in the transaction sheet) and never enters `metric-inputs`.
- `confidence.ts` gains the deferred **source-reliability inputs**, each computed from PFI's own facts: history completeness (any Item with `history_complete_at` null → a strong "transaction history still loading" reason, first in the list), account freshness (`last_synced_at` older than `STALE_AFTER_DAYS`, or `connection_status !== 'ok'`), balance freshness (effective anchor `freshness='cached'` older than 24h adds a mild reason; `entered` keeps existing behavior), transaction completeness (a non-zero `discrepancy` on the latest sync anchor), and categorization coverage (share of included-account outflows with `category='other'`). Methodology note in FINANCIAL_HEALTH_SCORE.md; `PFI_SCORE_VERSION` unchanged because confidence, not score, changes.
- `metric-inputs.ts`'s `manualShare` needs no change. `staleness.ts` already prefers the anchor date, so synced accounts read fresh automatically.
- No change to `snapshot-builder.ts`, `anchors.ts`, `rebuild-snapshots.ts`.

### 11. Security

- Tokens: encrypted with a versioned key, service-role-only table, never logged, never returned to the client. `plaidConfig()` lives in `env.server.ts`, never `env.ts`.
- Every action: `auth.getUser()` → RLS-scoped ownership read of the Item → only then the admin client, used for exactly three operations: read/write/delete `plaid_item_secrets`.
- The commit RPC is `security invoker`; it cannot see or change another user's rows even if called with a forged batch id.
- Logging: `error_type`, `error_code`, `request_id` only. `public_token`, `access_token`, `link_token`, account ids, masks, amounts, and descriptions are never logged.
- Link token `client_user_id` is the Supabase user id; Plaid never receives email or name. PFI stores only Plaid's `mask`.
- Throttled sync; no public endpoints added.
- Independent `security-reviewer` and `database-reviewer` passes before merge (auth, tenancy, secrets, RPC and trigger flag).

### 12. Testing & verification

- Unit (Vitest, default suite): `crypto` (round trip, key versions, tamper detection), `map-account`, `map-category` (exhaustiveness both ways), `map-transaction` (sign convention on depository and credit; provider-owned set only), `pair-transfers` (unique match pairs; two equal candidates do not; recurring identical amounts do not; liability-account loan payment pairs; non-liability does not), `roster` (create/unshare/close/reappear), `sync-plan` (idempotent re-run, pending excluded, modified→update with user fields preserved, amount change unpairs, removed→delete with audit record, anchor derivation and freshness, readiness mapping, cursor only in plan).
- Live (`pnpm test:live`, `.env.local` with sandbox keys): `plaid-sync.live.test.ts` mints a sandbox public token via `/sandbox/public_token/create` (bypasses Link UI), runs `exchangePublicToken` and `syncItem` through the real actions, asserts the Item reaches `connected` within a bounded poll, accounts/transactions/anchors/snapshots exist, a second sync inserts zero rows, a user override on a synced row survives a forced `modified` (via `/sandbox/transactions/create` then re-sync), the RPC rolls back on an injected failure (cursor unchanged), `/sandbox/item/reset_login` yields `login_required`, and disconnect calls `/item/remove` before the secret disappears.
- RLS (`pnpm test:rls`): the assertions in §1.
- e2e (Playwright): unchanged; Plaid env unset. Link's iframe is not automated.
- Live browser QA at 390×844 then 1280×900 against the sandbox institution (`user_good` / `pass_good`): connect, see "Preparing history," see it become Connected with a populated dashboard, Sync now, Reconnect, Disconnect, Disconnect-and-delete.
- `pnpm check` green before completion claims.

### 13. Acceptance criteria (frozen before planning)

Beyond the tests in §12, the slice is not done until each of these is demonstrated:

1. **Roster completeness.** A sandbox Item whose investment account has no transactions still gets that account created, anchored, and shown on `/accounts` after the first sync. Sync's own `accounts` array is never read for roster or anchors (a unit test on `sync-plan` asserts the plan is built from the `/accounts/get` list).
2. **Taxonomy versioning.** The sync request sets `options.personal_finance_category_version = 'v2'`; every synced row stores `pfc_primary`, `pfc_detailed`, and `category_taxonomy_version`; `map-category` tests run against both published CSVs and fail on any unmapped detailed value in either.
3. **RPC authorization.** All eight `pnpm test:rls` assertions listed in §1 pass live. The flag is documented in DATA_MODEL.md as an implementation detail; ownership assertions inside the function are the authorization.
4. **Partial-history state.** With a sandbox Item held in `history_loading` (poll before `HISTORICAL_UPDATE_COMPLETE`), the dashboard renders with the provisional notice and the confidence report lists "history still loading" first; after completion the notice clears and `history_complete_at` is set exactly once (a second sync does not change it).
5. **Rebuild dedup.** Two concurrent dashboard loads for a user with a `rebuild_completed_at = null` batch start exactly one rebuild (live test drives two parallel `getDashboardData` calls and asserts one claim). A stale holder cannot clobber a newer lease: the test expires worker A's lease, lets worker B claim, then has A release and asserts B's token is still held.

### 14. Documentation

DECISIONS #43 (this design and its revision), DATA_MODEL.md (new tables, columns, widened checks, the RPC and trigger flag), SECURITY_MODEL.md (token handling, rotation, admin-client scope, logging redaction, deletion policy), FINANCIAL_HEALTH_SCORE.md (source-reliability confidence inputs), KNOWN_LIMITATIONS.md, ROADMAP.md Phase 7 status, CURRENT_PHASE.md.

## Explicitly deferred

- **Webhooks and cron** (Slice 3): `rebuildSnapshots` and the sync writer take an explicit `userId` with `user_id` filters on every query; verified webhook route; daily Vercel cron.
- **Production cut-over** (Slice 2): Plaid production approval, per-Item pricing check, OAuth redirect URI, privacy-policy and consent language, real institutions.
- **Real-time balances** (`/accounts/balance/get`, separately billed) and the `realtime` freshness value it would write.
- **Driver events from real data.** `financial_events` are still written only by the demo loader.
- **Investments holdings and market appreciation.** New tables plus an engine change.
- **Piecewise anchors** for accounts whose balance moves daily without transactions.
- **Manual "mark as transfer" action** for the unpaired-transfers review list.
- **Merging** a fresh Item's accounts into an older disconnected Item's history at the same institution (Slice 1 refuses the duplicate link and points to Reconnect).
- **Pending transactions**, Liabilities product details (APR, due dates), Identity.
