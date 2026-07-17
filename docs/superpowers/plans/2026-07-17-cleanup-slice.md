# Post-CSV-Merge Cleanup Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the four debt items surfaced by the CSV-import merge: drop the vestigial `daily_snapshots.data_coverage_confidence` column, make MapStep's CTA always tappable above the fixed BottomNav, and correct/retire stale entries in KNOWN_LIMITATIONS, ROADMAP, and DECISIONS.

**Architecture:** One tiny Postgres migration (0005) paired with its mapper change in a single commit; one CSS/JSX layout change in `MapStep.tsx` (sticky action row); the rest is documentation accuracy. Spec: `docs/superpowers/specs/2026-07-17-cleanup-slice-design.md`.

**Tech Stack:** Next.js 16 / strict TS / Tailwind 4 / Vitest / Supabase CLI (linked project). pnpm.

## Global Constraints

- `pnpm check` (lint + typecheck + test + build) must be green before completion claims (CLAUDE.md).
- UI changes verified live in a browser at ~390px and desktop widths (CLAUDE.md).
- Migration + code change land in **one commit** so no checkout is half-migrated against its own schema expectations (spec, Error handling).
- `PreviewStep`/`SummaryStep` get the sticky treatment **only if** live QA at 390×844 demonstrates they can occlude — no generalization without evidence (spec §2).
- Baseline before this slice: 221 tests / 28 files; `pnpm test:rls` 19/19; lint 0 errors + 1 pre-existing `AccountSheet.tsx` warning.

---

### Task 1: Migration 0005 + mapper change (one commit)

**Files:**
- Create: `supabase/migrations/0005_drop_coverage_confidence.sql`
- Modify: `src/lib/data/mappers.ts:12-25` (`SnapshotRow`, `snapshotToRow`)
- Test: `src/lib/data/mappers.test.ts` (existing "snapshot round-trips" test, ~line 27)

**Interfaces:**
- Consumes: `DailySnapshot` from `@/lib/financial-engine/types` (unchanged).
- Produces: `SnapshotRow` **without** `data_coverage_confidence`; `snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow`. Callers (`src/app/actions/demo.ts:45`, `src/lib/data/rebuild-snapshots.ts:62`) only spread rows into inserts — no call-site change needed. `rowToSnapshot` never read the field — unchanged.

- [ ] **Step 1: Write the failing test assertion**

In `src/lib/data/mappers.test.ts`, extend the existing round-trip test (~line 27):

```ts
  it("snapshot round-trips through its row shape", () => {
    const row = snapshotToRow("user-1", snapshot);
    expect(row.user_id).toBe("user-1");
    expect(row.engine_version).toBe(ENGINE_VERSION);
    expect("data_coverage_confidence" in row).toBe(false);
    expect(rowToSnapshot(row)).toEqual(snapshot);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — `expected true to be false` on the new assertion.

- [ ] **Step 3: Remove the field from the mapper**

In `src/lib/data/mappers.ts`, change `SnapshotRow` and `snapshotToRow` to:

```ts
export interface SnapshotRow {
  user_id: string; date: string; liquid_assets: number; revolving_balances: number;
  near_term_obligations: number; essential_obligations: number; safety_buffer: number;
  net_worth: number; engine_version: string;
}

export function snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow {
  return {
    user_id: userId, date: s.date, liquid_assets: s.liquidAssets,
    revolving_balances: s.revolvingBalances, near_term_obligations: s.nearTermObligations,
    essential_obligations: s.essentialObligations, safety_buffer: s.safetyBuffer,
    net_worth: s.netWorth, engine_version: ENGINE_VERSION,
  };
}
```

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm vitest run src/lib/data/mappers.test.ts && pnpm typecheck`
Expected: PASS (typecheck confirms no other code referenced the field).

- [ ] **Step 5: Create the migration**

Create `supabase/migrations/0005_drop_coverage_confidence.sql`:

```sql
-- data_coverage_confidence was write-only: stamped 'demo' unconditionally by
-- snapshotToRow, never read. Score confidence is computed at read time from
-- account providers (DECISIONS #14, metric-inputs.ts). DECISIONS #16.
alter table public.daily_snapshots drop column data_coverage_confidence;
```

- [ ] **Step 6: Apply to the live project and re-verify RLS**

Run: `supabase db push`
Expected: `0005_drop_coverage_confidence.sql` applied, no errors.

