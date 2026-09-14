# Plaid Link & Sync — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user links a bank through Plaid Link, PFI pulls up to 730 days of posted transactions and cached balances through `/transactions/sync` and `/accounts/get`, commits each sync atomically as a `connected_account` import batch, and keeps the connection fresh through "Sync now" and dashboard-load sync — with manual accounts untouched, sandbox-first, no webhooks, no cron.

**Architecture:** Plaid is another import source. Pure, framework-free mappers (`src/lib/plaid/`) turn Plaid shapes into PFI rows; a pure reducer builds a `SyncPlan`; one `security invoker` Postgres function (`commit_connected_sync`) applies the plan in a single transaction under RLS after explicit ownership assertions; the existing `finishWithRebuild` runs afterward. Tokens are AES-256-GCM encrypted in a service-role-only table. Provider-owned vs user-owned transaction columns are explicit; the immutability trigger allows provider-column rewrites only inside the RPC via a transaction-local, batch-scoped setting that is an implementation detail, never the authorization.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Supabase (Postgres/RLS/RPC), `plaid` Node SDK, `react-plaid-link`, Vitest, Playwright, Tailwind 4, Zod, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-14-plaid-link-sync-slice1-design.md` (frozen) — read it before starting any task. Section numbers below refer to it. DECISIONS #43.

## Global Constraints

- `src/lib/financial-engine/` and `src/lib/plaid/` pure modules stay framework-free (no React/Next, no SDK classes past `client.ts`) and deterministic — "today" and timestamps are parameters. Server glue (`sync.ts`, actions, queries) may use wall-clock time.
- Bounded Supabase queries only: `paginateSelect` from `src/lib/data/paginate.ts` for growable tables (DECISIONS #21). `financial_accounts`, `plaid_items`, `user_profiles` reads stay unpaginated per existing convention.
- Sign convention: Plaid positive amount → `outflow`, negative → `inflow`, every account type; liability inversion lives ONLY in `snapshot-builder.ts`'s `signedNet`. Anchor `balance` = Plaid `balances.current` (positive-owed for liabilities). Never duplicate the liability sign rule.
- Posted transactions only (`pending === false`). Provider-owned columns (§6) are the only columns sync ever writes on an existing row; `user_override`, `notes`, `essential`, `recurring_status`, `confidence`, pairing are never overwritten by sync (pairing is only *cleared* when the provider amount/date/direction changes).
- Roster and anchors come from `/accounts/get`, never from `/transactions/sync`'s `accounts` array (§13.1). Sync requests set `options.personal_finance_category_version = 'v2'` (§13.2).
- The cursor advances only inside `commit_connected_sync`. Nothing is written to `transactions`, `balance_anchors`, `financial_accounts`, or `plaid_items` during paging.
- Secrets: `PLAID_*` only through `env.server.ts`'s `plaidConfig()`; the admin client touches only `plaid_item_secrets`; logs carry `error_type`/`error_code`/`request_id` and nothing else from Plaid.
- UI: mobile-first (~390px first); state never by color alone (glyph + text); copy says "last synced with Plaid," never "live"; no-shame copy; every new surface has loading/empty/error/pending states.
- `pnpm check` green before any completion claim; `pnpm test:rls` after Task 1; `pnpm test:live` for sandbox suites (needs `.env.local` with sandbox keys); `pnpm test:e2e` after UI tasks (Plaid env stays unset there).
- Work on branch `worktree-plaid-slice1` in a worktree; never commit to `main`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the session line from the system reminder.

---

### Task 0: Dependencies, env, and feature flag

**Files:**
- Modify: `package.json` (add `plaid`, `react-plaid-link`)
- Modify: `src/lib/config/env.server.ts` (add `plaidConfig()`), `src/lib/config/env.server.test.ts`
- Modify: `.env.example`, `playwright.config.ts` (`webServer.env`: `PLAID_CLIENT_ID: ""`, `PLAID_SECRET: ""`)
- Modify: `docs/SECURITY_MODEL.md` (env + rotation procedure stub, filled in Task 15)

- [x] Run the `dependency-audit` skill on `plaid@47` and `react-plaid-link@5`; record the verdict in the PR description. Install with `pnpm add plaid react-plaid-link`.
- [x] `plaidConfig(source = process.env): PlaidServerConfig | null` — returns `null` when `PLAID_CLIENT_ID` and `PLAID_SECRET` are both absent/empty; throws a clear error on a partial set, a malformed `PLAID_ENV`, or a `PLAID_TOKEN_ENCRYPTION_KEY` that is not 32 bytes base64. `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` optional, same validation. Tests: unset → null; partial → throws naming the missing var; bad key length → throws; full → typed config.
- [x] `.env.example` documents the five vars with one-line comments (sandbox default; key generated with `openssl rand -base64 32`).
- [x] `pnpm check` green.

### Task 1: Migration `0015_plaid_link_sync` + RPCs + RLS tests

**Files:**
- Create: `supabase/migrations/0015_plaid_link_sync.sql`
- Modify: `scripts/test-rls.mts`
- Modify: `docs/DATA_MODEL.md`

- [x] Write the migration exactly as §1: widened `provider`/`source` checks; `balance_anchors.observed_at`/`source_updated_at`/`freshness`; `plaid_items` (all statuses incl. `disconnect_pending`, `update_status`, `history_complete_at`, cursor, `last_sync_attempt_at`) with owner-only four-policy RLS; `plaid_item_secrets` with RLS enabled, no policies, `revoke all … from authenticated, anon`; `financial_accounts.plaid_item_id`/`external_account_id`/`roster_status` + unique index on `(plaid_item_id, external_account_id)`; `transactions.external_id`/`category_confidence`/`pfc_primary`/`pfc_detailed`/`category_taxonomy_version` + partial unique index; `import_batches.plaid_item_id`/`sync_metadata`/`rebuild_completed_at`; `user_profiles.rebuild_claimed_at` + `rebuild_claim_token uuid`.
- [x] Re-create `transactions_prevent_source_update()` (same pattern 0004 used): add the five new columns to the frozen list; add the escape hatch — when `current_setting('pfi.provider_write', true)` is non-empty AND equals `new.import_batch_id::text` OR the batch id passed for the row (use `coalesce(new.import_batch_id, old.import_batch_id)`), permit changes to the provider-owned set only (`posted_date, authorized_date, amount, direction, description, category, subcategory, category_confidence, pfc_primary, pfc_detailed, category_taxonomy_version, is_transfer, transfer_pair_id`); everything else stays frozen even with the flag. Comment in SQL: "implementation detail; authorization is the ownership assertions in commit_connected_sync."
- [x] `commit_connected_sync(p_batch_id uuid, p_plan jsonb) returns jsonb` — plpgsql, `security invoker`, `set search_path = public`. Order: (a) assert batch, its `plaid_item_id` Item, every `plan.accounts[].id`, and every `plan.updates[].id`/`plan.deletes[].id` belong to `auth.uid()` via `count(*)` equality checks; raise `'commit_connected_sync: ownership'` otherwise; (b) `perform set_config('pfi.provider_write', p_batch_id::text, true)`; (c) roster: insert new accounts, archive/unarchive with `roster_status`; (d) deletes (record audit rows into a local jsonb); (e) updates of provider columns + unpair when flagged; (f) inserts with `on conflict (account_id, external_id) where external_id is not null do nothing`; (g) anchors; (h) `plaid_items` cursor/status/`update_status`/`history_complete_at` (set only if null and plan says complete)/`last_synced_at`; (i) mirror `connection_status`/`last_synced_at` onto the Item's accounts; (j) batch `status='confirmed'`, `reconciliation_results`, `sync_metadata`; return counts. Grant execute to `authenticated`.
- [x] `delete_connected_item_data(p_item_id uuid) returns jsonb` — same shape: assert ownership, then delete anchors, transactions, batches, accounts of the Item; mark Item `disconnected`. Grant to `authenticated`.
- [x] Applied to the linked project via the Supabase MCP `apply_migration` (recorded as version `plaid_link_sync`); the two functions were re-applied once after the delete-path fix. Note: 0013/0014 are present in the schema but absent from the remote migration history (applied outside the recorder) — pre-existing, reported.
- [x] `scripts/test-rls.mts`: add the eight §1 assertions (cross-user `plaid_items` read empty; owner `plaid_item_secrets` select → permission error, not `[]`; service role reads it; user B RPC with A's batch → raises; A's batch with a plan naming B's account id → raises; `rpc('set_config')` → PostgREST error; direct `update transactions set amount` → immutability error before and after an RPC call in the same session; migration text contains exactly one function referencing `pfi.provider_write`). `pnpm test:rls` — **script written, not yet run**: no `.env.local` exists on this machine (needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Equivalent checks were run as impersonated `authenticated` users inside a rolled-back transaction via `execute_sql` (secrets denied to owner; cross-user and foreign-id RPC calls raise; happy path; idempotent re-run; frozen direct updates; in-place modify keeps `user_override`; removal unpairs survivor; `history_complete_at` set once; delete path). Run the script once credentials are present.
- [x] DATA_MODEL.md: new tables/columns, the RPCs, and the flag documented as an implementation detail.

### Task 2: `types.ts` + `crypto.ts`

**Files:**
- Create: `src/lib/plaid/types.ts`, `src/lib/plaid/crypto.ts`, `src/lib/plaid/crypto.test.ts`

- [x] `types.ts`: plain shapes — `PlaidAccountShape` (id, name, official_name, mask, type, subtype, balances {current, available, limit, last_updated_datetime}), `PlaidTransactionShape` (transaction_id, account_id, amount, date, authorized_date, name, merchant_name, pending, personal_finance_category {primary, detailed, confidence_level}, taxonomy version), `SyncPages`, `SyncPlan` (the exact jsonb the RPC consumes: `accounts`, `inserts`, `updates`, `deletes`, `anchors`, `item`, `audit`), `ItemStatus`, `UpdateStatus`.
- [x] `crypto.ts`: `encryptToken(plaintext, key, version)` / `decryptToken(payload, keys: Record<version, key>)` with Node `webcrypto` AES-256-GCM, random 12-byte IV, base64 `iv||ciphertext||tag`. Tests: round trip; wrong key fails; tampered byte fails; version routing picks the right key; key length enforced.

### Task 3: `map-account.ts`

**Files:**
- Create: `src/lib/plaid/map-account.ts`, `src/lib/plaid/map-account.test.ts`

- [x] `mapAccountType(type, subtype): AccountType` per §8; `mapAccount(shape, institutionName): NewAccountRow` (`provider='plaid'`, `display_name = official_name ?? name`, `mask`, `credit_limit = balances.limit`, `external_account_id`). Table-driven tests for every listed subtype plus unknowns → fallbacks (`brokerage`, `personal_loan`, `other_asset`).

### Task 4: `map-category.ts` with v1/v2 fixtures

**Files:**
- Create: `src/lib/plaid/fixtures/pfc-v1.csv`, `src/lib/plaid/fixtures/pfc-v2.csv` (Plaid's published taxonomy CSVs, committed verbatim)
- Create: `src/lib/plaid/map-category.ts`, `src/lib/plaid/map-category.test.ts`

- [ ] `mapCategory(version: 'v1'|'v2', primary: string, detailed: string | null): Category` — detailed-level rules first (`FOOD_AND_DRINK_GROCERIES`, `LOAN_PAYMENTS_MORTGAGE_PAYMENT`, `RENT_AND_UTILITIES_RENT`, `GENERAL_SERVICES_INSURANCE`, …), then primary rules (§8). v2-only detailed values are enumerated explicitly.
- [ ] Tests parse both CSVs: every row maps without falling through to the unknown branch; every `Category` except `savings` is reachable from at least one PFC value (document `savings` as reachable only through pairing/override); a snapshot test of the full v2 mapping so changes are reviewed.

### Task 5: `map-transaction.ts`

**Files:**
- Create: `src/lib/plaid/map-transaction.ts`, `src/lib/plaid/map-transaction.test.ts`

- [ ] `toProviderColumns(txn, version): ProviderColumns` — `posted_date = date`, `authorized_date`, `amount = abs`, `direction` by sign, `description = merchant_name ?? name`, `category` via Task 4, `category_confidence` lower-cased (`unknown` when absent), `pfc_primary/detailed` verbatim, `category_taxonomy_version`, `external_id = transaction_id`. Tests: sign on depository and credit; `pending` rows rejected by a guard; provider column set is exactly §6's left column (a test enumerates keys).

### Task 6: `pair-transfers.ts`

**Files:**
- Create: `src/lib/plaid/pair-transfers.ts`, `src/lib/plaid/pair-transfers.test.ts`

- [ ] `pairTransfers(candidates, existing, accounts, windowDays = 3): PairingResult` per §7: opposite directions, equal amounts, distinct non-archived accounts, kind-compatible (`TRANSFER_OUT`↔`TRANSFER_IN`; `LOAN_PAYMENTS_*` outflow ↔ inflow on a `LIABILITY_TYPES` account), within window, **exactly one candidate on each side**. Returns pairs plus `ambiguous[]` for the review list.
- [ ] Tests: unique match pairs; two equal-amount candidates → none; recurring identical amounts across weeks pair only within-window uniques; loan payment to a linked card pairs, to a checking account does not; already-paired counterpart excluded; `csv`/`demo` counterpart → pair recorded one-sided (existing row untouched) and flagged.

### Task 7: `roster.ts`

**Files:**
- Create: `src/lib/plaid/roster.ts`, `src/lib/plaid/roster.test.ts`

- [ ] `reconcileRoster(plaidAccounts, pfiAccountsForItem, today): RosterPlan` — create / unshare+archive / closed+archive / reappear+unarchive, each with an audit line. Tests for all four transitions, idempotence on an unchanged roster, and that an investment account with zero transactions is still created (§13.1).

### Task 8: `sync-plan.ts`

**Files:**
- Create: `src/lib/plaid/sync-plan.ts`, `src/lib/plaid/sync-plan.test.ts`

- [ ] `buildSyncPlan({ pages, accountsGet, existingTxns, pfiAccounts, priorAnchors, item, today }): SyncPlan` composing Tasks 3–7: readiness mapping (`update_status` → `ItemStatus`, `historyComplete` flag), inserts (pending excluded, existing external ids dropped), updates (provider columns; unpair when amount/date/direction changed), deletes with audit records, anchors from `accountsGet` (`freshness='cached'`, `observed_at=today`, `source_updated_at`, `anchor_date` rule, `discrepancy` via `computeDiscrepancy` from `financial-engine/anchors.ts`, skip identical), pairing, item cursor.
- [ ] Tests: idempotent re-run produces an empty plan; pending excluded; modified keeps user fields (plan contains no user-owned keys); amount change unpairs both; removed → delete + audit record fields; anchor derivation incl. investment account absent from sync `accounts`; readiness transitions incl. `history_complete_at` set once; cursor present only in `item`; `UNKNOWN` keeps prior status.

### Task 9: `client.ts` + `sync.ts` (server-only)

**Files:**
- Create: `src/lib/plaid/client.ts`, `src/lib/plaid/sync.ts`

- [ ] `client.ts`: `getPlaidClient()` from `plaidConfig()`; a `call(name, fn)` wrapper that returns `{ data, requestId }` and, on error, throws a `PlaidCallError` carrying only `error_type`, `error_code`, `request_id`. `import "server-only"`.
- [ ] `sync.ts`: `syncPlaidItem(supabase, itemId, { force })`: ownership read → throttle (`last_sync_attempt_at`: 10 min, 1 min while `initializing`/`history_loading`) → set `last_sync_attempt_at` → admin client decrypt → insert batch (`extracting`) → `/accounts/get` → page `/transactions/sync` with `options.personal_finance_category_version: 'v2'` (one restart on mutation-during-pagination) → load existing rows/anchors (paginated) → `buildSyncPlan` → `rpc('commit_connected_sync')` → on RPC error mark batch `failed` with reason and rethrow as `MutationResult.error` → `finishWithRebuild` → set `rebuild_completed_at` on success. Plaid error mapping per §5 (login_required / error / rate limit) writes Item status and batch failure with `request_id` in `sync_metadata`.

### Task 10: Server actions `src/app/actions/plaid.ts`

**Files:**
- Create: `src/app/actions/plaid.ts`
- Modify: `src/lib/validation/transactions.ts` (or new `src/lib/validation/plaid.ts`) for Zod inputs

- [ ] `createLinkToken()` and `createUpdateLinkToken(itemId)` (update mode with decrypted `access_token`).
- [ ] `exchangePublicToken({ publicToken, institutionId, institutionName })`: exchange → duplicate-institution guard (`/accounts/get`, match `(type, mask)` against an existing non-disconnected Item at the same `institution_id`; on match `/item/remove` the new Item and return the "already connected — use Reconnect" error) → insert Item (`initializing`) → encrypt + insert secret (admin) → roster create → `syncPlaidItem(force)` → return summary.
- [ ] `syncItem(itemId, force?)`, `syncAll()`.
- [ ] `disconnectItem(itemId)`: `/item/remove` first; success → `disconnected`, delete secret, archive accounts (`roster_status='unshared'`); failure → `disconnect_pending`, keep secret, return retryable error. `deleteItemData(itemId)`: `/item/remove` (if not already disconnected) then `rpc('delete_connected_item_data')` then `finishWithRebuild`.
- [ ] Every action: `auth.getUser()` → Zod → RLS-scoped Item read → work → `MutationResult`. No Plaid identifiers in error strings beyond `error_code`.

### Task 11: Queries, mappers, dashboard-load sync + rebuild claim

**Files:**
- Modify: `src/lib/data/queries.ts` (`getConnectedItems`, `getDashboardData` triggers, `getRecentImports` label), `src/lib/data/mappers.ts` (`AccountSummary.provider` union + `rosterStatus`, `ConnectedItemSummary`), `src/lib/data/mappers.test.ts`
- Create: `src/lib/data/rebuild-claim.ts` (+ test of the conditional-update SQL shape via a live test in Task 14)

- [ ] `getConnectedItems(supabase)`: Items with status, `last_synced_at`, `history_complete_at`, error code, account count, and `stillBillable` (error/login_required older than 30 days).
- [ ] `getDashboardData`: (a) if newest `last_synced_at` older than 12h → `syncAll` best-effort; (b) if any confirmed `connected_account` batch has `rebuild_completed_at` null → `claimRebuild(supabase)` (a `randomUUID()` claim token; conditional update sets `rebuild_claim_token` + `rebuild_claimed_at` only when null or older than 2 minutes); on claim → rebuild, set `rebuild_completed_at` on those batches, then token-scoped release in `finally` (`… where rebuild_claim_token = $token`, so an overrun worker never clears a newer lease); no claim → `staleIndex = true`. (c) `historicalDataComplete` boolean in the return.
- [ ] `getRecentImports`: join `import_batches.source_type` so synced batches label "Synced."
- [ ] `getFreshnessData`: include `freshness`/`observed_at` on the effective anchor for the confidence inputs (Task 12).

### Task 12: Confidence — source-reliability inputs

**Files:**
- Modify: `src/lib/financial-engine/metric-inputs.ts` (`dataQuality` gains `historyIncomplete`, `staleConnectedShare`, `cachedBalanceStale`, `latestAnchorDiscrepancy`, `otherCategoryShare`), `src/lib/financial-engine/confidence.ts`, both tests
- Modify: `src/lib/data/queries.ts` (`fetchScoreSources` supplies the new facts), `docs/FINANCIAL_HEALTH_SCORE.md`

- [ ] Rules per §10, in this order of reasons: "Transaction history still loading from Plaid" (cap `limited` on all dimensions while `historyIncomplete`); stale/disconnected connected accounts; cached balance older than 24h (mild); non-zero latest sync discrepancy ("some transactions may be missing"); `other`-category outflow share > 25%. `IMPROVEMENTS` gains matching advice lines. `PFI_SCORE_VERSION` unchanged (confidence only).
- [ ] Tests for each rule and for ordering. Methodology paragraph in FINANCIAL_HEALTH_SCORE.md.

### Task 13: UI

**Files:**
- Create: `src/app/accounts/ConnectedInstitutionsCard.tsx`, `src/components/dashboard/HistoryLoadingNotice.tsx`
- Modify: `src/app/accounts/page.tsx`, `src/app/accounts/AccountsView.tsx` (card above list; "Synced" chip; archived-group reason), `src/app/accounts/RecentImports.tsx` (label), `src/app/page.tsx` + `src/app/score/page.tsx` + `src/app/report/page.tsx` (notice), `src/app/transactions/TransactionSheet.tsx` (category-confidence line), `src/app/transactions/TransactionsView.tsx` ("Possible transfers to review" filter)

- [ ] Card states per §9: not configured; empty + demo notice; rows with glyph+text status (hourglass Preparing history with auto re-sync on mount while `initializing`/`history_loading`; check Connected; triangle Needs reconnect; x-circle Error; clock Disconnect pending), "Last synced with Plaid …", Sync now (pending → summary: added/updated/removed/roster changes/anchor as-of), Reconnect (update-mode Link), Disconnect (two-step) with "Disconnect and delete this institution's data" as a second explicit option, "Still billable" line after 30 days.
- [ ] `usePlaidLink` wiring; `onSuccess` → `exchangePublicToken`; `onExit` errors surfaced as text.
- [ ] `HistoryLoadingNotice` with hourglass glyph, shown on dashboard/score/report while `historicalDataComplete === false`.
- [ ] Verify at 390×844 first, then 1280×900. `pnpm test:e2e` green with Plaid env unset (card shows "not configured").

### Task 14: Live sandbox + concurrency tests

**Files:**
- Create: `src/lib/plaid/plaid-sync.live.test.ts`, `src/lib/data/rebuild-claim.live.test.ts`

- [ ] Sandbox suite (skips with a clear message when `PLAID_*` absent): throwaway user → `/sandbox/public_token/create` (`ins_109508`, `user_good`) → `exchangePublicToken` → poll `syncItem(force)` until `connected` (bounded) → assert accounts incl. any zero-transaction investment account, transactions with `pfc_*` + `category_taxonomy_version`, `cached` anchors, snapshots; second sync inserts zero; set a `user_override` then `/sandbox/transactions/create` + re-sync → override survives; inject an RPC failure (plan naming a foreign account id) → batch `failed`, cursor unchanged; `/sandbox/item/reset_login` → `login_required`; `disconnectItem` → `/item/remove` observed before secret row disappears (assert via admin read ordering); `history_complete_at` set exactly once across syncs. Teardown removes the Item and user.
- [ ] Rebuild-claim suite: seed a confirmed batch with `rebuild_completed_at = null`; run two `getDashboardData` calls concurrently; assert exactly one claim and one rebuild (count `daily_snapshots` delete/insert via a spy on `rebuildSnapshots` or timestamps), claim released afterward, expired claim reclaimable; **stale-holder test**: A claims, lease is aged past 2 minutes (admin update), B claims with a new token, A's release runs and matches zero rows, B's token is still held; then B releases normally.

### Task 15: Docs, reviews, QA, verification

**Files:**
- Modify: `docs/DECISIONS.md` (#43 implementation notes only if anything deviated), `docs/DATA_MODEL.md`, `docs/SECURITY_MODEL.md` (token handling, rotation script, admin-client scope, logging redaction, deletion policy), `docs/KNOWN_LIMITATIONS.md` (manual "mark as transfer" deferred; one-sided pairing for csv/demo counterparts; piecewise anchors; investments balance-only), `docs/ROADMAP.md`, `docs/CURRENT_PHASE.md`, `README.md` (Phase 7 row)
- Create: `scripts/rotate-plaid-key.mts`

- [ ] Rotation script: for every secret row, decrypt with the row's version, re-encrypt with current, bump `key_version`, set `rotated_at`; dry-run flag; documented in SECURITY_MODEL.md.
- [ ] Independent reviews: `code-reviewer`, `security-reviewer` (auth, tenancy, secrets, RPC flag, logging), `database-reviewer` (migration, trigger change, RPC, indexes). Fix findings.
- [ ] Live browser QA (gstack `browse`, real linked project, sandbox keys) at 390×844 then 1280×900: connect → Preparing history → Connected with populated dashboard and notice cleared → Sync now → Reconnect → Disconnect → Disconnect-and-delete. Record in CURRENT_PHASE "Test status."
- [ ] Acceptance criteria §13.1–13.5 each demonstrated and cited (test name or QA step) in CURRENT_PHASE.
- [ ] `pnpm check`, `pnpm test:rls`, `pnpm test:live`, `pnpm test:e2e` all green on the branch; open PR with the dependency-audit verdict and review summaries.
