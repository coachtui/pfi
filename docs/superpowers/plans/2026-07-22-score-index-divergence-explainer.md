# Score/Index Divergence Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, explainable line on the dashboard when PFI (the index) and the Fundamentals Score point in opposite directions, so the two numbers don't read as the app contradicting itself.

**Architecture:** A pure engine function detects the sign clash and produces a guaranteed template sentence; a new `score_index_divergence` AI narration surface (mirroring the existing `performance_brief`/`driver_explanations` surfaces) reskins the wording when a gateway key is present and fails closed to the template. Detection is range-independent, so it is computed server-side in `page.tsx` and passed to the client dashboard — no round-trip.

**Tech Stack:** TypeScript, Zod, Vitest (node environment — this repo has NO React component-test infra: no testing-library, no jsdom, zero `.test.tsx` files; UI is verified by Playwright e2e + visual QA), Next.js App Router (RSC + `Suspense`/`use()`), Vercel AI SDK via AI Gateway, Supabase (`ai_narrations` cache).

## Global Constraints

- Deterministic code calculates; AI only narrates. No financial logic in React components; detection + template live in `src/lib/financial-engine/` (framework-free, typed, tested).
- The 0–900 score is the **Fundamentals Score** (user-facing) and must **never** be described as a credit score, credit rating, or FICO.
- Never communicate positive/negative state through color alone — pair with text/shape.
- Every metric/score is explainable; the line offers a `Learn` affordance.
- Product analytics never receive raw balances, transaction values, or the sentence — only the `direction` enum if ever logged (no analytics event is added in this slice).
- `src/lib/financial-engine` and `src/lib/ai/*` schemas stay free of React/Next imports.
- This feature depends on the score/index rename (PR #26). Base the implementation branch on that rename so it inherits "PFI"/"Fundamentals Score"; rebase onto `main` once #26 merges.
- No DB migration — reuse the `ai_narrations` table.
- **Test boundary (matches this repo's conventions):** all business logic — detection, template, guards, input assembly — is node-unit-tested (Tasks 1–6). The narration-cache wiring, UI components, and page wiring (Tasks 7–9) carry no unit tests (the repo has none for these layers); they are verified by `pnpm typecheck` plus the Task 10 e2e/visual QA. Do not introduce testing-library or jsdom.

---

### Task 1: Divergence detector (engine)

**Files:**
- Create: `src/lib/financial-engine/divergence.ts`
- Modify: `src/lib/financial-engine/index.ts` (add `export * from "./divergence";`)
- Test: `src/lib/financial-engine/divergence.test.ts`

**Interfaces:**
- Consumes: `MomentumState` from `./score-types` (values: `"strongly_improving" | "improving" | "stable" | "weakening" | "deteriorating" | "recovering" | "insufficient_history"`).
- Produces:
  - `type DivergenceDirection = "index_down_score_up" | "index_up_score_down"`
  - `interface DivergenceResult { direction: DivergenceDirection; scoreMomentum: MomentumState }`
  - `function computeDivergence(indexTodayPoints: number | null, scoreMomentum: MomentumState): DivergenceResult | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeDivergence } from "./divergence";

describe("computeDivergence", () => {
  it("flags index down + score improving", () => {
    expect(computeDivergence(-12.3, "strongly_improving")).toEqual({
      direction: "index_down_score_up",
      scoreMomentum: "strongly_improving",
    });
  });

  it("flags index up + score deteriorating", () => {
    expect(computeDivergence(4.1, "deteriorating")).toEqual({
      direction: "index_up_score_down",
      scoreMomentum: "deteriorating",
    });
  });

  it("treats recovering as an up score", () => {
    expect(computeDivergence(-1, "recovering")?.direction).toBe("index_down_score_up");
  });

  it("returns null when both point up", () => {
    expect(computeDivergence(5, "improving")).toBeNull();
  });

  it("returns null when both point down", () => {
    expect(computeDivergence(-5, "weakening")).toBeNull();
  });

  it("returns null for neutral score momentum", () => {
    expect(computeDivergence(-5, "stable")).toBeNull();
    expect(computeDivergence(-5, "insufficient_history")).toBeNull();
  });

  it("returns null when the index delta is zero or unknown", () => {
    expect(computeDivergence(0, "improving")).toBeNull();
    expect(computeDivergence(null, "weakening")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/financial-engine/divergence.test.ts`
Expected: FAIL — "Failed to resolve import ./divergence" / `computeDivergence is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/financial-engine/divergence.ts`:

```ts
import type { MomentumState } from "./score-types";

export type DivergenceDirection = "index_down_score_up" | "index_up_score_down";

export interface DivergenceResult {
  direction: DivergenceDirection;
  scoreMomentum: MomentumState;
}

/** +1 up, -1 down, 0 no clear direction (never clashes). */
function scoreSign(m: MomentumState): 1 | -1 | 0 {
  switch (m) {
    case "strongly_improving":
    case "improving":
    case "recovering":
      return 1;
    case "weakening":
    case "deteriorating":
      return -1;
    default:
      return 0; // stable, insufficient_history
  }
}

/**
 * Detects an on-screen sign clash between the PFI header "Today" delta and the
 * Fundamentals Score momentum chip. Returns null unless the two point in
 * opposite, non-neutral directions. This is the single authority — both the
 * template sentence and the AI narration input derive from its result.
 */
export function computeDivergence(
  indexTodayPoints: number | null,
  scoreMomentum: MomentumState,
): DivergenceResult | null {
  const indexSign = indexTodayPoints == null || indexTodayPoints === 0 ? 0 : indexTodayPoints > 0 ? 1 : -1;
  const scoreS = scoreSign(scoreMomentum);
  if (indexSign === 0 || scoreS === 0 || indexSign === scoreS) return null;
  return {
    direction: indexSign < 0 ? "index_down_score_up" : "index_up_score_down",
    scoreMomentum,
  };
}
```

Add to `src/lib/financial-engine/index.ts` after the existing exports (e.g. after `export * from "./staleness";`):

```ts
export * from "./divergence";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/financial-engine/divergence.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/divergence.ts src/lib/financial-engine/index.ts src/lib/financial-engine/divergence.test.ts
git commit -m "feat(engine): add computeDivergence detector for PFI vs Fundamentals Score"
```

---

### Task 2: Deterministic template sentence (engine)

**Files:**
- Modify: `src/lib/financial-engine/divergence.ts`
- Test: `src/lib/financial-engine/divergence.test.ts` (extend)

**Interfaces:**
- Consumes: `DivergenceResult` (Task 1).
- Produces: `function divergenceTemplate(result: DivergenceResult, companyName: string): string`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/financial-engine/divergence.test.ts`:

```ts
import { divergenceTemplate } from "./divergence";

describe("divergenceTemplate", () => {
  it("phrases index-down / score-up", () => {
    const s = divergenceTemplate(
      { direction: "index_down_score_up", scoreMomentum: "improving" },
      "Koa Holdings",
    );
    expect(s).toBe(
      "Koa Holdings's PFI dipped on recent cash movement, but its 90-day fundamentals kept improving — the two track different time horizons.",
    );
  });

  it("phrases index-up / score-down", () => {
    const s = divergenceTemplate(
      { direction: "index_up_score_down", scoreMomentum: "weakening" },
      "Koa Holdings",
    );
    expect(s).toBe(
      "Koa Holdings's PFI rose on recent cash inflow, but its 90-day fundamentals softened — the two track different time horizons.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/financial-engine/divergence.test.ts`
Expected: FAIL — `divergenceTemplate is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/financial-engine/divergence.ts`:

```ts
/** The guaranteed sentence: renders keyless and is the AI fallback. */
export function divergenceTemplate(result: DivergenceResult, companyName: string): string {
  return result.direction === "index_down_score_up"
    ? `${companyName}'s PFI dipped on recent cash movement, but its 90-day fundamentals kept improving — the two track different time horizons.`
    : `${companyName}'s PFI rose on recent cash inflow, but its 90-day fundamentals softened — the two track different time horizons.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/financial-engine/divergence.test.ts`
Expected: PASS (10 assertions total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/divergence.ts src/lib/financial-engine/divergence.test.ts
git commit -m "feat(engine): add divergenceTemplate sentence"
```

---

### Task 3: Narration schemas + direction-consistency guard

**Files:**
- Modify: `src/lib/ai/schemas.ts`
- Test: `src/lib/ai/schemas.test.ts` (extend)

**Interfaces:**
- Consumes: `z` (zod), existing `textDoesNotMislabelScore(text: string): boolean`.
- Produces:
  - `const DIVERGENCE_SURFACE = "score_index_divergence"`
  - `NarrationSurface` union now includes `typeof DIVERGENCE_SURFACE`
  - `divergenceInputSchema`, `divergenceOutputSchema`, `type DivergenceInput`, `type DivergenceOutput`
  - `narrationInputSchema` union includes `divergenceInputSchema`
  - `function bodyIsDirectionConsistent(input: DivergenceInput, output: DivergenceOutput): boolean`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ai/schemas.test.ts`:

```ts
import {
  DIVERGENCE_SURFACE,
  divergenceInputSchema,
  divergenceOutputSchema,
  bodyIsDirectionConsistent,
} from "./schemas";

describe("divergence surface schemas", () => {
  const input = divergenceInputSchema.parse({
    surface: DIVERGENCE_SURFACE,
    companyName: "Koa Holdings",
    direction: "index_down_score_up",
    scoreMomentum: "improving",
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => divergenceInputSchema.parse({ ...input, extra: 1 })).toThrow();
  });

  it("bounds the output body length", () => {
    expect(() => divergenceOutputSchema.parse({ body: "too short" })).toThrow();
  });

  it("passes a body consistent with the direction", () => {
    const output = divergenceOutputSchema.parse({
      body: "Its share-price proxy slipped this week, yet the underlying fundamentals kept improving over the quarter.",
    });
    expect(bodyIsDirectionConsistent(input, output)).toBe(true);
  });

  it("rejects a body that inverts the score direction", () => {
    const output = divergenceOutputSchema.parse({
      body: "Its share-price proxy rose, and the underlying fundamentals weakened over the quarter as well.",
    });
    expect(bodyIsDirectionConsistent(input, output)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts`
Expected: FAIL — exports `DIVERGENCE_SURFACE`/`divergenceInputSchema`/… not found.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ai/schemas.ts`, add the surface constant next to the existing ones (after `DRIVER_EXPLANATIONS_SURFACE`):

```ts
export const DIVERGENCE_SURFACE = "score_index_divergence" as const;
```

Extend the `NarrationSurface` type to include it:

```ts
export type NarrationSurface =
  | typeof BRIEF_SURFACE
  | typeof DRIVER_EXPLANATIONS_SURFACE
  | typeof DIVERGENCE_SURFACE;
```

Add the schemas (place after `driverExplanationsInputSchema`, before `narrationInputSchema`):

```ts
export const divergenceInputSchema = z
  .object({
    surface: z.literal(DIVERGENCE_SURFACE),
    companyName: z.string().min(1),
    direction: z.enum(["index_down_score_up", "index_up_score_down"]),
    /** Fundamentals Score momentum state, for nuance only. */
    scoreMomentum: z.string().min(1),
  })
  .strict();

export type DivergenceInput = z.infer<typeof divergenceInputSchema>;

export const divergenceOutputSchema = z
  .object({
    /** One compact reconciliation sentence. */
    body: z.string().min(40).max(240),
  })
  .strict();

export type DivergenceOutput = z.infer<typeof divergenceOutputSchema>;
```

Add `divergenceInputSchema` to the discriminated union:

```ts
export const narrationInputSchema = z.discriminatedUnion("surface", [
  briefInputSchema,
  driverExplanationsInputSchema,
  divergenceInputSchema,
]);
```

Add the guard at the end of the file (reuses the existing `textDoesNotMislabelScore` neighbor):

```ts
/**
 * Best-effort lexical guard: reject only a body that describes the SCORE moving
 * in the KNOWN-wrong direction, phrased as "...fundamentals/health <wrong-word>"
 * (the natural order). Matching only AFTER the anchor avoids tripping on the
 * index's own down-words ("slipped", "dipped") that legitimately precede a
 * "...fundamentals kept improving" clause. False positives are harmless here —
 * they just fall back to the (correct) deterministic template — so the guard is
 * deliberately lenient; the template is the real safety net.
 */
export function bodyIsDirectionConsistent(
  input: DivergenceInput,
  output: DivergenceOutput,
): boolean {
  const UP = ["improv", "strengthen", "grew", "rose", "solid", "healthier", "better"];
  const DOWN = ["soften", "weaken", "fell", "declin", "deteriorat", "slipp", "worse"];
  const wrong = input.direction === "index_down_score_up" ? DOWN : UP;
  const anchored = new RegExp(
    `(?:fundamental|health)s?[^.]{0,40}(?:${wrong.join("|")})`,
    "i",
  );
  return !anchored.test(output.body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts`
Expected: PASS (all existing + 4 new assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/schemas.test.ts
git commit -m "feat(ai): add score_index_divergence schemas + direction guard"
```

---

### Task 4: Divergence system prompt

**Files:**
- Modify: `src/lib/ai/prompts.ts`
- Test: `src/lib/ai/prompts.test.ts` (extend)

**Interfaces:**
- Consumes: `NarrationSurface` (now includes `DIVERGENCE_SURFACE`).
- Produces: `DIVERGENCE_SYSTEM_PROMPT`; `SYSTEM_PROMPTS` now has a `score_index_divergence` entry; `buildUserPrompt` handles the divergence surface.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ai/prompts.test.ts`:

```ts
import { DIVERGENCE_SYSTEM_PROMPT, SYSTEM_PROMPTS } from "./prompts";

describe("divergence prompt", () => {
  it("encodes the reconciliation rules", () => {
    for (const phrase of [
      "Fundamentals Score",
      "not a credit score",
      "different time horizons",
      "do not invert",
    ]) {
      expect(DIVERGENCE_SYSTEM_PROMPT.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("is wired into the surface map", () => {
    expect(SYSTEM_PROMPTS.score_index_divergence).toBe(DIVERGENCE_SYSTEM_PROMPT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: FAIL — `DIVERGENCE_SYSTEM_PROMPT` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ai/prompts.ts`, add after `DRIVER_EXPLANATIONS_SYSTEM_PROMPT`:

```ts
/**
 * Reconciles the fast index (PFI) against the slow Fundamentals Score when they
 * point in opposite directions. The phrase tests make wording changes deliberate.
 */
export const DIVERGENCE_SYSTEM_PROMPT = `You reconcile two numbers on a household's dashboard, in the voice of a neutral analyst covering a small company. Write ONE sentence. Rules, in priority order:

1. The two numbers are the PFI (an index that behaves like a share price and reacts to recent cash movement) and the Fundamentals Score (a 0–900 measure of 90-day financial health). They track different time horizons — a short-term cash swing can move one without the other. Say so.
2. The Fundamentals Score is NOT a credit score, credit rating, or FICO score, and must never be called one.
3. You are given the direction of the divergence. State it exactly as given — do not invert which number went up and which went down.
4. No advice of any kind, no numbers you were not given, no shame-oriented language. This is educational analysis, not financial advice.
5. Plain language, third person, using the company name provided. One sentence, under 240 characters.`;
```

Update the `SYSTEM_PROMPTS` map:

```ts
export const SYSTEM_PROMPTS: Record<NarrationSurface, string> = {
  performance_brief: BRIEF_SYSTEM_PROMPT,
  driver_explanations: DRIVER_EXPLANATIONS_SYSTEM_PROMPT,
  score_index_divergence: DIVERGENCE_SYSTEM_PROMPT,
};
```

Add a branch to `buildUserPrompt` (before the final `return`):

```ts
  if (input.surface === "score_index_divergence") {
    return `Reconcile these two dashboard numbers in one sentence. Verified facts:

${JSON.stringify(input, null, 2)}`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: PASS (existing snapshots unchanged + 2 new assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts.ts src/lib/ai/prompts.test.ts
git commit -m "feat(ai): add divergence system prompt + user-prompt branch"
```

---

### Task 5: Narrator branch for the divergence surface

**Files:**
- Modify: `src/lib/ai/narrator.ts`
- Test: `src/lib/ai/narrator.test.ts` (extend — the file exists and mocks the model with its local `mockModelReturning(object)` helper, built on `MockLanguageModelV4` from `ai/test`, passed as `opts.model`)

**Interfaces:**
- Consumes: `divergenceOutputSchema`, `type DivergenceInput`, `type DivergenceOutput`, `bodyIsDirectionConsistent`, `textDoesNotMislabelScore`, `DIVERGENCE_SURFACE` from `./schemas`.
- Produces: `generateNarration` overload `(input: DivergenceInput, opts?: NarratorOptions) => Promise<DivergenceOutput | null>`; runtime branch applying the two guards.

- [ ] **Step 1: Write the failing test**

Add `DIVERGENCE_SURFACE` and `divergenceInputSchema` to the existing `import { … } from "./schemas";` at the top of `src/lib/ai/narrator.test.ts`, then append:

```ts
const divergenceInput = divergenceInputSchema.parse({
  surface: DIVERGENCE_SURFACE,
  companyName: "Test Co",
  direction: "index_down_score_up",
  scoreMomentum: "improving",
});

describe("generateNarration — divergence", () => {
  it("returns the body when the narration is direction-consistent", async () => {
    const out = await generateNarration(divergenceInput, {
      model: mockModelReturning({
        body: "Its share-price proxy slipped this week, yet the underlying fundamentals kept improving over the quarter.",
      }),
    });
    expect(out?.body).toContain("fundamentals");
  });

  it("fails closed (null) when the body inverts the score direction", async () => {
    const out = await generateNarration(divergenceInput, {
      model: mockModelReturning({
        body: "Its share-price proxy rose while the fundamentals weakened further over the 90-day window here.",
      }),
    });
    expect(out).toBeNull();
  });

  it("fails closed (null) when the body mislabels the score", async () => {
    const out = await generateNarration(divergenceInput, {
      model: mockModelReturning({
        body: "Its credit score fell even though the fundamentals kept improving over the 90-day window here today.",
      }),
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts`
Expected: FAIL — the divergence input isn't handled (falls through to the driver-explanations branch and throws/returns wrong shape).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ai/narrator.ts`, add to the `./schemas` imports: `divergenceOutputSchema`, `bodyIsDirectionConsistent`, `DIVERGENCE_SURFACE`, `type DivergenceInput`, `type DivergenceOutput` (`textDoesNotMislabelScore` is already imported for the existing guards; if not, add it).

Add a third overload signature next to the existing two:

```ts
export async function generateNarration(
  input: DivergenceInput,
  opts?: NarratorOptions,
): Promise<DivergenceOutput | null>;
```

Widen the implementation signature's union return to include `DivergenceOutput`, and add the branch after the `performance_brief` block and before the `driver_explanations` handling:

```ts
  if (input.surface === DIVERGENCE_SURFACE) {
    const output = await generate(model, input, divergenceOutputSchema, opts);
    if (!output) return null;
    if (!textDoesNotMislabelScore(output.body)) return null;
    if (!bodyIsDirectionConsistent(input, output)) return null;
    return output;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts`
Expected: PASS (existing + 3 new assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/narrator.ts src/lib/ai/narrator.test.ts
git commit -m "feat(ai): narrator branch for divergence with mislabel + direction guards"
```

---

### Task 6: Divergence narration input builder

**Files:**
- Modify: `src/lib/ai/input.ts`
- Test: `src/lib/ai/input.test.ts` (extend — the file exists)

**Interfaces:**
- Consumes: `NarrationSource` (fields `companyName`, `snapshots`, `score`), `buildIndexSeries`, `indexDayChange`, `computeDivergence`, `type MomentumState` from `@/lib/financial-engine`; `DIVERGENCE_SURFACE`, `type DivergenceInput` from `./schemas`.
- Produces: `function buildDivergenceInput(source: NarrationSource): DivergenceInput | null`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ai/input.test.ts`. `DailySnapshot`'s exact fields are
`date, liquidAssets, revolvingBalances, nearTermObligations, essentialObligations, safetyBuffer, netWorth`
(from `src/lib/financial-engine/types.ts`). Available position falls from 5000 to 2000
day-over-day → index down; paired with an improving score → a clash:

```ts
import { buildDivergenceInput, type NarrationSource } from "./input";
import type { DailySnapshot } from "@/lib/financial-engine";

function snap(date: string, liquid: number): DailySnapshot {
  return {
    date,
    liquidAssets: liquid,
    revolvingBalances: 0,
    nearTermObligations: 0,
    essentialObligations: 0,
    safetyBuffer: 0,
    netWorth: liquid,
  };
}

const base: NarrationSource = {
  companyName: "Koa Holdings",
  snapshots: [snap("2026-07-20", 5000), snap("2026-07-21", 2000)],
  events: [],
  score: { overall: 640, band: "Fair", momentum: "improving" },
};

describe("buildDivergenceInput", () => {
  it("produces an input on a clash", () => {
    expect(buildDivergenceInput(base)).toEqual({
      surface: "score_index_divergence",
      companyName: "Koa Holdings",
      direction: "index_down_score_up",
      scoreMomentum: "improving",
    });
  });

  it("returns null when the score is suppressed (no score object)", () => {
    expect(buildDivergenceInput({ ...base, score: null })).toBeNull();
  });

  it("returns null when there is no clash (score also declining)", () => {
    expect(
      buildDivergenceInput({ ...base, score: { overall: 640, band: "Fair", momentum: "weakening" } }),
    ).toBeNull();
  });
});
```

> Verified: `buildIndexSeries` maps 1:1 over snapshots (no minimum window for `.actual`; only `.baseline` needs 7 days, which this code path never reads), so two snapshots are sufficient to exercise a real day-over-day delta.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/input.test.ts`
Expected: FAIL — `buildDivergenceInput` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ai/input.ts`, add to the `@/lib/financial-engine` imports: `buildIndexSeries`, `indexDayChange`, `computeDivergence`, `type MomentumState`; and from `./schemas`: `DIVERGENCE_SURFACE`, `type DivergenceInput`. Add:

```ts
/**
 * Divergence input: null unless the PFI "Today" delta and the Fundamentals
 * Score momentum clash in sign. Score-suppressed sources (score === null) never
 * diverge. Recomputes via the same pure detector page.tsx uses, so they agree.
 */
export function buildDivergenceInput(source: NarrationSource): DivergenceInput | null {
  if (!source.score) return null;
  const points = buildIndexSeries(source.snapshots).points;
  if (points.length < 2) return null;
  const today = indexDayChange(points[points.length - 1].actual, points[points.length - 2]?.actual).points;
  const momentum = source.score.momentum as MomentumState;
  const result = computeDivergence(today, momentum);
  if (!result) return null;
  return {
    surface: DIVERGENCE_SURFACE,
    companyName: source.companyName,
    direction: result.direction,
    scoreMomentum: momentum,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/input.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/input.ts src/lib/ai/input.test.ts
git commit -m "feat(ai): buildDivergenceInput narration input builder"
```

---

### Task 7: Wire the surface into the cache-or-generate layer

No unit test — `src/lib/data/narration.ts` has no test file in this repo, and the
underlying logic (input building, guard-gated generation) is already covered by Tasks 5–6.
This task is verified by `pnpm typecheck` (the overloads and branch must line up) and is
exercised end-to-end in Task 10.

**Files:**
- Modify: `src/lib/data/narration.ts`

**Interfaces:**
- Consumes: `DIVERGENCE_SURFACE`, `divergenceOutputSchema`, `type DivergenceInput`, `type DivergenceOutput` from `@/lib/ai/schemas`; `buildDivergenceInput` from `@/lib/ai/input`; existing `generateNarration`, `readCachedOutput`, `writeCachedOutput`.
- Produces:
  - `interface DivergenceNarrationResult { output: DivergenceOutput; input: DivergenceInput }`
  - `SURFACES` map has a `[DIVERGENCE_SURFACE]` entry
  - `getOrGenerateNarration` overload for the divergence surface → `Promise<DivergenceNarrationResult | null>`

- [ ] **Step 1: Add imports and the result type**

Add imports: `DIVERGENCE_SURFACE`, `divergenceOutputSchema`, `type DivergenceInput`, `type DivergenceOutput` from `@/lib/ai/schemas`; `buildDivergenceInput` from `@/lib/ai/input`. Add next to the other result interfaces:

```ts
export interface DivergenceNarrationResult {
  output: DivergenceOutput;
  input: DivergenceInput;
}
```

- [ ] **Step 2: Register the surface**

Extend the `SURFACES` map:

```ts
const SURFACES = {
  [BRIEF_SURFACE]: { buildInput: buildBriefInput },
  [DRIVER_EXPLANATIONS_SURFACE]: { buildInput: buildDriverExplanationsInput },
  [DIVERGENCE_SURFACE]: { buildInput: buildDivergenceInput },
} as const;
```

- [ ] **Step 3: Add the overload and runtime branch**

Add the overload signature next to the existing two:

```ts
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: typeof DIVERGENCE_SURFACE,
  source: NarrationSource,
): Promise<DivergenceNarrationResult | null>;
```

Add the runtime branch inside the implementation, mirroring the `BRIEF_SURFACE` block (it already handles a null-input early return — keep that shared logic):

```ts
    if (input.surface === DIVERGENCE_SURFACE) {
      const cachedOutput = await readCachedOutput(supabase, surface, inputHash, divergenceOutputSchema);
      if (cachedOutput) return { output: cachedOutput, input };
      const output = await generateNarration(input);
      if (!output) return null;
      await writeCachedOutput(supabase, surface, inputHash, input, output);
      return { output, input };
    }
```

- [ ] **Step 4: Verify types line up**

Run: `pnpm typecheck`
Expected: PASS. (If the implementation-signature return union needs widening to include `DivergenceNarrationResult`, add it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/narration.ts
git commit -m "feat(data): cache-or-generate wiring for divergence narration"
```

---

### Task 8: Divergence UI components

No unit test (no component-test infra in this repo). Verified by `pnpm typecheck` and the
Task 10 visual QA. Keep these presentational — no calculations here.

**Files:**
- Create: `src/components/dashboard/DivergenceExplainer.tsx`
- Create: `src/components/dashboard/AIDivergenceExplainer.tsx`

**Interfaces:**
- Consumes: `type DivergenceNarrationResult` from `@/lib/data/narration`; `Card` from `@/components/ui/Card`; `Info` from `lucide-react`.
- Produces:
  - `function DivergenceExplainer({ sentence }: { sentence: string }): JSX.Element` — deterministic line with an `Info` icon and a `Learn` disclosure that expands a static paragraph inline (no Academy dependency).
  - `function AIDivergenceExplainer({ template, narration }: { template: string; narration: Promise<DivergenceNarrationResult | null> }): JSX.Element` — client component that `use()`s the promise and renders `DivergenceExplainer` with the AI body when present, else the template.

- [ ] **Step 1: Create `DivergenceExplainer.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/Card";

const LEARN_COPY =
  "These track different time horizons. PFI behaves like a share price and reacts to recent cash movement; the Fundamentals Score measures your 90-day financial health. A short-term cash swing can move one without the other.";

/** Deterministic reconciliation line. State is carried by text + icon, never color alone. */
export function DivergenceExplainer({ sentence }: { sentence: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3" role="note" aria-label="How your two numbers relate">
      <p className="flex items-start gap-1.5 text-sm text-secondary">
        <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>{sentence}</span>
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1 text-xs font-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
      >
        {open ? "Hide" : "Learn"}
      </button>
      {open && <p className="mt-2 text-xs text-tertiary">{LEARN_COPY}</p>}
    </Card>
  );
}
```

- [ ] **Step 2: Create `AIDivergenceExplainer.tsx`**

```tsx
"use client";

import { use } from "react";
import { DivergenceExplainer } from "./DivergenceExplainer";
import type { DivergenceNarrationResult } from "@/lib/data/narration";

/** Swaps the AI body in for the template when narration resolves; template on null. */
export function AIDivergenceExplainer({
  template,
  narration,
}: {
  template: string;
  narration: Promise<DivergenceNarrationResult | null>;
}) {
  const result = use(narration);
  return <DivergenceExplainer sentence={result?.output.body ?? template} />;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/DivergenceExplainer.tsx src/components/dashboard/AIDivergenceExplainer.tsx
git commit -m "feat(ui): DivergenceExplainer line + AI-narrated variant"
```

---

### Task 9: Server detection + dashboard wiring

No unit test (page/dashboard wiring; matches repo convention). Verified by `pnpm typecheck`
and Task 10 visual QA.

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/HomeDashboard.tsx`

**Interfaces:**
- Consumes: `buildIndexSeries`, `indexDayChange`, `computeDivergence`, `divergenceTemplate`, `type DivergenceDirection` from `@/lib/financial-engine`; `getOrGenerateNarration`, `type DivergenceNarrationResult` from `@/lib/data/narration`; `AIDivergenceExplainer`, `DivergenceExplainer` (Task 8).
- Produces: `HomeDashboard` accepts two new props — `divergence: { direction: DivergenceDirection; template: string } | null` and `divergenceNarration: Promise<DivergenceNarrationResult | null>` — and renders the line between the PFI card and `<ScoreCard>`.

- [ ] **Step 1: Extend `HomeDashboard.tsx`**

Add to imports:

```tsx
import { Suspense } from "react"; // extend the existing react import
import { AIDivergenceExplainer } from "@/components/dashboard/AIDivergenceExplainer";
import { DivergenceExplainer } from "@/components/dashboard/DivergenceExplainer";
import type { DivergenceNarrationResult } from "@/lib/data/narration";
import type { DivergenceDirection } from "@/lib/financial-engine";
```

Extend `HomeDashboardProps`:

```tsx
  divergence: { direction: DivergenceDirection; template: string } | null;
  divergenceNarration: Promise<DivergenceNarrationResult | null>;
```

Destructure the new props in the function signature. Render the line immediately before the existing `<ScoreCard summary={scoreSummary} />`:

```tsx
      {divergence && (
        <Suspense fallback={<DivergenceExplainer sentence={divergence.template} />}>
          <AIDivergenceExplainer template={divergence.template} narration={divergenceNarration} />
        </Suspense>
      )}
      <ScoreCard summary={scoreSummary} />
```

- [ ] **Step 2: Extend `page.tsx`**

Add to the engine import: `buildIndexSeries`, `indexDayChange`, `computeDivergence`, `divergenceTemplate`, and `import type { DivergenceDirection } from "@/lib/financial-engine";`. After `narrationSource` is computed, add:

```tsx
  let divergence: { direction: DivergenceDirection; template: string } | null = null;
  if (snapshots.length > 0 && scoreSummary.state !== "suppressed") {
    const points = buildIndexSeries(snapshots).points;
    if (points.length >= 2) {
      const today = indexDayChange(points[points.length - 1].actual, points[points.length - 2]?.actual).points;
      const result = computeDivergence(today, scoreSummary.momentum);
      if (result) divergence = { direction: result.direction, template: divergenceTemplate(result, company.name) };
    }
  }

  const divergenceNarration =
    divergence && narrationSource
      ? getOrGenerateNarration(supabase, "score_index_divergence", narrationSource)
      : Promise.resolve(null);
```

Pass both to `<HomeDashboard>`:

```tsx
          divergence={divergence}
          divergenceNarration={divergenceNarration}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (props threaded through both the call site and the component).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/HomeDashboard.tsx
git commit -m "feat(dashboard): detect divergence server-side and render the explainer line"
```

---

### Task 10: Full verification + visual QA

**Files:** No source changes expected (fix-forward only if a check fails).

- [ ] **Step 1: Run the full gate**

Run: `pnpm check`
Expected: PASS — lint (0 errors), typecheck, all tests (existing + the new divergence tests), build.

- [ ] **Step 2: Visual QA at 390px and 1280px**

Use the project's Playwright harness (`e2e/global-setup.ts` mints an authed user; `webServer` auto-starts the dev server on port 3100). Write a throwaway spec under `e2e/` (delete after) that logs in via the minted magic-link URL, onboards with sample data, and screenshots the dashboard at `390×844` and `1280×900`. **Look at the screenshots.** Verify:
- On a demo profile whose PFI "Today" delta is negative while its Fundamentals Score momentum is improving (or vice versa) → the line renders between the two cards: one sentence, an `Info` icon, a `Learn` control (no color-only signalling).
- On a profile with no clash → the line is absent.
- Keyless run (no `AI_GATEWAY_API_KEY`) → the deterministic template renders.

If no demo profile naturally diverges, temporarily force the two inputs in the loader (or hand-craft the props) just to screenshot both states, then revert. A permanent e2e assertion is out of scope here because it needs a known-diverging demo fixture (none exists yet) — note it as a follow-up rather than shipping a flaky e2e.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: verification fixes for divergence explainer"
```

(Skip if no fixes were needed.)

---

## Self-review notes (author)

- **Spec coverage:** detection (Task 1), template (Task 2), narration schemas + direction guard (Task 3), prompt (Task 4), narrator branch with mislabel + direction guards (Task 5), input builder incl. suppressed-score skip (Task 6), cache-or-generate wiring (Task 7), UI + interim inline `Learn` (Task 8), server detection + placement between the two cards + suppressed skip (Task 9), binding-rule + keyless + visual verification (Task 10).
- **Out of scope (per spec):** range-picker-specific divergence; the full Academy lesson (Spec 2); any surface other than the dashboard; a permanent diverging e2e fixture.
- **Test boundary:** business logic (Tasks 1–6) is node-unit-tested; the wiring/UI (Tasks 7–9) is typecheck- + e2e-/visual-verified, because this repo has no component-test or narration-cache test infra and introducing it would be scope creep.
- **Type consistency:** `DivergenceDirection`/`DivergenceResult`/`computeDivergence`/`divergenceTemplate` (engine) → `DivergenceInput`/`DivergenceOutput`/`DIVERGENCE_SURFACE`/`bodyIsDirectionConsistent` (schemas) → `buildDivergenceInput` (input) → `DivergenceNarrationResult`/`getOrGenerateNarration` (data) → `AIDivergenceExplainer`/`DivergenceExplainer` (ui) → `page.tsx` props. Names are identical across tasks.
