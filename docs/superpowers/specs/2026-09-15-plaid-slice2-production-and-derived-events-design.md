# Plaid Slice 2 — Production cut-over & derived driver events — Design

_Date: 2026-09-15. Status: **draft for owner review** (round 1). Follows Slice 1 (DECISIONS #43, merged 2026-09-15 as PR #34)._

## Problem

Slice 1 proved the pipeline against Plaid Sandbox. Two things stand between it and the owner's real accounts:

1. **Production is not reachable.** Real institutions need Plaid Production keys, and most large banks (Chase, Bank of America, Capital One, Wells Fargo) use OAuth, which requires an HTTPS redirect URI registered with Plaid and a page that can resume Link after the browser returns from the bank. PFI has no redirect handling, and its privacy policy still says no third party receives user data. That statement becomes false the moment a bank is linked.
2. **Real data has no drivers.** `financial_events` is written only by the demo loader, so with synced accounts the dashboard's "What moved your line" is empty, the chart has no markers, and the report's investment contributions are zero. The Slice 1 spec deferred this deliberately; it is the single most visible gap on a real household's dashboard.

Both halves are needed before the owner links a real bank and looks at the result.

## Core insight

- **Production is a configuration and consent change, not a code path change.** The sync pipeline is environment-agnostic; what changes is the key material, one redirect page, one link-token field, and the legal text that discloses the data flow.
- **Driver events are a derivation, like snapshots.** `daily_snapshots` are rebuilt deterministically from source rows on every mutation (DECISIONS #8). Derived events should be the same kind of thing: a versioned pure function over effective transactions, accounts, and recurring series, rebuilt in the same step, never hand-edited, never conflated with the demo loader's authored events. The demo generators' own conventions (paychecks from payroll series, contributions from transfers into investment accounts, debt payments from transfers into liabilities, hand-picked unusual purchases) are the rules to reproduce.

## Decisions taken in brainstorming (proposed; confirm or amend)

- **OAuth return page, not a rebuilt card.** A dedicated `/plaid/oauth` page re-initializes Link with the same token and `receivedRedirectUri`; the card persists the in-flight token in `sessionStorage` before opening Link. Sandbox's Platypus OAuth Bank (`ins_127287`) tests the whole path before Production approval.
- **Consent via policy version bump plus a just-in-time disclosure, not a third legal document.** The privacy policy gains a "Connected accounts (Plaid)" section and `PRIVACY_VERSION` bumps, so the existing consent gate re-prompts every user. The Connect button additionally shows a one-time disclosure sheet before Link opens. Adding a `bank_data` document to `user_agreements` was the alternative; it needs a migration, a cookie-format change, and consent-UI generalization for the same legal effect.
- **A per-user cap on active Items** (`PLAID_MAX_ITEMS`, default 5) bounds Plaid's per-Item billing. Cheap, visible, removable.
- **Derived events are stored, sourced, and rebuilt**, not computed at read time: consumers already read the table, the demo loader's authored events must coexist, and a stored row can carry provenance (`transaction_id`, `derivation_version`). Rebuild happens in the same `finishWithRebuild` / dashboard-repair path as snapshots, so a rebuild failure is already visible and self-healing.
- **Rules are deterministic v1, versioned, and conservative.** A missing event is a quiet dashboard; a wrong event is a false explanation. Thresholds are relative to the household's own history where possible and fixed floors otherwise. No AI.
- **Demo data stays untouched.** Derived events are never generated for `provider = 'demo'` accounts (the loader's authored events are the drivers there), and `clearDemoData` deletes only `source = 'demo'` rows.
- **Small carry-overs folded in:** the commit RPC sets `current_balance` from the sync anchor in the same transaction (closes the "—" window), and `debt_payoff` detection is included since balance history makes it cheap.
- **Out of Slice 2:** webhooks/cron (Slice 3), investments holdings, manual "mark as transfer", real-time balances, merging re-linked institutions, pending transactions.

## Architecture

### 1. Production cut-over

#### 1a. OAuth redirect

- **Env:** `PLAID_REDIRECT_URI` (server-only, via `plaidConfig()`, optional). Production: `https://pfi-one.vercel.app/plaid/oauth`. Local sandbox: `http://localhost:3000/plaid/oauth` (Plaid permits http for localhost in Sandbox only). When set, `createLinkToken` passes `redirect_uri` on both fresh and update-mode tokens. When unset, Link still works for non-OAuth institutions.
- **Persisting the session:** before `open()`, the card writes `{ linkToken, mode: 'connect' | 'update', itemId? , createdAt }` to `sessionStorage['pfi.plaid.link']`. Cleared on success/exit. Entries older than 30 minutes are ignored (link tokens expire in 4 hours; 30 minutes bounds a stale resume).
- **`/plaid/oauth` page** (client component, behind the proxy's auth gate like every other page): reads the stored session; if absent, shows "This bank sign-in has expired — start again from Accounts" with a link. Otherwise `usePlaidLink({ token, receivedRedirectUri: window.location.href, onSuccess, onExit })` and opens immediately. `onSuccess` runs the same `exchangePublicToken` / `syncItem` path the card uses, then `router.replace('/accounts')` with the result summary passed via `sessionStorage['pfi.plaid.result']` so the card can show it. `onExit` returns to `/accounts` with the Link error surfaced.
- **Card refactor:** the Link lifecycle (`startLink`, `usePlaidLink`, persistence, result handling) moves into a small hook `usePfiPlaidLink()` in `src/app/accounts/usePfiPlaidLink.ts`, used by both the card and the OAuth page, so the two never drift.
- **PWA note:** the installed web app returns to the same standalone window after the bank's OAuth page; the redirect page is what makes that resume work. iOS may open the bank in an in-app browser sheet; Plaid's recommendation (re-initialize at the redirect URI) is exactly this design.

#### 1b. Consent and disclosure

- **Privacy policy** (`src/app/privacy/page.tsx`): new section "Connected accounts (Plaid)" stating what happens when a bank is linked (credentials go to Plaid, never to PFI; PFI receives account names, masked numbers, balances, and transactions; how long they are kept; that disconnecting stops collection and "disconnect and delete" removes the data; a link to Plaid's End User Privacy Policy). §5 "Sharing" lists Plaid as a processor. `PRIVACY_VERSION` bumps (date-based, matching the existing scheme), which re-triggers the `/consent` gate for every existing user through the unchanged `user_agreements` machinery. Terms get one sentence that connected-account data is subject to the privacy policy.
- **Just-in-time disclosure:** the first "Connect a bank" tap on a device opens a short sheet ("How connecting works": three bullets, the same facts as the policy section, a link to the policy) with a single "Continue to Plaid" button; a `localStorage['pfi.plaid.disclosure.v1']` flag suppresses it afterwards. It is a notice, not a recorded consent; the recorded consent is the policy version.
- **Plaid's own consent pane** already runs inside Link.

#### 1c. Environment switch and guardrails

- `PLAID_ENV=production` plus the Production secret in Vercel Production; Sandbox keys stay in Preview/Development and `.env.local`. `PLAID_REDIRECT_URI` set per environment. Documented as a runbook in SECURITY_MODEL.md ("Plaid production runbook") including rollback (flip `PLAID_ENV` back; sandbox and production Items never mix because Items are per-environment).
- **Item cap:** `PLAID_MAX_ITEMS` (default 5). `createLinkToken` refuses with a clear message when the user already has that many non-disconnected Items. Shown on the card as "N of 5 connections".
- **Environment badge:** while `PLAID_ENV=sandbox`, the card shows a small "Sandbox" chip so a sandbox connection on the production site is never mistaken for a real bank.
- **Owner tasks (outside the codebase):** complete the Plaid dashboard company/application profile (legal name, product name, website `https://pfi-one.vercel.app`, support email, privacy policy URL `https://pfi-one.vercel.app/privacy`, use-case description: personal financial dashboard for the account holder); request Production access for Transactions; register the redirect URI under "Allowed redirect URIs"; confirm pay-as-you-go billing and the per-Item Transactions price; add the four Production env vars to Vercel. These are listed in the plan as a checklist with a `pfi-plaid-production-readiness` memory note.

### 2. Derived driver events

#### 2a. Data model — migration `0016_derived_events`

```sql
alter table public.financial_events
  add column source text not null default 'demo' check (source in ('demo', 'derived')),
  add column transaction_id uuid references public.transactions (id) on delete cascade,
  add column derivation_version text;
-- Existing rows are the demo loader's: source stays 'demo'.
-- One derived event per (transaction, type): re-derivation is idempotent.
create unique index financial_events_derived_txn_idx
  on public.financial_events (user_id, transaction_id, type)
  where source = 'derived' and transaction_id is not null;
create index financial_events_user_source_idx on public.financial_events (user_id, source);
```

- `clearDemoRows` deletes `financial_events where source = 'demo'` only.
- Derived rows are replaced wholesale per rebuild (`delete where user_id = ... and source = 'derived'`, then insert), mirroring `daily_snapshots`.
- The commit RPC's roster `create` op sets `current_balance` from the matching anchor in the same transaction (carry-over fix); done as `create or replace function commit_connected_sync` in this migration.

#### 2b. Engine — `src/lib/financial-engine/derived-events.ts` (pure, tested)

```ts
export const EVENT_DERIVATION_VERSION = "v1";
export function deriveEvents(input: {
  accounts: EventAccountInput[];        // id, type, provider, includeInCalculations, archived
  transactions: EventTransactionInput[]; // effective (override-applied): id, accountId, postedDate, amount, direction,
                                         // category, isTransfer, transferPairId, description, pfcPrimary, pfcDetailed
  series: RecurringSeries[];             // from detectRecurringSeries + overrides (dismissed series excluded)
  balancesByDay?: ...                    // optional: liability balance series for debt_payoff
  asOfDate: ISODate;
}): DerivedEvent[]                       // { transactionId, date, type, label, amount, direction }
```

Rules, applied in this order, one event per transaction at most, only for accounts with `provider !== 'demo'` and `includeInCalculations` and not archived:

| Type | Rule (v1) |
|---|---|
| `paycheck` | Inflow that is an occurrence of a recurring series with `isIncome` (confirmed, or high/medium confidence and not dismissed), **or** a Plaid row whose `pfc_detailed` is `INCOME_SALARY`/`INCOME_WAGES`. Label: series display name, title-cased. |
| `bonus` | Inflow with `category = income` that is **not** a series occurrence, amount ≥ max($500, 1.5 × the median typical amount of the household's income series). No income series → no bonus events. |
| `mortgage_payment` | Outflow with `pfc_detailed = LOAN_PAYMENTS_MORTGAGE_PAYMENT`, **or** the outflow side of a transfer pair whose counterpart account is `mortgage`. |
| `insurance_payment` | Outflow with `category = insurance` that is an occurrence of a recurring series (≥3 occurrences). |
| `investment_contribution` | Outflow side of a transfer pair whose counterpart account is `brokerage`/`retirement`, **or** an unpaired outflow with `pfc_detailed = TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS` (destination not linked). Counted once (outflow side only). |
| `debt_payment` | Outflow side of a transfer pair whose counterpart account is a liability other than `mortgage`, **or** an unpaired outflow with `pfc_primary = LOAN_PAYMENTS` (not the mortgage detail). |
| `debt_payoff` | A `debt_payment` after which the counterpart liability's balance is ≤ 0 for the rest of the history (needs the liability's balance series; skipped when unavailable). |
| `tax_payment` | Outflow with `pfc_detailed = GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT`. |
| `large_purchase` | Non-transfer outflow, not a series occurrence, `category ∈ {shopping, discretionary, transport, other}`, amount ≥ max($250, 2.5 × median non-recurring outflow over the trailing 90 days ending at the transaction date). |
| `unexpected_expense` | Same size rule, `category ∈ {health, housing}` or `pfc_detailed ∈ {HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE, GENERAL_SERVICES_AUTOMOTIVE, MEDICAL_*}`. |

- **Overrides win:** rules read the override-applied `category` (via `applyOverride`), so a user's recategorization changes or removes an event on the next rebuild.
- **Amounts** are the transaction's amount; `direction` follows the transaction. Labels come from the transaction description (merchant) and never cross the AI boundary (the narration input already maps events to `kind` only).
- **Bounded noise:** `large_purchase`/`unexpected_expense` are capped at 3 per calendar month (largest kept). Drivers already take the top 4 by impact per range.
- Tests: table-driven per rule, override interaction, demo exclusion, idempotence (same input → identical output), the monthly cap, thresholds relative to history, and a whole-pipeline check that running the derivation over the Koa Holdings demo dataset (treated as non-demo) reproduces the generator's paycheck/mortgage/investment/debt events by date and amount (the generator's `large_purchase` picks are random, so those are asserted loosely).

#### 2c. Rebuild integration

- `rebuildSnapshots` gains a sibling `rebuildDerivedEvents(supabase)` in `src/lib/data/`, called by `finishWithRebuild`, the dashboard repair path, and `syncPlaidItem`'s post-commit step, after snapshots. It loads effective transactions (with PFC columns), accounts, recurring series + overrides (reusing `getRecurringData`'s computation), and daily snapshots for the payoff rule; deletes derived rows; inserts in chunks. Failure degrades the same way snapshots do (warning; repaired on next load).
- `rebuild-snapshots.ts` and the score/report selects add `pfc_primary`/`pfc_detailed` to the transaction reads that feed derivation. Snapshot math itself is unchanged.
- `getDashboardData`/`getReportData` keep reading `financial_events` as today; they now see demo **or** derived rows depending on what the household has. AI narration input is unchanged (it already consumes `computeDrivers` output).

### 3. UI

- Card: "N of 5 connections" line; "Sandbox" chip when applicable; the first-tap disclosure sheet; OAuth-return result summary.
- `/plaid/oauth`: loading state ("Finishing your bank sign-in…"), expired-session state, error state with a link back. Mobile-first; glyph + text.
- Dashboard: no visual change; drivers, markers, and stems simply populate for real data. Report: investment contributions populate.
- Privacy/terms pages: new sections; consent page copy unchanged (it references the version constants).

### 4. Security

- `PLAID_REDIRECT_URI` is server-only and passed to Plaid; the redirect page never reads Plaid state from the URL itself beyond handing `window.location.href` to Link. The link token in `sessionStorage` is short-lived, tab-scoped, and useless without the same origin and user session; it is cleared on completion.
- Item cap enforced server-side in `createLinkToken`, not only in the UI.
- Derived events carry no new data classes (they reference the user's own transactions) and remain under the existing owner-only RLS. Nothing in derivation touches provider-owned columns.
- Production keys never enter `.env.local` on a dev machine; Sandbox everywhere except Vercel Production. Rotation and disconnect behavior unchanged from Slice 1.

### 5. Testing & verification

- Unit: `derived-events.test.ts` (rules, cap, thresholds, override interaction, demo exclusion, Koa reproduction), `plaidConfig` (`PLAID_REDIRECT_URI`, `PLAID_MAX_ITEMS`), `usePfiPlaidLink` session persistence helpers (pure functions extracted).
- Live (`pnpm test:live`): after the sandbox sync in `plaid-sync.live.test.ts`, assert derived events exist with `source = 'derived'`, at least one `paycheck` (sandbox has recurring "INTRST PYMNT"/"Uber" series — assert on whatever series the fixture data yields deterministically), that re-sync leaves the count unchanged, and that `clearDemoData` does not remove them; the Item cap refuses the sixth link.
- RLS: `financial_events` policies unchanged; add a check that a derived row's `transaction_id` must belong to the same user (ownership trigger, same pattern as `balance_anchors`).
- e2e: unchanged (demo journey); one new smoke assertion that the demo dashboard's drivers still render after the migration (demo rows kept `source = 'demo'`).
- Browser QA (`scripts/qa-plaid-link.ts` extended): the OAuth sandbox bank (`ins_127287`) completes through `/plaid/oauth` at 390 then 1280; the disclosure sheet shows once; the dashboard shows drivers and chart markers from synced data; report shows investment contributions.
- Production QA (owner, on the phone): link one real institution, confirm the card, dashboard drivers, and disconnect; confirm the Plaid dashboard shows one active Item.

### 6. Documentation

DECISIONS #44 (this design); DATA_MODEL.md (`financial_events` source/provenance, the derived-events rebuild); SECURITY_MODEL.md (production runbook, OAuth, consent); FINANCIAL_INDEX_METHODOLOGY.md or a new `docs/DRIVER_EVENTS.md` (the v1 rules, versioning policy: rule changes bump `EVENT_DERIVATION_VERSION` and re-derive); KNOWN_LIMITATIONS (payoff rule needs balance history; unlinked-destination contributions rely on Plaid's category; sandbox-only OAuth test); ROADMAP Phase 7; CURRENT_PHASE.

## Acceptance criteria (to freeze after review)

1. **OAuth round-trip.** Linking Platypus OAuth Bank in Sandbox completes through `/plaid/oauth`, the Item reaches `connected`, and a stale/expired session shows the recovery message instead of an error.
2. **Consent gate.** After deploy, an existing user is routed to `/consent` once and the privacy policy names Plaid and the disconnect/delete rights; the disclosure sheet shows before the first Link open.
3. **Derived events.** With only synced accounts, "What moved your line" and the chart markers show events; the report's investment contributions are non-zero when a transfer into an investment account exists; re-sync and rebuild never duplicate events; demo load/clear never touch derived rows and vice versa.
4. **Guardrails.** The sixth connection is refused server-side; the Sandbox chip shows while `PLAID_ENV=sandbox`.
5. **Real institution (owner).** One real bank linked in Production from the phone, drivers visible, disconnect works, exactly one active Item in the Plaid dashboard.

## Explicitly deferred

- Webhooks and daily cron (Slice 3, after the user-scoped rebuild refactor).
- Investments holdings and market appreciation; real-time balances.
- Manual "mark as transfer" and "not a driver" overrides on events.
- Merging a re-linked institution's history.
- Pending transactions; Liabilities details.
