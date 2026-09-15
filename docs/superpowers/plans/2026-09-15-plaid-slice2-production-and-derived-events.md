# Plaid Slice 2 — Production cut-over & derived driver events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real banks can be linked from the live site (OAuth round-trip, consent disclosed, billing bounded), and a household with only synced accounts sees "What moved your line" drivers, chart markers, and report investment contributions, derived deterministically from its transactions.

**Architecture:** Production is configuration + one redirect page + consent text. Driver events are a stored, sourced, versioned derivation (`financial_events.source = 'derived'`) produced by a pure engine function and rebuilt alongside snapshots; demo events stay authored (`source = 'demo'`).

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Supabase (Postgres/RLS/RPC), `plaid` SDK, `react-plaid-link`, Vitest, Playwright, Tailwind 4, Zod, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-plaid-slice2-production-and-derived-events-design.md` (frozen). DECISIONS #44.

## Global Constraints

- `src/lib/financial-engine/` stays framework-free and deterministic: `asOfDate` and timestamps are parameters; no `Date.now()`.
- Derivation reads **effective** (override-applied) transactions; never writes provider-owned columns; never runs for `provider = 'demo'` accounts.
- Derived rows are replaced wholesale per rebuild; `source = 'demo'` rows are never touched by derivation, and `clearDemoData` never touches `source = 'derived'`.
- Rule changes bump `EVENT_DERIVATION_VERSION`.
- Production keys never enter `.env.local`; `PLAID_ENV=production` only in Vercel Production.
- Item cap enforced server-side. `PLAID_REDIRECT_URI` server-only.
- UI: mobile-first; glyph + text; every new surface has loading/empty/error states.
- Bounded queries via `paginateSelect` on growable tables.
- `pnpm check` green before completion claims; `pnpm test:rls` after Task 1; `pnpm test:live` after Task 6; `pnpm test:e2e` after UI tasks.
- Branch `worktree-plaid-slice2` (worktree `~/Dev/PFI-worktrees/worktree-plaid-slice2`); never commit to `main`. Commit trailer per the session reminder.

---

### Task 0: Config — redirect URI and Item cap

**Files:** `src/lib/config/env.server.ts` (+ test), `.env.example`, `playwright.config.ts` (unset `PLAID_REDIRECT_URI`), `docs/SECURITY_MODEL.md` (runbook stub)

- [x] `plaidConfig()` gains `redirectUri: string | null` (`PLAID_REDIRECT_URI`, must be an absolute `https:` URL, or `http://localhost…` only when `PLAID_ENV=sandbox`) and `maxItems: number` (`PLAID_MAX_ITEMS`, integer 1–20, default 5). Tests for both, including the localhost/sandbox rule.
- [x] `.env.example` documents both; note the Production value.

### Task 1: Migration `0016_derived_events` + RPC balance fix + RLS tests

**Files:** `supabase/migrations/0016_derived_events.sql`, `scripts/test-rls.mts`, `docs/DATA_MODEL.md`

- [x] `financial_events`: `source` (`demo`|`derived`, default `demo`), `transaction_id uuid references transactions on delete cascade`, `derivation_version text`; partial unique index `(user_id, transaction_id, type) where source='derived' and transaction_id is not null`; index `(user_id, source)`; ownership trigger `financial_events_check_transaction_ownership` (transaction_id must belong to user_id; same pattern as 0008).
- [x] `commit_connected_sync`: roster `create` op leaves balance null, then step (i) also `update financial_accounts a set current_balance = x.balance … where a.current_balance is null` for the anchored accounts (rebuild still recomputes via roll-forward). Re-apply via MCP `apply_migration` (recorded).
- [x] RLS script: B cannot insert a derived event referencing A's transaction; A cannot reference B's transaction (trigger); owner can insert/delete derived rows; demo rows unaffected.

### Task 2: Engine — `derived-events.ts`

**Files:** `src/lib/financial-engine/derived-events.ts`, `derived-events.test.ts`, `index.ts` export, `docs/DRIVER_EVENTS.md`

