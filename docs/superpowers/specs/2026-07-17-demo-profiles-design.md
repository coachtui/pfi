# Demo profiles + switcher — design

Date: 2026-07-17. Status: approved for planning.

## Purpose

Complete ROADMAP Phase 1's "Blue Reef Partners + North Shore Capital demo profiles" item and add a demo-profile switcher, so a reviewer can flip the product between three contrasting financial personas in one session and see nearly every score/index state the product supports — without touching their own data or identity.

## Decisions made during brainstorming

- **Contrast personas** (not an aspirational ladder, not similar-but-different): the two new profiles deliberately exercise the warning/edge states Koa Holdings cannot.
- **Switcher lives on `/accounts`** as a "Demo data" card, plus a three-way profile choice on the dashboard empty state. Onboarding UI unchanged (its checkbox seeds Koa).
- **Data-only switch**: switching replaces demo accounts/transactions/events only. The user's own company name, ticker, and cohort profile are never touched. Profile metadata appears only as labels in demo-data UI.
- **Generator structure — approach C**: keep per-profile hand-authored generators (Koa byte-identical, zero regression risk), extract only the proven-shared scaffolding, add a small registry. Rejected: one parameterized generator (rewrites the tuned Koa generator for no user-visible gain); full copy-paste siblings (duplicates scaffolding that is already clearly shared).

## Personas

Identities reuse the existing Rankings leaderboard entries in `src/lib/demo-data/cohorts.ts` for cross-screen coherence.

### Blue Reef Partners (`$BRFP`, username CoralTrader) — early-career, under strain

- 20–29 cohort, modest income band, high-cost region, objective `reduce_debt`.
- Irregular income: small part-time paycheck plus gig deposits of varying size/timing (the irregularity is the point — Stability metrics must score it honestly).
- Renter (no property/mortgage accounts), high-utilization credit card **with `credit_limit` set** so `revolving_utilization` is scorable (and bad), student loan with payments, near-zero investment contributions, thin savings.
- Target states the dataset must provably hit (test-asserted, see Testing): index **below waterline** on some days of history; overall score in a low band (Building or Needs attention); high revolving utilization; irregular-income Stability penalties; Growth scored low on near-zero contributions (valid data, not ineligible).

### North Shore Capital (`$NSHC`, username WaveRider) — pre-retirement, debt-free

- 50–59 cohort, high income band, objective `financial_independence` (from the existing `OBJECTIVES` list in `src/lib/config/cohorts.ts`).
- **Zero liability accounts and zero debt payments** → Debt Health = 100 via the debt-free rule.
- 12+ month emergency runway; steady monthly contributions; ~80% of custodial assets at a single institution → institution-concentration penalty.
- Target states (test-asserted): Debt Health 100 with "not applicable" metrics; high Liquidity; Concentration scored (eligible: ≥2 accounts, income present) and penalized; overall score in a high band (Strong or Excellent).

### Koa Holdings — unchanged

Same seed, same end date, byte-identical output. Its tests must pass unmodified.

## Architecture

### `src/lib/demo-data/shared.ts` (new, framework-free)

Extracted from `koa-holdings.ts`: `enumerateDays`, the `Day` interface, and the `DemoAccount` / `DemoTransaction` / `DemoDataset` types. `DemoDataset.profile` generalizes from `typeof koaProfile` to the registry's metadata shape (`DemoProfileMeta`) — nothing consumes the field today, so this is a safe widening. `koa-holdings.ts` imports from `shared.ts`; importers of the moved types (`src/lib/data/mappers.ts`, `src/app/actions/demo.ts`) update their import paths.

### `src/lib/demo-data/blue-reef.ts`, `src/lib/demo-data/north-shore.ts` (new, framework-free)

Hand-authored generators following the `koa-holdings.ts` pattern: fixed seed, fixed end date `2026-07-15`, ~430 days of history so 30D/90D/1Y ranges all render. Each exports a `<name>Profile` metadata const and a `generate<Name>(): DemoDataset` function.

### `src/lib/demo-data/profiles.ts` (new, framework-free)

```ts
export type DemoProfileId = "koa-holdings" | "blue-reef" | "north-shore";
export interface DemoProfileMeta {
  id: DemoProfileId;
  companyName: string;
  ticker: string;        // "$KOAH" | "$BRFP" | "$NSHC"
  username: string;
  description: string;   // one-line persona summary shown in demo-data UI
  signatureAccountName: string; // a displayName unique to this profile's accounts
}
export const DEMO_PROFILES: Record<DemoProfileId, { meta: DemoProfileMeta; generate: () => DemoDataset }>;
export const DEFAULT_PROFILE_ID: DemoProfileId = "koa-holdings";
export function isDemoProfileId(v: unknown): v is DemoProfileId;
export function detectActiveProfile(demoAccountNames: string[]): DemoProfileId | null;
```

