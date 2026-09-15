# Security Model

Status: core auth + persistence security landed this phase (magic-link auth, schema, RLS, tenant-isolation tests). Real user accounts can exist now, though the only data flowing through the pipeline so far is the demo dataset (seeded through the real path — DECISIONS.md #10). This document states the rules the rest of persistence work (manual entry, CSV import, aggregation) must keep landing with.

## Current state (Phase 0–1)

- Environment variables validated at startup via Zod (`src/lib/config/env.ts`); `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are now **required**, not optional — missing/malformed vars fail loudly. Secrets are never committed (`.env*` gitignored; `.env.example` documents shape only).
- No secrets in client bundles: only `NEXT_PUBLIC_*` values reach the browser.
- **Service-role key is narrowly scoped.** `SUPABASE_SERVICE_ROLE_KEY` is read by `scripts/` (RLS test, dev login, key rotation) and, in application code, only through `createAdminClient()` (`src/lib/supabase/admin.ts`) for an enumerated set of operations: username→email resolution and pre-verification consent (password auth, DECISIONS #28) and the `plaid_item_secrets` insert/read/delete (Plaid, DECISIONS #43). Every other application query uses the anon-key client (`src/lib/supabase/server.ts`) and is subject to RLS. `getDashboardData` (and all query helpers) must only ever be called with that RLS-bound client, never a service-role client.
- **`supabase config push` syncs the entire `[auth]` section of `supabase/config.toml`, not a diff.** Any auth setting (redirect URLs, providers, site URL) configured only through the dashboard is silently reverted on the next push. All auth configuration must be committed to `supabase/config.toml` — that file is the source of truth.

## Implemented (this phase)

- **Supabase Row-Level Security on every table, default deny.** Migration `0001_core` enables RLS on all six tables (`user_profiles`, `personal_companies`, `financial_accounts`, `transactions`, `financial_events`, `daily_snapshots`) with owner-only `select`/`insert`/`update`/`delete` policies keyed on `auth.uid()`. Migration `0002_integrity` adds a trigger enforcing `transactions.account_id` belongs to `transactions.user_id` (relies on RLS visibility of `financial_accounts` under SECURITY INVOKER — a forged cross-tenant `account_id` is invisible to the check, not just rejected by a redundant `auth.uid()` comparison), plus a trigger that makes transaction source columns immutable after insert (corrections must go through `user_override`; a backfill that must legitimately change a source column has to disable this trigger around the update — see KNOWN_LIMITATIONS).
- **Tenant isolation is automated-tested.** `pnpm test:rls` (`scripts/test-rls.mts`) provisions two real users against the live project and asserts cross-tenant reads/writes/updates/deletes all fail across every table — 9/9 checks passing, run twice with no leaked users left behind, admin cleanup runs regardless of assertion outcome.
- **Auth is magic-link only (PKCE).** No passwords are stored. `/auth/callback` exchanges the PKCE code; the route guard (`src/proxy.ts`) redirects unauthenticated requests to `/login` and authenticated requests away from `/login`. Onboarding gating is a separate mechanism: `src/app/onboarding/page.tsx` redirects already-onboarded users home, and `src/app/page.tsx` redirects not-yet-onboarded users to `/onboarding` (DB-checked in the page components, not in the proxy).
- **`ai_narrations` (Phase 4, migration `0009_ai_narrations.sql`).** Owner-only RLS (`select`/`insert`/`update`/`delete` all keyed on `auth.uid() = user_id`), same pattern as every other table. Unlike `balance_anchors` (DECISIONS #25), it needs no account-ownership trigger: its only foreign key is `user_id → user_profiles.id`, a direct owner reference with no secondary `account_id`-style ambiguity a forged insert could exploit — RLS alone is a complete guard here.

## AI data boundary (Phase 4)

- **What leaves the app:** only the fields in `NarrationInput` (`src/lib/ai/schemas.ts`, `.strict()`) — derived, code-calculated metrics with dollar values (available capital, cushion, momentum, score), and up to 4 "drivers" identified by a closed `FinancialEventType` enum only.
- **What never does:** raw transactions, merchant names, account identifiers/numbers, or `FinancialEvent.label` (which may embed user-entered free text) and event ids. Drivers are typed and dated only — no free-text label crosses the boundary in either direction. `NarrationOutput` is itself checked post-hoc (`referencesOnlyKnownDrivers`) so the model cannot introduce a driver reference that wasn't in its input.
- **Logging redaction.** `getOrGenerateNarration` (`src/lib/data/narration.ts`) logs only the failure class/message on a generation or cache-write error (`console.error("[ai] narration ... failed:", err.message)`) — never the metric values, the prompt, or the model's output.
- **Progressive enhancement.** `AI_GATEWAY_API_KEY` unset (including empty string, `src/lib/config/env.ts`) disables the AI path entirely; the deterministic `PerformanceBrief` (data already computed by `src/lib/financial-engine`) renders instead, with no visible structural difference. `playwright.config.ts`'s `webServer` forces the key to `""` so e2e never depends on a developer's local key.
- **CSV mapping boundary.** CSV files remain in the browser. Deterministic mapping runs first. When it cannot identify unfamiliar headers or bank category labels, the optional authenticated AI mapping action sends only column names, aggregate structural ratios, the selected account type, and unique bank-provided category labels. It never sends filenames, account ids, transaction descriptions, dates, amounts, balances, or raw CSV rows; suggestions are schema-validated and remain subject to preview and user correction.

## Rules for Phase 3+ (manual entry, CSV import, aggregation)

- **Server-side authorization on every query.** No financial records exposed through public client queries.
- **Public/private separation.** Public leaderboard and cohort queries read only from aggregated or explicitly public tables — never from raw financial tables. Cohorts below minimum size are suppressed.
- **Masked identifiers only.** Never store full account numbers; provider-safe masked values only.
- **Immutable sources + audited corrections.** Landed for `transactions` (0002's immutability trigger + `user_override`); still needed for other source tables as they gain correction UI. Original imported values are never overwritten; user corrections are stored alongside with an audit trail.
- **Logging:** audit-friendly, with sensitive values (balances, merchants, tokens) redacted. Administrative access is logged. No employee/admin casual browsing of identifiable financial histories.
- **Analytics:** product analytics never receive raw balances, transaction values, or merchant names.
- **AI:** prompts redact sensitive data where possible; strict per-user context isolation.
- **Migrations:** all schema changes through committed migration history.
- **Rate limiting** on write/import endpoints.
- **User control:** account disconnection, full data export, full deletion.
- Data is never sold; individual transaction histories are never used for advertising.

## Plaid bank connections (Phase 7, Slice 1, DECISIONS #43)

Spec: `docs/superpowers/specs/2026-09-14-plaid-link-sync-slice1-design.md` §11.

- **Configuration is server-only.** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TOKEN_ENCRYPTION_KEY`, and the rotation-only `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` are read exclusively through `plaidConfig()` in `src/lib/config/env.server.ts` — never `env.ts`, never `NEXT_PUBLIC_*`. Unset as a group, the feature is disabled (the Connected-institutions card renders "not configured"); a partial set throws at first use. `playwright.config.ts` forces all of them empty so e2e never touches Plaid.
- **Access tokens.** AES-256-GCM at the application layer (`src/lib/plaid/crypto.ts`: random 12-byte IV, base64 iv‖ciphertext‖tag, tamper-detecting), stored in `plaid_item_secrets` with RLS enabled, **no policies and no grants** to `authenticated`/`anon`. Only the service role can read or write it; the browser client (which runs as the owner) cannot even select. `key_version` is a fingerprint of the key bytes, so rotation needs no counter: set the new key, move the old one to `_PREVIOUS`, redeploy, run `pnpm tsx --env-file=.env.local scripts/rotate-plaid-key.mts` (`--dry-run` first), unset `_PREVIOUS`, redeploy.
- **Admin-client scope.** `createAdminClient()` is used by the Plaid code for exactly three operations: insert, read, and delete of `plaid_item_secrets`. Every other Plaid read/write runs as the signed-in user under RLS.
- **Authorization inside the database.** `commit_connected_sync` and `delete_connected_item_data` are `security invoker` and assert `auth.uid()` ownership of the batch, the Item, every account, and every transaction they touch before writing. The transaction-local setting `pfi.provider_write` that lets the immutability trigger accept provider-column rewrites is an implementation detail set only by those two functions after their assertions; `set_config` is not reachable through PostgREST. `pnpm test:rls` asserts all of this live.
- **Logging.** Plaid failures log `error_type`, `error_code`, `request_id` only (`src/lib/plaid/client.ts`). `link_token`, `public_token`, `access_token`, account ids, masks, amounts, and descriptions are never logged. `request_id`s are kept in `import_batches.sync_metadata` for support.
- **What Plaid receives.** `client_user_id` = the Supabase user id; no email, name, or PFI data. PFI stores Plaid's `mask` only, never a full account number.
- **User control.** Disconnect calls `/item/remove` first (ends Plaid billing), then marks the Item disconnected, deletes the secret, and archives the accounts with history kept; if Plaid refuses, the Item stays visible as `disconnect_pending` and retryable. "Disconnect and delete this institution's data" additionally removes its accounts, transactions, anchors, and batches through the transactional RPC. Items broken for over 30 days are flagged "still billable".
- **Rate limiting.** Sync is throttled per Item (10 minutes; 1 minute while history is loading); Plaid's own `RATE_LIMIT_EXCEEDED` is surfaced as a retry message.

## Plaid production runbook (Phase 7, Slice 2, DECISIONS #44)

Spec: `docs/superpowers/specs/2026-09-15-plaid-slice2-production-and-derived-events-design.md` §1, §4.

**Environment matrix.** Items are per Plaid environment, so Sandbox and Production never mix.

| Where | `PLAID_ENV` | `PLAID_SECRET` | `PLAID_REDIRECT_URI` | `PLAID_MAX_ITEMS` |
| --- | --- | --- | --- | --- |
| Vercel **Production** | `production` | Production secret | `https://pfi-one.vercel.app/plaid/oauth` | `5` (default) |
| Vercel Preview / Development | `sandbox` | Sandbox secret | unset, or a registered preview URL | `5` |
| Developer `.env.local` | `sandbox` | Sandbox secret | `http://localhost:3000/plaid/oauth` (http is accepted only for localhost/127.0.0.1 in sandbox) | `5` |
| Playwright e2e | all `PLAID_*` forced empty | — | — | — |

Production keys never enter `.env.local`; `plaidConfig()` validates the redirect URI (absolute, no query/fragment, https except sandbox-localhost) and the cap (integer 1–20) at first use.

- **OAuth return.** `redirect_uri` is passed on every link token (fresh and update mode). Before opening Link, the card stores `{ linkToken, mode, itemId?, createdAt }` in `localStorage['pfi.plaid.link']` (same-origin, expires after 30 minutes, cleared on success/exit; localStorage rather than sessionStorage because the installed PWA may return from the bank in a different browsing context, per Plaid's guidance). `/plaid/oauth` sits behind the proxy's auth gate; it reads that session, hands `window.location.href` to Link as `receivedRedirectUri`, and never parses Plaid's `oauth_state_id` itself. A visit without a stored session, or without a query string, is treated as expired. The result the page hands back to the card (`localStorage['pfi.plaid.result']`) is a validated `{ ok, message, warning }` rendered as text. A link token is useless without the same origin and the signed-in user's session, and Plaid rejects a redirect URI that is not registered for the client id.
- **Item cap.** `createLinkToken` refuses when the user's non-disconnected Items ≥ `PLAID_MAX_ITEMS`; `exchangePublicToken` re-checks and, if a token minted under the cap from another tab arrives late, removes the new Item at Plaid (`/item/remove`) before answering — a billing bound (best-effort at the app layer, hard-capped at 20 by the 0019 trigger), not a tenancy boundary (RLS remains the boundary).
- **Consent.** `/privacy` has a "Connected accounts (Plaid)" section and lists Plaid as a processor; `PRIVACY_VERSION`/`TERMS_VERSION` were bumped to `2026-09-15`, so the existing consent gate re-prompts every user. A per-device "How connecting works" sheet precedes the first Link open (`localStorage['pfi.plaid.disclosure.v1']`) — a notice, not a recorded consent.
- **Sandbox chip.** While `PLAID_ENV=sandbox`, the Connected-institutions card shows a "Sandbox" chip so a test bank on the live site is never mistaken for a real one.
- **Derived events.** `financial_events` rows with `source = 'derived'` reference the user's own transactions (ownership trigger + FK cascade) under the unchanged owner-only RLS; the derivation runs as the signed-in user, never touches provider-owned columns, and never runs for demo accounts.
- **Account deletion.** There is no in-product "delete my account" yet; deleting a user through the Supabase admin API cascades `plaid_items` and `plaid_item_secrets` **without** calling `/item/remove`, which would leave the Items live and billable at Plaid with no token left to revoke them. Before deleting a user: run "Disconnect" on every institution from the app (or call `disconnectItem` for each non-disconnected Item), or remove the Items in the Plaid dashboard. The privacy policy says exactly this.
- **Cap backstop.** The mint/exchange checks are read-then-insert; migration 0019 adds a `before insert` trigger that refuses a 21st active Item per user regardless (the ceiling `PLAID_MAX_ITEMS` accepts), so a parallel-flow race is bounded.
- **Rollback.** Flip Vercel Production's `PLAID_ENV` back to `sandbox` (or remove the `PLAID_*` group to disable the card) and redeploy; Production Items stay at Plaid until disconnected from a Production deploy or removed in the Plaid dashboard, so disconnect real Items first if the rollback is permanent.

**Owner checklist before the first real bank (outside the codebase):**
1. Plaid dashboard → Company/application profile: legal name, product name, website `https://pfi-one.vercel.app`, support email, privacy policy URL `https://pfi-one.vercel.app/privacy`, use case "personal financial dashboard for the account holder".
2. Request Production access for Transactions; wait for approval.
3. Dashboard → API → "Allowed redirect URIs": add `https://pfi-one.vercel.app/plaid/oauth` (and `http://localhost:3000/plaid/oauth` for local sandbox OAuth testing).
4. Confirm pay-as-you-go billing and the per-Item Transactions price.
5. Vercel Production env: `PLAID_CLIENT_ID`, `PLAID_SECRET` (Production), `PLAID_ENV=production`, `PLAID_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64), `PLAID_REDIRECT_URI`, optionally `PLAID_MAX_ITEMS`; redeploy.
6. Verify the OAuth path in Sandbox first (`QA_OAUTH=1 npx tsx --env-file=.env.local scripts/qa-plaid-link.ts` against a local dev server with the localhost redirect URI registered), then link one real institution on the live site and confirm drivers appear on the dashboard.

## Threat-model notes to expand in Phase 3

Cross-tenant leakage (RLS bypass), re-identification through cohort aggregates (minimum cohort sizes, suppression, consider differential privacy in Phase 8), CSV import abuse (size limits, parser hardening), and scraping of public profiles.