- [x] Types `EventAccountInput`, `EventTransactionInput`, `DerivedEvent`; `EVENT_DERIVATION_VERSION = "v1"`; `deriveEvents(input)` implementing the spec §2b rules in order, one event per transaction, demo/archived/excluded accounts skipped, monthly cap (3) for `large_purchase`/`unexpected_expense`, relative threshold `max(250, 2.5 × median non-recurring outflow over trailing 90 days ending at the transaction date)`, `debt_payoff` from an optional liability balance series (skip when absent).
- [x] Series-occurrence matching: a transaction is an occurrence of a series when `seriesKeyOf(accountId, direction, normalizeDescription(description))` matches a non-dismissed series (`recurring_overrides` status ≠ `dismissed`; confidence high/medium or confirmed).
- [x] Tests: table-driven per rule; overrides change the category and thus the event; demo exclusion; idempotence; cap; threshold examples ($80 median → $250 bar, $200 median → $500 bar); payoff; Koa reproduction (paycheck/mortgage/investment/debt dates+amounts match the generator's authored events; large purchases asserted loosely).
- [x] `docs/DRIVER_EVENTS.md`: the v1 rules in plain language + versioning policy (linked from the dashboard "How is this calculated?" later).

### Task 3: Data — rebuild integration + demo scoping

**Files:** `src/lib/data/rebuild-derived-events.ts` (new), `src/lib/data/rebuild-snapshots.ts` (calls it at the tail), `src/app/actions/demo.ts` (`clearDemoRows` scoped; loader rows `source='demo'`), `src/lib/data/mappers.ts` (`EventRow` provenance columns)

- [x] `rebuildDerivedEvents(supabase, userId, src)`: assembles engine inputs from the rows `rebuildSnapshots` already loaded (accounts + provider, transactions + `user_override`/`pfc_primary`/`pfc_detailed`, recurring overrides, anchors, `config.endDate` as the series reference date), detects series on source transactions (same keys as the Recurring page), applies category overrides, builds liability balance history from each liability's effective anchor (`liabilityBalanceHistory`), deletes `source='derived'` rows, `insertChunked`s the new set with `derivation_version`.
- [x] Called from the tail of `rebuildSnapshots` — so `finishWithRebuild`, `prepareDashboard`'s repair, `page.tsx`'s stale-index rebuild, and `syncPlaidItem`'s post-commit step all refresh events with one data load. A derivation failure surfaces as the rebuild warning and retries on the next rebuild (idempotent). *(Plan deviation: one call site instead of four, to avoid loading every transaction twice.)*
- [x] `clearDemoRows`: `.eq("source","demo")` on the events delete; `eventToRow` writes `source: "demo"` explicitly.

### Task 4: OAuth + Link lifecycle + card

**Files:** `src/lib/plaid/client.ts` (`redirect_uri`), `src/app/actions/plaid.ts` (cap check in `createLinkToken`/`createUpdateLinkToken`; `getConnectionLimits`), `src/app/accounts/usePfiPlaidLink.ts` (new hook + pure `linkSession` helpers with tests), `src/app/plaid/oauth/page.tsx` + `OauthReturn.tsx` (new), `src/app/accounts/ConnectedInstitutionsCard.tsx` (use the hook; "N of M connections"; Sandbox chip; result from `sessionStorage['pfi.plaid.result']`), `src/app/accounts/ConnectDisclosureSheet.tsx` (new), `src/lib/data/queries.ts` (`getConnectedItems` returns `maxItems`, `environment`)

- [ ] Link token: `redirect_uri` when configured; refuse with "You've reached the limit of N connected institutions" when active Items ≥ cap.
- [ ] Session helpers (pure): `saveLinkSession`, `readLinkSession` (30-minute expiry), `clearLinkSession`, `saveLinkResult`/`takeLinkResult`.
- [ ] `/plaid/oauth`: loading / expired / error states; `receivedRedirectUri: window.location.href`; on success runs exchange or update-sync, stores the result, `router.replace("/accounts")`.
- [ ] Disclosure sheet before the first Link open per device (`localStorage['pfi.plaid.disclosure.v1']`), "Continue to Plaid" → proceeds.
- [ ] Card: connections counter, Sandbox chip (from `environment`), result banner on return.

### Task 5: Legal text + version bump

**Files:** `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/lib/legal/versions.ts` (+ tests if any), `src/app/consent/page.tsx` copy check

- [ ] Privacy: new "Connected accounts (Plaid)" section (credentials → Plaid only; what PFI receives; retention; disconnect vs delete; Plaid End User Privacy Policy link); §5 lists Plaid as a processor. Terms: one sentence. Bump `PRIVACY_VERSION` (and `TERMS_VERSION` if terms text changed) → consent gate re-prompts.

### Task 6: Tests — live, e2e, QA script

**Files:** `src/lib/plaid/plaid-sync.live.test.ts`, `e2e/smoke.spec.ts`, `scripts/qa-plaid-link.ts`

- [ ] Live: after the sandbox sync, derived events exist (`source='derived'`, ≥1 `paycheck` or `investment_contribution` — assert on what the sandbox fixture deterministically yields), count unchanged after re-sync, `clearDemoData` leaves them, and the Item cap refuses link-token creation at the limit (set `PLAID_MAX_ITEMS=1` in-test via the config source or by creating rows).
- [ ] e2e: demo dashboard still shows drivers (source='demo'); consent gate appears once after the version bump (existing password-auth spec covers the gate; adjust fixture version if needed).
- [ ] QA script: OAuth bank path (`ins_127287`) through `/plaid/oauth`; disclosure sheet; drivers + markers on the dashboard; report investments.

### Task 7: Docs, reviews, verification, PR

- [ ] DATA_MODEL (events provenance + rebuild), SECURITY_MODEL (production runbook: env matrix, redirect URI, rollback; owner checklist), KNOWN_LIMITATIONS, ROADMAP, CURRENT_PHASE, DECISIONS #44 final notes; memory note `pfi-plaid-production-readiness`.
- [ ] Reviews: `code-reviewer`, `security-reviewer` (OAuth return, sessionStorage token, cap, consent), `database-reviewer` (0016, trigger, RPC change). Fix findings.
- [ ] `pnpm check`, `pnpm test:rls`, `pnpm test:live`, `pnpm test:e2e`, browser QA at 390 then 1280. Open PR; owner completes the Plaid dashboard checklist and links a real institution (acceptance criterion 5).
