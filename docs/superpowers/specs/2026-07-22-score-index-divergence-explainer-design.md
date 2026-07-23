# Score/Index Divergence Explainer — Design

Status: brainstormed, approved for spec. This is **Spec 1 of 2** (see Follow-up).
Depends on the score/index rename (PR #26, DECISIONS #38): this feature references
the user-facing names **"PFI"** (the indexed performance chart) and **"Fundamentals
Score"** (the 0–900 health rating). Implementation must be based on top of that rename.

## Problem

The dashboard shows two headline numbers stacked on top of each other: the **PFI**
(an index/price that reacts to today's cash — its header "Today" delta can be sharply
red) and the **Fundamentals Score** (a 0–900 rating whose momentum chip reflects
~90-day financial health — often green). They routinely point in opposite directions:
PFI −14.1% Today while the Fundamentals Score reads "▲▲ strongly improving." With no
explanation, this reads as the app contradicting itself.

This is not a bug — a one-day cash outflow lowers the fast, position-based index while
the slow, trailing-90-day fundamentals keep improving. The two genuinely measure
different time horizons (this divergence is the core of the "household as a public
company" thesis: a company has both a share price and balance-sheet health, and they
can move apart). The gap is that the dashboard never *says* so.

The rename (PR #26) fixed the labels so the two numbers no longer sound identical. It
did **not** address the divergence confusion. This spec does.

## Decisions locked in brainstorming

1. **Purpose — "both, compact":** a compact reconciliation line that repairs trust in
   the moment *and* offers the mental model on demand via a `› Learn` link.
2. **Trigger — on-screen sign clash:** show the line only when the two things actually
   visible on the dashboard disagree in sign — the PFI header "Today" delta vs the
   Fundamentals Score momentum chip. Agreement, or a neutral score momentum, shows
   nothing.
3. **Sentence source — AI-narrated with deterministic fallback:** detection and a
   template sentence are always deterministic (binding rule: "deterministic code
   calculates; AI only narrates"); when a gateway key is present, the AI produces
   varied wording, exactly like the existing Performance-brief surface.
4. **`› Learn` target — interim inline expand (this spec); full Academy lesson is
   Spec 2.** Ship the line with `› Learn` expanding a short inline paragraph; a
   fast-follow spec authors the "PFI vs Fundamentals Score" Academy lesson and
   repoints `› Learn` to it.

## Scope

**In:** a deterministic divergence detector in the financial engine; a deterministic
template sentence; a new `score_index_divergence` narration surface (AI skin + cache +
guards); a compact dashboard line between the PFI card and the Fundamentals Score card
with an interim inline `› Learn` expand; tests.

**Out:** range-picker-specific divergence (we key only on the range-independent "Today"
delta — see Data flow); the full Academy lesson (Spec 2); divergence anywhere but the
dashboard; any "last time you diverged" history; changing either number's calculation.

## Design

### 1. Deterministic detection (engine) — the single source of truth

A new pure, framework-free function, `computeDivergence(...)`, in
`src/lib/financial-engine/` (new `divergence.ts`, exported from the barrel):

```
computeDivergence(indexTodayPoints: number | null, scoreMomentum: MomentumState)
  : DivergenceResult | null
```

- **Index sign** = sign of the PFI header "Today" delta (`indexDayChange(...).points`).
  `> 0` → up, `< 0` → down, `0`/`null` → **no sign** (no clash).
- **Score sign** derived from `MomentumState`:
  - up: `strongly_improving`, `improving`, `recovering`
  - down: `weakening`, `deteriorating`
  - **no sign** (never clashes): `stable`, `insufficient_history`
- Returns `null` unless the two signs are opposite. On a clash returns
  `{ direction: "index_down_score_up" | "index_up_score_down", scoreMomentum }`.
- **Suppressed score:** when the Fundamentals Score has not unlocked
  (`scoreSummary.state === "suppressed"`) there is nothing to diverge from — the caller
  skips detection entirely (passes `null` to the dashboard). `provisional` scores are
  real and do participate.

This function is the one authority; both the template and the AI input derive from its
result, so they can never disagree about the direction.

### 2. Deterministic template sentence

A pure formatter `divergenceTemplate(result, companyName)` returns the guaranteed
sentence, one per direction:

- `index_down_score_up`: "{Company}'s PFI dipped on recent cash movement, but its
  90-day fundamentals kept improving — the two track different time horizons."
- `index_up_score_down`: "{Company}'s PFI rose on recent cash inflow, but its 90-day
  fundamentals softened — the two track different time horizons."

This is the always-present sentence: it renders when no gateway key is configured and
is the fallback on any AI failure.

### 3. Narration surface — `score_index_divergence`

Extends the existing narrator (mirrors `performance_brief` / `driver_explanations`,
DECISIONS #26/#31) with no structural novelty:

- **Schema** (`src/lib/ai/schemas.ts`, `.strict()`): input carries only
  `{ surface, companyName, direction, scoreMomentum }` — no dollar figures, no balances.
  Output is a single bounded `body` string (~40–240 chars).
- **Prompt** (`src/lib/ai/prompts.ts`): a new system prompt added to `SYSTEM_PROMPTS`,
  instructing a neutral-analyst reconciliation of a fast share-price-like index vs
  slow 90-day fundamentals, in the given `direction`, third person, company name.
- **Guards** (`generateNarration`): reuse `bodyDoesNotMislabelScore` (never "credit
  score"/"FICO"). Add a **best-effort lexical direction-consistency check**: the body's
  up/down language for the score must not contradict the known `direction`; on failure,
  fail closed to the template. (A perfect semantic guard is out of scope — the
  deterministic template is the guaranteed safety net, so a heuristic check plus prompt
  control is proportionate for a non-compliance, low-stakes sentence. Contrast the
  credit-score guard, which is load-bearing and exact.)
- **Cache/audit**: reuse `ai_narrations` keyed by `(user_id, surface, input_hash)`; the
  hash over `{companyName, direction, scoreMomentum}` invalidates naturally when the
  direction or momentum changes. `getOrGenerateNarration` returns `null` on any failure,
  and the caller falls back to the template.

### 4. UI — the compact line

A new presentational component (e.g. `DivergenceExplainer`) rendered **between the PFI
card and the `ScoreCard`** in `HomeDashboard`. Renders `null` when there is no
divergence. When present: one sentence (AI body or template) + a `› Learn` control.

- **Interim `› Learn`:** a disclosure that expands a short static paragraph inline (the
  same explanation, slightly longer), styled like the existing `ⓘ` tooltips — no
  Academy dependency this spec. Spec 2 replaces the target with the lesson route.
- **Accessibility / binding rules:** state is carried by **text + the ⓘ icon, never
  color alone**; the block is keyboard-operable; it is `role="note"`/`status`-appropriate
  and screen-reader legible.

### Data flow

Detection is **range-independent**: `HomeDashboard` computes the header "Today" delta
from the full `points` series (`latestPoint`/`prevPoint` are the last two points of the
whole history, not the range-filtered `visible`), so the picker never changes it. That
lets the whole thing be computed server-side, once:

1. In the dashboard loader (`src/lib/data/queries.ts`, `getDashboardData`), build the
   index series with the same pure `buildIndexSeries` the client uses, derive the
   "Today" index-point delta (`indexDayChange`), and read `scoreSummary.momentum`.
2. If the score is suppressed, pass `null` (no line). Otherwise call
   `computeDivergence(todayPoints, momentum)`. If `null`, pass `null` to the dashboard —
   no line, no AI call.
3. If non-null, build the template sentence and (when a key is configured) call
   `getOrGenerateNarration` for the `score_index_divergence` surface; the AI result or
   the template becomes the sentence.
4. Pass `{ direction, sentence } | null` to `HomeDashboard`, which renders the line.
   No client recompute, no per-range logic, no round-trip.

(Sign shortcut noted for the plan: the index mapping is monotonic in position, so the
sign of the indexed "Today" delta equals the sign of the raw available-position day
delta; using the shared `buildIndexSeries` path anyway guarantees parity with the card.)

## Binding-rule obligations

- **Deterministic calculates; AI narrates:** detection + template are deterministic;
  AI only reskins wording and fails closed. ✅
- **Never a credit score:** reuse `bodyDoesNotMislabelScore`; the prompt names the
  Fundamentals Score and forbids credit-score framing. ✅
- **State not by color alone:** the line pairs text with the ⓘ icon. ✅
- **Explainability:** `› Learn` always available. ✅
- **Analytics privacy:** if a "divergence shown" event is logged, it carries the
  `direction` enum only — never balances, deltas, or the sentence. ✅

## Testing

- **Engine unit tests** (`divergence.test.ts`): both clash directions →
  populated result; both-up and both-down → `null`; `stable`/`insufficient_history`
  momentum → `null`; zero/`null` index delta → `null`. `divergenceTemplate` snapshot for
  each direction.
- **AI schema/guard tests** (`schemas.test.ts`, `prompts.test.ts`): the strict input/
  output schemas; the mislabel guard; the lexical direction-consistency check rejecting
  an inverted body; `generateNarration` returning `null` on failure.
- **Component test:** the line renders on a clash and is absent on agreement; `› Learn`
  expands the inline paragraph; keyless path shows the template.
- **Keyless run:** with no gateway key, the deterministic template must render (the
  existing keyless-fallback discipline).

## Dependencies & rollout

- **Depends on PR #26** (score/index rename). Base the implementation branch on the
  rename so it inherits "PFI" / "Fundamentals Score"; rebase onto `main` once #26 merges.
- No migration — reuses the `ai_narrations` table.
- `pnpm check` green; visual QA at 390px and 1280px, verifying the line appears on a
  diverging demo profile and is absent on an agreeing one, at both widths.

## Follow-up (Spec 2, not this slice)

Author the full **"PFI vs Fundamentals Score"** Academy lesson (sections + knowledge
checks + concept/lesson record + progress wiring) and repoint `› Learn` from the interim
inline expand to the lesson route.