Active-profile detection matches seeded demo-account display names against each profile's `signatureAccountName` — no schema change. This is a heuristic keyed to names the app itself seeds; recorded in KNOWN_LIMITATIONS.

### Server actions (`src/app/actions/demo.ts`)

- `loadDemoData(profileId?: unknown): Promise<{ error: string }>` — validates `profileId` with `isDemoProfileId` (defaults to `DEFAULT_PROFILE_ID`), then runs the existing idempotent clear-demo-rows → seed → `rebuildSnapshots` pipeline with the selected generator. Converts from throw-on-error to the codebase's standard `{ error }` / `""` contract.
- `clearDemoData(): Promise<{ error: string }>` — same contract conversion.
- `src/app/actions/onboarding.ts` updates to check the returned error instead of relying on a throw.
- Switching is just `loadDemoData(newId)` — the existing provider-scoped clear means manual/imported data survives, and `rebuildSnapshots` folds every active account back into the index.

### Data layer

`getAccountsData` (or a small addition to it) surfaces `activeDemoProfileId: DemoProfileId | null`, derived via `detectActiveProfile` from the demo-provider accounts it already fetches.

## UI

### `/accounts` — "Demo data" card (new component, e.g. `src/app/accounts/DemoDataCard.tsx`)

- Shows the active profile (company name, ticker, one-line description) or a "No demo data loaded" empty state.
- Lists all three profiles with a Load/Switch action per row; the active one is marked (text + glyph, never color alone). Switching is single-tap — demo rows are regenerable; nothing user-created is at risk.
- "Clear demo data" button with the app's standard two-step in-app confirm (no native dialogs).
- Pending state while an action runs; `{ error }` surfaced inline per existing action-UI patterns.

### Dashboard empty state (`src/components/dashboard/EmptyDashboard.tsx`)

The single "load demo data" form becomes three labeled profile choices (each `action={loadDemoData.bind(null, id)}` or equivalent form wiring), each with its one-line description.

### Out of scope

Onboarding UI (checkbox continues to seed the default profile); Rankings/Data cohort screens (the leaderboard entries already exist and are untouched); any identity/cohort mutation; any schema change.

## Error handling

Both actions return `{ error }`; UI surfaces failures inline with retry (the pipeline is idempotent — a failed seed can be retried safely because the next attempt re-clears demo rows first). A failed `rebuildSnapshots` after clear/seed surfaces its error string, consistent with existing behavior.

## Testing

- **Generator tests** (`blue-reef.test.ts`, `north-shore.test.ts`, mirroring `koa-holdings.test.ts`): determinism (two runs produce identical datasets), config window matches the enumerated days, accounts/transactions internally consistent (transfer pairs, liability signs).
- **Persona-invariant tests through the real pipeline** (generate → `buildDailySnapshots` → indexing/score engine):
  - Blue Reef: at least one day's available position is below the waterline; overall score lands in Building or Needs attention; `revolving_utilization` available and poor; Growth scored (not ineligible) and low.
  - North Shore: Debt Health = 100 via debt-free rule; Concentration eligible and penalized (institution share ≥ its curve's penalty region); liquidity runway ≥ 12 months; overall score in Strong or Excellent.
- **Registry test**: all ids resolve, metadata complete, `signatureAccountName`s mutually unique AND each actually appears in its own generator's account output (guards drift).
- **Koa regression**: existing `koa-holdings.test.ts` passes unmodified.
- **Action validation**: invalid/unknown `profileId` is rejected (unit test at the registry/validation level).
- `pnpm check` green; `pnpm test:rls` re-run (no schema change — expected unchanged 19/19).
- **Live browser QA** at 390×844 and 1280×900: switch across all three profiles from `/accounts` and the empty state; verify dashboard chart/score/report render each persona's states honestly (Blue Reef shows below-waterline and low band without shame language; North Shore shows debt-free "not applicable" metrics and concentration explanation); clear demo data via two-step confirm; confirm a manual account survives a profile switch; console clean.

## Docs

- `docs/DECISIONS.md` #17: profile registry + data-only switcher (alternatives: parameterized generator, full persona switch, onboarding-only choice; reasoning per brainstorm).
- `docs/ROADMAP.md`: check off Phase 1's demo-profiles item at completion.
- `docs/KNOWN_LIMITATIONS.md`: signature-account-name detection heuristic; note that demo-data UI copy must never imply the profiles are real households.
- `docs/CURRENT_PHASE.md`: updated at slice end.