Run: `pnpm test:rls`
Expected: 19/19 passing (migration touches an RLS-covered table; confirms policies intact and inserts still succeed without the column).

- [ ] **Step 7: Full suite, then commit migration + code together**

Run: `pnpm test`
Expected: 221/221 (28 files) — count unchanged; the assertion was added to an existing test.

```bash
git add supabase/migrations/0005_drop_coverage_confidence.sql src/lib/data/mappers.ts src/lib/data/mappers.test.ts
git commit -m "refactor(schema): drop write-only daily_snapshots.data_coverage_confidence (migration 0005)"
```

---

### Task 2: Sticky action row in MapStep

**Files:**
- Modify: `src/app/import/MapStep.tsx:157-164` (the action-row/helper-text block at the end of the returned `<section>`)

**Interfaces:**
- Consumes: nothing new. Props and behavior of `MapStep` unchanged.
- Produces: no API change — layout only. `BottomNav` is `fixed bottom-0 z-20`, ~61px tall; `bottom-20` (5rem/80px) clears it with a gap. Row background must be opaque so content scrolling beneath doesn't ghost through.

- [ ] **Step 1: Reorder helper text above the row and make the row sticky**

Replace lines 157–164 of `src/app/import/MapStep.tsx`:

```tsx
      {!ready && <p className="text-xs text-secondary">Choose a date, description, and amount column (or a debit/credit pair) to continue.</p>}
      <div className="sticky bottom-20 z-10 flex gap-2 bg-base pt-2 pb-1">
        <button type="button" onClick={onBack} className="text-sm text-secondary hover:text-primary">Back</button>
        <button type="button" disabled={!ready} onClick={() => onConfirm(m)}
          className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
          Preview import
        </button>
      </div>
```

(Changes: helper `<p>` moved above the row; row gains `sticky bottom-20 z-10 bg-base pb-1`; buttons untouched.)

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 errors; the 1 pre-existing `AccountSheet.tsx` warning only.

- [ ] **Step 3: Commit**

```bash
git add src/app/import/MapStep.tsx
git commit -m "fix(import): pin MapStep action row above BottomNav so the CTA is tappable at first paint"
```

(Live visual verification happens in Task 4 — it needs the dev server + auth bootstrap; keep this commit code-only.)

---

### Task 3: Doc corrections

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md` (Product section lines 7–9; Manual data section line 58; Infrastructure section line 67; CSV import v1 section line 50)
- Modify: `docs/ROADMAP.md:12`
- Modify: `docs/DECISIONS.md` (append #16)

**Interfaces:** none — documentation only. Line numbers below are pre-Task-3 positions; verify with grep before editing since earlier tasks don't touch these files.

- [ ] **Step 1: KNOWN_LIMITATIONS — Product section**

Replace the line-7 entry ("**Demo data is the only data source.** …") with:

```markdown
- **Demo data is the default dataset, no longer the only source (updated 2026-07-17).** Manual accounts/transactions CRUD and CSV import are live (ROADMAP Phase 3); Koa Holdings' seeded dataset (fixed "today" of 2026-07-15, loaded via `loadDemoData()`) remains the default onboarding data, and cohort/rankings surfaces still run on samples (see Visual parity slice below).
```

Delete the line-9 entry entirely ("**Financial-health score not yet implemented** (spec in FINANCIAL_HEALTH_SCORE.md).") — resolved by Phase 2.

Keep the line-8 performance-brief entry unchanged (still true until Phase 4).

- [ ] **Step 2: KNOWN_LIMITATIONS — remove two resolved entries**

Delete the Manual data section entry at ~line 58:

> **`snapshotToRow` still stamps `data_coverage_confidence: "demo"`** even for rebuilt mixed/manual data — confidence modeling is Phase 2.

Delete the entire CSV import v1 entry at ~line 50 (the long "**Primary CTA can render partially behind the fixed `BottomNav`…**" paragraph) — resolved by Task 2. Do not delete any other CSV import v1 entries.

- [ ] **Step 3: KNOWN_LIMITATIONS — reword the `clearDemoData` entry**

Replace the Infrastructure entry at ~line 67 ("**`clearDemoData` clears all `financial_events`/`daily_snapshots`…**") with:

```markdown
- **`clearDemoData`/demo reseed deletes all `financial_events` for the user — latent, not live (re-scoped 2026-07-17).** Accounts (and their transactions, via cascade) are already provider-scoped to `demo`, and `daily_snapshots` are derived data rebuilt immediately after by `rebuildSnapshots`, so manual/imported data survives today. But `financial_events` has no source column and is deleted wholesale; only the demo seed writes events today, so nothing non-demo can be lost yet. This becomes a real bug the moment a second event source exists — add a `source` column and scope the delete then.
```

- [ ] **Step 4: ROADMAP — fix the stale onboarding checkbox**

In `docs/ROADMAP.md` line 12, change:

```markdown
- ⬜ Onboarding flow (identity, cohorts, privacy, sample data)
```

to:

```markdown
- ✅ Onboarding flow (identity, cohorts, privacy, sample data) — landed with Phase 1.5
```

- [ ] **Step 5: DECISIONS — append #16**

Append to `docs/DECISIONS.md`:

```markdown
## 16. 2026-07-17 — Drop the write-only `daily_snapshots.data_coverage_confidence` column

