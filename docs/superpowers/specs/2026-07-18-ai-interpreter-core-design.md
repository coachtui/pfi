# AI Interpreter Core + Performance Brief Narration — Design

Date: 2026-07-18
Status: approved (brainstorm complete)
Phase: 4 (AI financial interpreter) — first slice
Binding policy: `docs/AI_RECOMMENDATION_POLICY.md`

## Goal

Build the provider-agnostic AI service foundation (structured Zod-validated
input/output, policy-encoding prompt, redaction-safe persistence/audit) and
prove it end-to-end on exactly one surface: AI narration of the dashboard
**Performance brief**. The AI replaces the wording, never the numbers — the
deterministic engine remains the only source of every figure.

Later Phase 4 slices (weekly brief, recommendation cards, quarterly report
narration, streaming UI) reuse this core and are **out of scope** here.

## Decisions (confirmed with user)

1. **Scope:** AI core + one surface (Performance brief narration). Other
   Phase 4 surfaces are follow-up slices.
2. **Provider wiring:** Vercel AI SDK (`generateObject` with Zod schemas),
   gateway-style model strings. Provider swap = change a string, not call
   sites. Default model `anthropic/claude-haiku-4-5`, overridable via
   `PFI_AI_MODEL`.
3. **Generation & persistence:** on-demand at first dashboard view, cached in
   a new `ai_narrations` table keyed by `(user_id, surface, input_hash)`.
   Data changes invalidate naturally via the hash. Cached rows double as the
   audit log.
4. **Degradation:** AI narration is a progressive enhancement. Missing key,
   provider error, timeout, or validation failure all render the existing
   deterministic brief with no user-facing error. `AI_GATEWAY_API_KEY` is an
   **optional** env var; dev/CI run keyless.
5. **Data boundary:** prompts may contain **derived metrics with real dollar
   values** (net flow, runway, cushion, drivers, score deltas) but never raw
   transaction rows, merchant names, or account identifiers. Enforced by the
   `NarrationInput` type, which has no fields that could carry them.

## Architecture

New module `src/lib/ai/` — server-only, no React/Next imports (extractable
later, same rule as `financial-engine`):

| File | Responsibility |
| --- | --- |
| `schemas.ts` | Zod schemas: `NarrationInput` (the entire data boundary — drivers from `computeDrivers`, momentum, baseline/waterline status, available capital + cushion dollars, score delta, company name, period label) and `NarrationOutput` (narration paragraphs + per-claim list of referenced driver ids for traceability). |
| `prompts.ts` | System prompt encoding the policy: narrate only supplied metrics, tone rules (specific and measurable, no shame, no austerity celebration), no advice/securities/tax-legal conclusions/guarantees. |
| `narrator.ts` | `generateNarration(input): Promise<NarrationOutput \| null>` via AI SDK `generateObject()`; model string from config; one retry on validation failure; hard timeout; returns `null` on any failure. |
| `hash.ts` | Stable hash of a canonicalized `NarrationInput` for cache keying. |

**Input assembly** lives server-side next to the existing queries
(`buildNarrationInput()`): maps engine outputs into `NarrationInput`. The AI
never touches the database.

## Data flow

```
engine outputs (drivers, momentum, status, delta)
  → buildNarrationInput()            [deterministic, server]
  → input_hash = hash(input)
  → ai_narrations lookup ──────────── hit → render cached narration
  → miss → generateObject() → Zod-validate → persist → render
  → any failure / timeout / no key → deterministic PerformanceBrief
```

The AI brief renders inside a Suspense boundary; the deterministic brief is
the loading and failure state, so cold generation never blocks the dashboard.

## Persistence — migration `0009_ai_narrations`

Columns: `id`, `user_id`, `surface` (text, `'performance_brief'` for now),
`input_hash`, `input_json`, `output_json`, `model`, `created_at`.
Unique `(user_id, surface, input_hash)`. Owner-only RLS following the
existing default-deny pattern. `input_json`/`output_json` are the redacted
audit trail — safe to store because `NarrationInput` cannot carry raw data.
Failures are never cached (next load retries naturally).

## UI treatment

`PerformanceBrief` keeps its card, heading, and educational disclaimer.

- Narration available → body text is the AI wording; chip reads
  **"AI narrative · numbers calculated"**.
- Otherwise → today's deterministic text; chip reads **"Calculated"** (the
  "AI narration in Phase 4" label retires either way).
- New disclosure: **"How is this generated?"** — lists the exact metrics the
  narration was given, rendered from the stored `input_json`
  (explainability rule).
- No color-only state signaling; the chip is text.

## Error handling

Every failure class collapses to one behavior — deterministic fallback:

- No `AI_GATEWAY_API_KEY` → narrator never called.
- Provider error / timeout (~8s cap) → fallback; server log line contains no
  metric values.
- Model output fails Zod validation → **discard, never render unvalidated
  text**; one retry, then fallback.
- Traceability check: a narration referencing a driver id not present in the
  input fails validation and is discarded the same way.

## Env & config

- `AI_GATEWAY_API_KEY` (optional) — absent disables AI features.
- `PFI_AI_MODEL` (optional) — gateway model string, default
  `anthropic/claude-haiku-4-5`.
- Both validated in `src/lib/config/env.ts` (server-side, not
  `NEXT_PUBLIC_*`).

## Testing

- **Unit:** `buildNarrationInput` assembly correctness + a test asserting the
  schema rejects objects with forbidden fields (raw descriptions, account
  ids); hash stability/canonicalization; `narrator.ts` against the AI SDK
  mock model (valid → parsed, malformed → retry then null, timeout → null);
  prompt snapshot test so policy wording changes are deliberate.
- **RLS:** `ai_narrations` owner-only read/write + cross-user denial, added
  to `pnpm test:rls`.
- **E2E:** keyless run asserts the deterministic brief renders (existing
  smoke suite runs without an AI key — doubles as the regression guard).
- **Live browse QA:** with a real key at 390px and 1280px — cold generation,
  cached reload, "How is this generated?" disclosure.
- `pnpm check` green before completion claims, per project rules.

## Out of scope (follow-up slices)

Weekly brief, recommendation cards (green/yellow/red), quarterly shareholder
report narration, streaming responses, per-user model preferences, AI Q&A.

## DECISIONS.md entries to record during implementation

- Provider strategy: Vercel AI SDK + gateway model strings (provider-agnostic
  service), optional-key progressive enhancement.
- `ai_narrations` cache/audit table design.
