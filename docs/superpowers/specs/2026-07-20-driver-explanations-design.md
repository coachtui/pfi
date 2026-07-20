# "What moved my line?" — Per-Driver AI Explanations (Phase 4, slice 2)

**Date:** 2026-07-20
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Depends on:** AI interpreter core slice (DECISIONS #26, PR #12) — reuses its entire narration pipeline.

## Goal

Each driver card in the dashboard's "What moved your line" section gains a short AI-written explanation (a sentence or two: what this event was, how it moved the line, equity-vs-spend framing), revealed by expanding the card in place. This is depth per event — deliberately distinct from the Performance brief, which keeps its existing summary-level driver narration.

With no AI key (or on any generation failure), the same expand affordance shows a deterministic, code-built explanation — the app remains structurally identical keyless, per the slice-1 precedent.

## Decisions made during brainstorming

1. **Slice shape: per-driver explanations**, not another section-level summary (the brief already summarizes drivers) and not moving driver duty out of the brief.
2. **Placement: expand-in-place accordion.** Card tap changes from navigate to expand/collapse; the existing `/transactions` drill-down link moves inside the expanded panel (one tap deeper, nothing lost).
3. **Generation: one AI call covering all visible drivers**, returning a Zod-validated map keyed by driver id, cached as a single `ai_narrations` row under a new `driver_explanations` surface. If any explanation fails validation, the whole set falls back.
4. **Fallback: deterministic explanation always available.** Keyless/failed/loading all render the code-built explanation with a "Calculated" chip; AI renders with the "AI narrative · numbers calculated" chip.
5. **Architecture: generalize the pipeline per-surface** (discriminated union of input schemas, per-surface prompt/output-schema/guards, one generic cache-or-generate implementation) rather than forking a parallel module. One migration extends the `surface` check constraint. Third-plus surfaces (report commentary, weekly brief) then drop in cheaply.

## Architecture

### Financial engine (no formula changes)

Drivers keep coming from `computeDrivers`. One addition: a pure, framework-free deterministic-explanation helper (beside `driverDisplay`) that composes existing engine facts — event type, signed impact, date, `buildsEquity`, share of the period's total driver movement — into the fallback sentence. It computes nothing new.

### AI module (`src/lib/ai/`) — per-surface generalization

- **`schemas.ts`:** `narrationInputSchema` becomes `z.discriminatedUnion("surface", [briefInputSchema, driverExplanationsInputSchema])`. The `driver_explanations` input carries: `companyName`, `periodDays`, the same type-only driver array (`id`/`kind`/`date`/`impact`/`buildsEquity` — labels and event ids never cross the boundary), plus minimal period context: total inflows, total outflows, net driver impact. No score and no baseline/waterline — this surface explains events, not position.
- **New output schema:** a `.strict()` array of `{ driverId: z.string(), body: z.string() }` objects, one entry per driver, with per-body bounds (~20–280 chars).
- **`prompts.ts`:** per-surface prompt table. The driver-explanations prompt forbids advice (explains what happened; recommendations are the next slice, governed by AI_RECOMMENDATION_POLICY.md), forbids internal ids in prose, requires no-shame language and equity-vs-spend framing.
- **`narrator.ts` / `input.ts`:** `generateNarration(surface, input)`; `buildBriefInput` + `buildDriverExplanationsInput`, each ending in a runtime `.parse()`.

### Cache

Migration `0011`: extend the `ai_narrations.surface` check constraint to `('performance_brief', 'driver_explanations')`. Same table, same `(user_id, surface, input_hash)` uniqueness and input-hash keying, RLS untouched.

### Data flow

`page.tsx` builds a second promise via the generalized `getOrGenerateNarration` for the new surface from the **same already-fetched snapshots/events** (no new queries), passes it through `HomeDashboard` to `WhatMovedYourLine`, which reads it via React `use()` inside its own `Suspense` boundary. All slice-1 hardening is preserved: the data function never rejects (always `NarrationResult | null`), cache write is best-effort and isolated, logging is redacted to error class only.

## UI / UX

- **Card interaction:** the card becomes a `<button>` with `aria-expanded`/`aria-controls` and a visible chevron affordance (discoverability must not rely on color or motion alone). Accordion: one panel open at a time.
- **Panel** (full-width, below the card grid row) contains:
  1. The explanation text (AI or deterministic).
  2. Chip: `AI narrative · numbers calculated` vs `Calculated`.
  3. The relocated **"View transactions"** drill-down link (same URL and query params as today).
  4. A **"How is this generated?"** disclosure listing this driver's verified inputs: type-derived name (never the user label in the AI path), date, signed impact, equity flag, share of period movement.
- **States:** the deterministic component (cards + deterministic panels) is both the `Suspense` fallback and the `null`-result fallback — keyless, loading, and AI-failure render identically, no flash, no spinners in panels. Empty state ("No significant financial events…") unchanged.
- **Mobile-first, explicitly:** design and visually verify at ~390px **before** desktop; the panel spans full width below the 4-column card row; tap targets sized for touch. Desktop adapts from the mobile layout. (User flagged this during review — treat 390px parity as an acceptance criterion, not a checkbox.)

## Guards (deterministic, run before any output is accepted or cached)

1. Output record contains **exactly** the known driver ids — none invented, none missing (missing → whole set invalid → fallback).
2. Per-body known-amounts check reusing the existing dollar-figure guard; known set: this driver's magnitude, total inflows, total outflows, absolute net impact.
3. Score-mislabel guard (`bodyDoesNotMislabelScore`) runs on every body — cheap defense-in-depth even though score isn't in this input.
4. No-advice is enforced by prompt rule only (regex advice-detection is unreliable); the recommendation slice's policy machinery owns that class of guard.

## Error handling

Identical contract to slice 1: `generateNarration` returns `null` on every failure path (8s timeout, `maxRetries: 1`, provider error, schema violation, any guard failure) and never throws; `getOrGenerateNarration` never rejects; failures are never cached (next load retries).

## Testing

- **Unit:** schema + guard tests (invented/missing driver ids, unknown dollar amounts, body bounds); input-assembly tests proving labels/event ids never cross the boundary (the load-bearing test); deterministic-explanation formatter tests; prompt snapshot.
- **RLS/migration:** suite re-runs green; new checks that `driver_explanations` surface inserts are accepted and an unknown surface value is still rejected.
- **e2e (keyless):** cards expand and show the deterministic explanation + "Calculated" chip; the relocated "View transactions" link navigates with the correct query params; `AI_GATEWAY_API_KEY` remains forced empty in the Playwright web server.
- **Live-provider QA before merge** (slice 1 proved keyless review misses real-model bugs): real key, real model, both viewports (390×844 first, then 1280×900), cold generation → cached reload (row count/`created_at` unchanged) → key-removed fallback, zero console errors.
- `pnpm check` green before any completion claim.

## Out of scope

- Any change to the Performance brief's own narration, prompt, or cache.
- Recommendations/advice of any kind (next slice).
- Narrating the report screen or weekly brief (future surfaces the generalization enables).
- Cache-row pruning and prompt-versioned cache keys (existing KNOWN_LIMITATIONS items, unchanged by this slice).