**Decision:** migration `0005_drop_coverage_confidence` removes the column; `snapshotToRow` stops stamping it.

**Alternatives:** stamp it meaningfully per rebuild (derive demo/manual/mixed from the providers of accounts feeding that rebuild); keep it and doc-note it as vestigial until Phase 7.

**Reasoning:** the column was write-only — stamped `"demo"` unconditionally, never read. Score confidence is computed at read time from account providers (#14, `metric-inputs.ts`), which made the persisted field obsolete; after the manual-CRUD and CSV-import slices it actively misstated provenance for rebuilt manual/mixed snapshots. A field that lies is worse than no field, and speculative stamping logic nothing consumes fails YAGNI.

**Consequences:** schema stays honest. If persisted coverage confidence returns with real provider sync (Phase 7), it gets a fresh design with real inputs (sync freshness, connection health) rather than inheriting a placeholder.
```

- [ ] **Step 6: Commit**

```bash
git add docs/KNOWN_LIMITATIONS.md docs/ROADMAP.md docs/DECISIONS.md
git commit -m "docs(cleanup): retire resolved limitations, re-scope clearDemoData entry, record DECISIONS #16"
```

---

### Task 4: Verification + phase doc

**Files:**
- Modify: `docs/CURRENT_PHASE.md` (new completed section for this slice; test-status refresh)

**Interfaces:** none — verification and docs.

- [ ] **Step 1: Full check**

Run: `pnpm check`
Expected: lint 0 errors + 1 pre-existing `AccountSheet.tsx` warning; typecheck clean; 221/221 tests (28 files); build succeeds, all 12 routes compile.

- [ ] **Step 2: Live browser QA (gstack `browse`)**

Start `pnpm dev` (check whether a dev server already runs on :3000 first). Bootstrap auth using the documented workaround (GoTrue `verifyOtp` token exchange + hand-written `sb-<ref>-auth-token` cookie — see `.superpowers/sdd/csv-import-qa-report.md`; `scripts/dev-login.ts`'s magic link alone will not establish a session).

At **390×844**:
1. Navigate to `/import`, select an account, upload a CSV with enough columns to reproduce the QA report's MapStep content height (the report's happy-path fixture works).
2. On Map Columns at `scrollY = 0`, assert via bounding boxes: `button.bottom < nav.top` for the "Preview import" button — fully visible and tappable at first paint.
3. Scroll to bottom: opaque row background — no content ghosting beneath the buttons; helper text (when visible) sits above the row, never covered.
4. Spot-check PreviewStep and SummaryStep bounding boxes the same way. Only if a CTA's box intersects the nav's box at rest does the sticky pattern get applied there too (then re-run this QA step for that step's CTA).
5. Confirm console has zero errors/warnings on `/import` throughout.

At **1280×900**: Map Columns renders normally (sticky row stays in flow when content is short); console clean.

- [ ] **Step 3: Update CURRENT_PHASE.md**

Add a completed section for this slice (migration 0005 + mapper change, MapStep sticky action row with live-QA result, doc corrections, DECISIONS #16), set "In progress" to nothing, and refresh the test-status paragraph (221/221; RLS 19/19 re-verified post-migration; `pnpm check` green).

- [ ] **Step 4: Commit**

```bash
git add docs/CURRENT_PHASE.md
git commit -m "docs(cleanup): record cleanup-slice completion in CURRENT_PHASE"
```
