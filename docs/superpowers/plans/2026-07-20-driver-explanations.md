# Per-Driver AI Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each driver card in the dashboard's "What moved your line" section expands in place to a short explanation — AI-written when a gateway key is present, deterministic code-built otherwise — generated in one AI call per period, cached under a new `driver_explanations` surface.

**Architecture:** Generalize the existing narration pipeline (`src/lib/ai/`, `src/lib/data/narration.ts`) from one hard-wired surface to a per-surface structure (discriminated input union, per-surface prompt/output-schema/guards, one generic cache-or-generate), then add the `driver_explanations` surface and an accordion UI. Spec: `docs/superpowers/specs/2026-07-20-driver-explanations-design.md`.

**Tech Stack:** Next.js 16 App Router, React 19 (`use()` + Suspense), TypeScript strict, Zod 4, AI SDK v7 (`generateObject`), Supabase (Postgres + RLS), Vitest, Playwright.

## Global Constraints

- **Deterministic code calculates; AI only narrates.** No financial formula in React components; engine additions go in `src/lib/financial-engine/` (framework-free, no React/Next imports).
- **Data boundary:** `FinancialEvent.label` and real event ids NEVER cross into any AI input — drivers are identified by the `FinancialEventType` enum and positional ids (`d1`…`d4`) only. Every input builder ends in a runtime `.parse()`.
- **Keyless = structurally identical app:** no `AI_GATEWAY_API_KEY` → deterministic explanations with a `Calculated` chip; AI path shows `AI narrative · numbers calculated`. Suspense fallback and null-result fallback render identically (no flash, no spinners).
- **Failure contract:** `generateNarration` returns `null` on every failure (8s timeout, `maxRetries: 1`, schema violation, any guard failure) and never throws; `getOrGenerateNarration` never rejects; failures never cached; logs carry error class/message only, never metric values.
- **Mobile-first:** design and visually verify at 390×844 BEFORE 1280×900.
- **Accessibility:** expand affordance is a real `<button>` with `aria-expanded`/`aria-controls` and a visible chevron (never color/motion-only); panel is a labelled region; keyboard operable.
- **Copy rules:** no advice, no shame language, `buildsEquity` framed constructively ("builds equity", never "a loss"), PFI Score never called a credit score.
- Migration numbering: next free number is **0011** (0010 is password_auth).
- `pnpm check` (lint + typecheck + test + build) green before any completion claim. Worktree note: copy `.env.local` from the main checkout into the worktree first or the build step fails on missing Supabase env vars.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration — allow the `driver_explanations` surface

**Files:**
- Create: `supabase/migrations/0011_driver_explanations_surface.sql`
- Modify: `scripts/test-rls.mts` (after the existing `ai_narrations` block, ~line 261)

**Interfaces:**
- Consumes: existing `ai_narrations` table (0009).
- Produces: DB accepts `surface = 'driver_explanations'`; later tasks' cache writes depend on this.

- [ ] **Step 1: Write the migration**

```sql
-- 0011_driver_explanations_surface.sql
-- Phase 4 slice 2 (docs/superpowers/specs/2026-07-20-driver-explanations-design.md):
-- ai_narrations gains the per-driver explanations surface. Same table, same
-- (user_id, surface, input_hash) uniqueness and RLS — only the surface
-- check constraint widens.

alter table public.ai_narrations
  drop constraint ai_narrations_surface_check;

alter table public.ai_narrations
  add constraint ai_narrations_surface_check
  check (surface in ('performance_brief', 'driver_explanations'));
```

(Postgres auto-named the inline check from 0009 `ai_narrations_surface_check`. If the drop errors, find the real name with `select conname from pg_constraint where conrelid = 'public.ai_narrations'::regclass and contype = 'c';` and adjust.)

- [ ] **Step 2: Apply to the linked project**

Run: `supabase db push`
Expected: `0011_driver_explanations_surface.sql` applied without error.

- [ ] **Step 3: Extend the RLS suite (these are the failing-then-passing checks for this task)**

Append inside the existing `ai_narrations` section of `scripts/test-rls.mts` (directly after the `nDel` check):

```ts
  // Phase 4 slice 2: the driver_explanations surface is accepted; junk is not.
  const { error: nDriverIns } = await a.client.from("ai_narrations").insert({
    ...narrationRow,
    surface: "driver_explanations",
    input_hash: "v".repeat(64),
    output_json: { explanations: [{ driverId: "d1", body: "x".repeat(40) }] },
  });
  check("A can insert a driver_explanations narration", !nDriverIns, nDriverIns?.message);

  const { error: nBadSurface } = await a.client.from("ai_narrations").insert({
    ...narrationRow,
    surface: "not_a_surface",
    input_hash: "w".repeat(64),
  });
  check("unknown surface value rejected by check constraint", !!nBadSurface);
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test:rls`
Expected: all checks pass (previous 41 + 2 new = 43/43).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_driver_explanations_surface.sql scripts/test-rls.mts
git commit -m "feat(db): allow driver_explanations surface in ai_narrations"
```

---

### Task 2: Refactor the pipeline per-surface (zero behavior change)

Pure rename/generalization so the second surface drops in cleanly. Everything still compiles, every existing test still passes, the app behaves identically.

**Files:**
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/schemas.test.ts`
- Modify: `src/lib/ai/prompts.ts`, `src/lib/ai/prompts.test.ts`
- Modify: `src/lib/ai/narrator.ts`, `src/lib/ai/narrator.test.ts`
- Modify: `src/lib/ai/input.ts`, `src/lib/ai/input.test.ts`
- Modify: `src/lib/ai/hash.ts`, `src/lib/ai/hash.test.ts`
- Modify: `src/lib/data/narration.ts`
- Modify: `src/app/page.tsx` (call site gains a `surface` argument)
- Modify: `src/components/dashboard/AIPerformanceBrief.tsx`, `src/components/dashboard/HomeDashboard.tsx` (type renames only)

**Interfaces:**
- Produces (later tasks rely on these exact names):
  - `schemas.ts`: `BRIEF_SURFACE = "performance_brief"`, `DRIVER_EXPLANATIONS_SURFACE = "driver_explanations"`, `type NarrationSurface`, `briefInputSchema`/`type BriefInput` (old `narrationInputSchema`/`NarrationInput`), `briefOutputSchema`/`type BriefOutput` (old `narrationOutputSchema`/`NarrationOutput`), `textOnlyReferencesKnownAmounts(text: string, known: ReadonlySet<number>): boolean`, `textDoesNotMislabelScore(text: string): boolean`; brief guards `referencesOnlyKnownDrivers`, `bodyOnlyReferencesKnownAmounts`, `bodyDoesNotMislabelScore` keep their signatures.
  - `prompts.ts`: `BRIEF_SYSTEM_PROMPT` (old `SYSTEM_PROMPT`), `buildUserPrompt` unchanged.
  - `input.ts`: `buildBriefInput` (old `buildNarrationInput`), `NarrationSource` unchanged.
  - `narration.ts`: `interface BriefNarrationResult { input: BriefInput; output: BriefOutput }` (old `NarrationResult`); `getOrGenerateNarration(supabase, surface: "performance_brief", source)` — surface is a new explicit argument dispatched through an internal `SURFACES` config map.

- [ ] **Step 1: Rename in `schemas.ts` and extract the text-level guard cores**

Renames: `NARRATION_SURFACE` → delete (replaced by the two surface consts), `narrationInputSchema` → `briefInputSchema`, `NarrationInput` → `BriefInput`, `narrationOutputSchema` → `briefOutputSchema`, `NarrationOutput` → `BriefOutput`. Add at the top:

```ts
export const BRIEF_SURFACE = "performance_brief" as const;
export const DRIVER_EXPLANATIONS_SURFACE = "driver_explanations" as const;
export type NarrationSurface = typeof BRIEF_SURFACE | typeof DRIVER_EXPLANATIONS_SURFACE;
```

`briefInputSchema`'s surface field becomes `z.literal(BRIEF_SURFACE)`. Extract the reusable cores and re-implement the brief guards on top of them (bodies below are the complete new implementations — the known-amount math is unchanged, only lifted):

```ts
/**
 * Core policy check shared by all surfaces: every "$"-prefixed figure in
 * `text` must round to a member of `known`. See bodyOnlyReferencesKnownAmounts
 * for the policy rationale (unchanged from the AI interpreter core slice).
 */
export function textOnlyReferencesKnownAmounts(
  text: string,
  known: ReadonlySet<number>,
): boolean {
  try {
    const matches = text.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (!matches) return true;
    return matches.every((match) => {
      const value = Number.parseFloat(match.replace(/[$,]/g, ""));
      if (Number.isNaN(value)) return false;
      return known.has(Math.round(value));
    });
  } catch {
    return false;
  }
}

/** Known-amount set for a driver array: magnitudes plus natural aggregates. */
export function driverAmountSet(drivers: ReadonlyArray<{ impact: number }>): Set<number> {
  const round = (n: number) => Math.round(n);
  const totalInflow = drivers.filter((d) => d.impact > 0).reduce((s, d) => s + d.impact, 0);
  const totalOutflow = drivers.filter((d) => d.impact < 0).reduce((s, d) => s + Math.abs(d.impact), 0);
  const netImpact = drivers.reduce((s, d) => s + d.impact, 0);
  return new Set<number>([
    ...drivers.map((d) => round(Math.abs(d.impact))),
    round(totalInflow),
    round(totalOutflow),
    round(Math.abs(netImpact)),
  ]);
}

export function bodyOnlyReferencesKnownAmounts(
  input: BriefInput,
  output: BriefOutput,
): boolean {
  const known = driverAmountSet(input.drivers);
  known.add(Math.round(input.availableCapital));
  known.add(Math.round(input.cushion));
  return textOnlyReferencesKnownAmounts(output.body, known);
}

export function textDoesNotMislabelScore(text: string): boolean {
  return !SCORE_MISLABEL_PATTERNS.some((pattern) => pattern.test(text));
}

export function bodyDoesNotMislabelScore(output: BriefOutput): boolean {
  return textDoesNotMislabelScore(output.body);
}
```

`referencesOnlyKnownDrivers(input: BriefInput, output: BriefOutput)` keeps its exact body, types renamed.

- [ ] **Step 2: Propagate renames through the module**

- `prompts.ts`: `SYSTEM_PROMPT` → `BRIEF_SYSTEM_PROMPT` (string content byte-identical — the snapshot test must NOT change); `buildUserPrompt(input: BriefInput)`.
- `narrator.ts`: type renames only (`BriefInput`/`BriefOutput`/`briefOutputSchema`, import `BRIEF_SYSTEM_PROMPT`).
- `input.ts`: `buildNarrationInput` → `buildBriefInput`, return type `BriefInput | null`, `surface: BRIEF_SURFACE` in the parsed object.
- `hash.ts`: `narrationInputHash(input: BriefInput)` (widens to the union in Task 3).
- Test files: update imports/names; snapshot files under `src/lib/ai/__snapshots__/` must not need regenerating (if `pnpm vitest run src/lib/ai` reports an obsolete/changed snapshot, the prompt string accidentally changed — fix the string, not the snapshot).

- [ ] **Step 3: Generalize `src/lib/data/narration.ts` behind a surface config**

Complete new file body (same behavior, dispatch added):

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";
import { narrationInputHash } from "@/lib/ai/hash";
import { buildBriefInput, type NarrationSource } from "@/lib/ai/input";
import { generateNarration } from "@/lib/ai/narrator";
import {
  BRIEF_SURFACE,
  briefOutputSchema,
  type BriefInput,
  type BriefOutput,
} from "@/lib/ai/schemas";

export interface BriefNarrationResult {
  output: BriefOutput;
  input: BriefInput;
}

/** Per-surface wiring: input assembly + the schema cached rows must satisfy. */
const SURFACES = {
  [BRIEF_SURFACE]: {
    buildInput: buildBriefInput,
    outputSchema: briefOutputSchema,
  },
} as const;

/**
 * Cache-or-generate for a narration surface. Returns null (and NEVER
 * rejects) on any failure so the dashboard falls back to the deterministic
 * rendering — callers pass this promise into React `use()`, where a
 * rejection would trip an error boundary instead of the intended graceful
 * fallback. Failures are not cached — the next load retries.
 */
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: keyof typeof SURFACES,
  source: NarrationSource,
): Promise<BriefNarrationResult | null> {
  try {
    if (!env.AI_GATEWAY_API_KEY) return null;
    const config = SURFACES[surface];
    const input = config.buildInput(source);
    if (!input) return null;
    const inputHash = narrationInputHash(input);

    const { data: cached, error: cacheReadError } = await supabase
      .from("ai_narrations")
      .select("output_json")
      .eq("surface", surface)
      .eq("input_hash", inputHash)
      .maybeSingle();
    if (cacheReadError) {
      // Redaction rule: log the failure class only, never metric values.
      console.error("[ai] narration cache read failed:", cacheReadError.message);
    }
    if (cached) {
      const parsed = config.outputSchema.safeParse(cached.output_json);
      if (parsed.success) return { output: parsed.data, input };
    }

    const output = await generateNarration(input);
    if (!output) return null;

    // Persistence is best-effort and isolated in its own try/catch: a
    // transient DB error writing to the cache must not discard a successful
    // generation.
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { error: upsertError } = await supabase.from("ai_narrations").upsert(
          {
            user_id: auth.user.id,
            surface,
            input_hash: inputHash,
            input_json: input,
            output_json: output,
            model: env.PFI_AI_MODEL,
          },
          { onConflict: "user_id,surface,input_hash" },
        );
        if (upsertError) {
          console.error("[ai] narration cache write failed:", upsertError.message);
        }
      }
    } catch (err) {
      console.error(
        "[ai] narration cache write failed:",
        err instanceof Error ? err.message : "unknown",
      );
    }

    return { output, input };
  } catch (err) {
    console.error(
      "[ai] narration generation failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
```

- [ ] **Step 4: Update the three consumers**

- `src/app/page.tsx`: `getOrGenerateNarration(supabase, "performance_brief", { ... })` (same source object).
- `src/components/dashboard/AIPerformanceBrief.tsx`: import `BriefNarrationResult` (was `NarrationResult`) and `BriefInput` (was `NarrationInput`); `KIND_LABELS` keying becomes `Record<BriefInput["drivers"][number]["kind"], string>`.
- `src/components/dashboard/HomeDashboard.tsx`: prop type `narration: Promise<BriefNarrationResult | null>`.

- [ ] **Step 5: Verify zero behavior change**

Run: `pnpm vitest run src/lib/ai && pnpm typecheck && pnpm lint`
Expected: all existing AI-module tests pass with no snapshot changes; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ai): per-surface narration pipeline, brief surface only (no behavior change)"
```

---

### Task 3: `driver_explanations` schemas + guards (TDD)

**Files:**
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/schemas.test.ts`
- Modify: `src/lib/ai/hash.ts` (widen input type to the union)

**Interfaces:**
- Consumes: Task 2's `DRIVER_EXPLANATIONS_SURFACE`, `narrationDriverSchema`, `textOnlyReferencesKnownAmounts`, `driverAmountSet`, `textDoesNotMislabelScore`.
- Produces: `driverExplanationsInputSchema`/`type DriverExplanationsInput`, `driverExplanationsOutputSchema`/`type DriverExplanationsOutput`, `narrationInputSchema` (discriminated union)/`type NarrationInput`, guards `explanationsCoverExactlyKnownDrivers(input, output)`, `explanationAmountsAreKnown(input, output)`, `explanationsDoNotMislabelScore(output)`.

- [ ] **Step 1: Write the failing tests** (append to `schemas.test.ts`)

```ts
import {
  driverExplanationsInputSchema,
  driverExplanationsOutputSchema,
  explanationsCoverExactlyKnownDrivers,
  explanationAmountsAreKnown,
  explanationsDoNotMislabelScore,
  narrationInputSchema,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
} from "./schemas";

const driverInput: DriverExplanationsInput = {
  surface: "driver_explanations",
  companyName: "Test Co",
  periodDays: 30,
  totalInflow: 6900,
  totalOutflow: 2200,
  netImpact: 4700,
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-03", impact: 3450, buildsEquity: false },
    { id: "d2", kind: "mortgage_payment", date: "2026-07-01", impact: -2200, buildsEquity: false },
  ],
};

const goodOutput: DriverExplanationsOutput = {
  explanations: [
    { driverId: "d1", body: "A paycheck added $3,450 to available capital this period." },
    { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
  ],
};

describe("driverExplanationsInputSchema", () => {
  it("accepts a valid input", () => {
    expect(driverExplanationsInputSchema.parse(driverInput)).toEqual(driverInput);
  });
  it("rejects an empty driver array (no drivers means no call)", () => {
    expect(
      driverExplanationsInputSchema.safeParse({ ...driverInput, drivers: [] }).success,
    ).toBe(false);
  });
  it("rejects unknown fields (strict boundary)", () => {
    expect(
      driverExplanationsInputSchema.safeParse({ ...driverInput, label: "smuggled" }).success,
    ).toBe(false);
  });
  it("round-trips through the discriminated union", () => {
    expect(narrationInputSchema.parse(driverInput)).toEqual(driverInput);
  });
});

describe("driverExplanationsOutputSchema", () => {
  it("accepts a valid output", () => {
    expect(driverExplanationsOutputSchema.parse(goodOutput)).toEqual(goodOutput);
  });
  it("rejects a body under 20 chars", () => {
    const short = { explanations: [{ driverId: "d1", body: "too short" }] };
    expect(driverExplanationsOutputSchema.safeParse(short).success).toBe(false);
  });
  it("rejects a body over 280 chars", () => {
    const long = { explanations: [{ driverId: "d1", body: "x".repeat(281) }] };
    expect(driverExplanationsOutputSchema.safeParse(long).success).toBe(false);
  });
});

describe("explanationsCoverExactlyKnownDrivers", () => {
  it("passes when ids match exactly", () => {
    expect(explanationsCoverExactlyKnownDrivers(driverInput, goodOutput)).toBe(true);
  });
  it("fails when a driver is missing (whole set falls back)", () => {
    const missing = { explanations: [goodOutput.explanations[0]] };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, missing)).toBe(false);
  });
  it("fails on an invented driver id", () => {
    const invented = {
      explanations: [...goodOutput.explanations, { driverId: "d9", body: "x".repeat(30) }],
    };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, invented)).toBe(false);
  });
  it("fails on duplicate ids", () => {
    const dupes = {
      explanations: [goodOutput.explanations[0], { ...goodOutput.explanations[0] }],
    };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, dupes)).toBe(false);
  });
});

describe("explanationAmountsAreKnown", () => {
  it("passes when every figure is a driver magnitude or aggregate", () => {
    expect(explanationAmountsAreKnown(driverInput, goodOutput)).toBe(true);
  });
  it("accepts the aggregate figures (inflow/outflow/net)", () => {
    const agg = {
      explanations: [
        { driverId: "d1", body: "Inflows totaling $6,900 outweighed $2,200 of outflows." },
        { driverId: "d2", body: "Net driver movement this period came to $4,700." },
      ],
    };
    expect(explanationAmountsAreKnown(driverInput, agg)).toBe(true);
  });
  it("fails on a hallucinated figure", () => {
    const bad = {
      explanations: [
        { driverId: "d1", body: "A paycheck added $9,999 to available capital." },
        goodOutput.explanations[1],
      ],
    };
    expect(explanationAmountsAreKnown(driverInput, bad)).toBe(false);
  });
});

describe("explanationsDoNotMislabelScore", () => {
  it("fails when any body says credit score", () => {
    const bad = {
      explanations: [
        { driverId: "d1", body: "This paycheck should help your credit score improve." },
        goodOutput.explanations[1],
      ],
    };
    expect(explanationsDoNotMislabelScore(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Implement in `schemas.ts`**

```ts
export const driverExplanationsInputSchema = z
  .object({
    surface: z.literal(DRIVER_EXPLANATIONS_SURFACE),
    companyName: z.string().min(1),
    periodDays: z.number().int().positive(),
    /** Sum of positive driver impacts (dollars). */
    totalInflow: z.number().min(0),
    /** Sum of negative driver impact magnitudes (dollars). */
    totalOutflow: z.number().min(0),
    /** Signed net of all driver impacts. */
    netImpact: z.number(),
    drivers: z.array(narrationDriverSchema).min(1).max(4),
  })
  .strict();

/** All AI inputs, discriminated on surface — the one type hash/narrator accept. */
export const narrationInputSchema = z.discriminatedUnion("surface", [
  briefInputSchema,
  driverExplanationsInputSchema,
]);

export type DriverExplanationsInput = z.infer<typeof driverExplanationsInputSchema>;
export type NarrationInput = z.infer<typeof narrationInputSchema>;

export const driverExplanationsOutputSchema = z
  .object({
    /** One short explanation per input driver, keyed by its internal id. */
    explanations: z
      .array(
        z
          .object({
            driverId: z.string().regex(/^d\d+$/),
            body: z.string().min(20).max(280),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export type DriverExplanationsOutput = z.infer<typeof driverExplanationsOutputSchema>;

/**
 * Policy check: exactly one explanation per known driver — none invented,
 * none missing, no duplicates. A missing driver invalidates the whole set
 * (the UI would otherwise show a mixed AI/deterministic accordion for one
 * generation, which reads as inconsistency, not graceful degradation).
 */
export function explanationsCoverExactlyKnownDrivers(
  input: DriverExplanationsInput,
  output: DriverExplanationsOutput,
): boolean {
  const known = input.drivers.map((d) => d.id).sort();
  const got = output.explanations.map((e) => e.driverId).sort();
  return known.length === got.length && known.every((id, i) => id === got[i]);
}

/** Policy check: every dollar figure in every body is a known amount. */
export function explanationAmountsAreKnown(
  input: DriverExplanationsInput,
  output: DriverExplanationsOutput,
): boolean {
  const known = driverAmountSet(input.drivers);
  return output.explanations.every((e) => textOnlyReferencesKnownAmounts(e.body, known));
}

/** Policy check: no body mislabels the PFI Score (defense-in-depth). */
export function explanationsDoNotMislabelScore(output: DriverExplanationsOutput): boolean {
  return output.explanations.every((e) => textDoesNotMislabelScore(e.body));
}
```

In `hash.ts`, widen the parameter: `export function narrationInputHash(input: NarrationInput): string` (import the union type).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts src/lib/ai/hash.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/schemas.test.ts src/lib/ai/hash.ts
git commit -m "feat(ai): driver_explanations input/output schemas and guards"
```

---

### Task 4: Per-surface prompts

**Files:**
- Modify: `src/lib/ai/prompts.ts`, `src/lib/ai/prompts.test.ts`

**Interfaces:**
- Produces: `SYSTEM_PROMPTS: Record<NarrationSurface, string>` (entry per surface; `BRIEF_SYSTEM_PROMPT` stays exported and byte-identical), `buildUserPrompt(input: NarrationInput)` dispatching on `input.surface`.

- [ ] **Step 1: Write the failing tests** (append to `prompts.test.ts`)

```ts
import { SYSTEM_PROMPTS, BRIEF_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

describe("driver_explanations prompt", () => {
  it("brief entry is the unchanged brief prompt", () => {
    expect(SYSTEM_PROMPTS.performance_brief).toBe(BRIEF_SYSTEM_PROMPT);
  });
  it("snapshot makes wording changes deliberate", () => {
    expect(SYSTEM_PROMPTS.driver_explanations).toMatchSnapshot();
  });
  it("user prompt embeds the input JSON and period", () => {
    const prompt = buildUserPrompt({
      surface: "driver_explanations",
      companyName: "Test Co",
      periodDays: 30,
      totalInflow: 100,
      totalOutflow: 0,
      netImpact: 100,
      drivers: [{ id: "d1", kind: "paycheck", date: "2026-07-03", impact: 100, buildsEquity: false }],
    });
    expect(prompt).toContain("last 30 days");
    expect(prompt).toContain('"d1"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: FAIL — `SYSTEM_PROMPTS` not exported.

- [ ] **Step 3: Implement in `prompts.ts`**

```ts
import type { NarrationInput, NarrationSurface } from "./schemas";

// BRIEF_SYSTEM_PROMPT stays exactly as-is (snapshot-pinned).

/**
 * Encodes docs/AI_RECOMMENDATION_POLICY.md for the per-driver explanation
 * surface. The snapshot test in prompts.test.ts makes wording changes
 * deliberate.
 */
export const DRIVER_EXPLANATIONS_SYSTEM_PROMPT = `You explain the individual financial events ("drivers") that moved a household's financial line, in the voice of a neutral analyst covering a small company. You will receive a JSON object of verified, pre-calculated metrics. Rules, in priority order:

1. Use ONLY the figures provided. Never invent, recalculate, or extrapolate numbers. Every dollar figure you mention must be a driver's amount or one of the provided totals (totalInflow, totalOutflow, netImpact).
2. Return exactly one explanation per driver in the input — none skipped, none invented — identifying each by its id in the driverId field only.
3. Driver ids (d1, d2, ...) are internal — never write them in the explanation prose itself.
4. Each explanation is 1–2 plain-language sentences: what kind of event it was, when, and how it moved available capital. Explanations may relate a driver to the others ("the largest single movement this period") but must not repeat each other.
5. Drivers with buildsEquity=true reduce cash but build owner-created equity; present them constructively — money moved into equity, never a loss.
6. No advice of any kind: no securities, no tax or legal conclusions, no guarantees, no "you should". You describe what happened; you do not prescribe.
7. Never call anything a credit score, credit rating, or FICO score.
8. Tone: no shame-oriented language, no celebration of extreme austerity. This is educational analysis, not financial, tax, legal, or investment advice — do not claim otherwise.`;

export const SYSTEM_PROMPTS: Record<NarrationSurface, string> = {
  performance_brief: BRIEF_SYSTEM_PROMPT,
  driver_explanations: DRIVER_EXPLANATIONS_SYSTEM_PROMPT,
};

export function buildUserPrompt(input: NarrationInput): string {
  if (input.surface === "driver_explanations") {
    return `Explain each of these drivers of the household's line over the last ${input.periodDays} days. Verified metrics:

${JSON.stringify(input, null, 2)}`;
  }
  return `Narrate this performance brief covering the last ${input.periodDays} days. Verified metrics:

${JSON.stringify(input, null, 2)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: PASS (one new snapshot written; the brief snapshot unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts.ts src/lib/ai/prompts.test.ts src/lib/ai/__snapshots__
git commit -m "feat(ai): driver_explanations system prompt and per-surface prompt table"
```

---

### Task 5: Narrator dispatch for the new surface

**Files:**
- Modify: `src/lib/ai/narrator.ts`, `src/lib/ai/narrator.test.ts`

**Interfaces:**
- Consumes: Task 3 schemas/guards, Task 4 `SYSTEM_PROMPTS`.
- Produces: overloaded `generateNarration` — `(input: BriefInput, opts?) => Promise<BriefOutput | null>` and `(input: DriverExplanationsInput, opts?) => Promise<DriverExplanationsOutput | null>`. Same failure contract (null on everything).

- [ ] **Step 1: Write the failing tests** (append to `narrator.test.ts`; use the existing mock-model helper in that file — it stubs `generateObject` via the `model` DI option with AI SDK's `MockLanguageModelV3`-style doGenerate; follow the established pattern in the file for constructing a mock that returns a given JSON object)

```ts
const driverInput: DriverExplanationsInput = {
  surface: "driver_explanations",
  companyName: "Test Co",
  periodDays: 30,
  totalInflow: 3450,
  totalOutflow: 2200,
  netImpact: 1250,
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-03", impact: 3450, buildsEquity: false },
    { id: "d2", kind: "mortgage_payment", date: "2026-07-01", impact: -2200, buildsEquity: false },
  ],
};

describe("generateNarration (driver_explanations)", () => {
  it("returns validated explanations from a well-behaved model", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "A paycheck added $3,450 to available capital." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    const result = await generateNarration(driverInput, { model });
    expect(result?.explanations).toHaveLength(2);
  });

  it("returns null when a driver is missing from the output", async () => {
    const model = mockModelReturning({
      explanations: [{ driverId: "d1", body: "A paycheck added $3,450 to available capital." }],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });

  it("returns null on a hallucinated dollar figure", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "A paycheck added $7,777 to available capital." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });

  it("returns null when a body mislabels the score", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "This paycheck is great for your credit score overall." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts`
Expected: FAIL — overload/type errors (narrator still brief-only).

- [ ] **Step 3: Implement the dispatch** (complete new `narrator.ts`)

```ts
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { env } from "@/lib/config/env";
import { SYSTEM_PROMPTS, buildUserPrompt } from "./prompts";
import {
  briefOutputSchema,
  driverExplanationsOutputSchema,
  referencesOnlyKnownDrivers,
  bodyOnlyReferencesKnownAmounts,
  bodyDoesNotMislabelScore,
  explanationsCoverExactlyKnownDrivers,
  explanationAmountsAreKnown,
  explanationsDoNotMislabelScore,
  type BriefInput,
  type BriefOutput,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
  type NarrationInput,
} from "./schemas";

export interface NarratorOptions {
  /** DI/test override; defaults to the gateway model string from env. */
  model?: LanguageModel;
  timeoutMs?: number;
}

/**
 * Provider-agnostic narration call, dispatched per surface. Returns null on
 * EVERY failure — missing key, provider error, timeout, schema violation,
 * or any deterministic policy-guard failure — so callers fall back to the
 * deterministic rendering and unvalidated text is never shown.
 */
export async function generateNarration(
  input: BriefInput,
  opts?: NarratorOptions,
): Promise<BriefOutput | null>;
export async function generateNarration(
  input: DriverExplanationsInput,
  opts?: NarratorOptions,
): Promise<DriverExplanationsOutput | null>;
export async function generateNarration(
  input: NarrationInput,
  opts: NarratorOptions = {},
): Promise<BriefOutput | DriverExplanationsOutput | null> {
  const model =
    opts.model ?? (env.AI_GATEWAY_API_KEY ? env.PFI_AI_MODEL : undefined);
  if (!model) return null;
  if (input.surface === "performance_brief") {
    const output = await generate(model, input, briefOutputSchema, opts);
    if (!output) return null;
    if (!referencesOnlyKnownDrivers(input, output)) return null;
    if (!bodyOnlyReferencesKnownAmounts(input, output)) return null;
    if (!bodyDoesNotMislabelScore(output)) return null;
    return output;
  }
  const output = await generate(model, input, driverExplanationsOutputSchema, opts);
  if (!output) return null;
  if (!explanationsCoverExactlyKnownDrivers(input, output)) return null;
  if (!explanationAmountsAreKnown(input, output)) return null;
  if (!explanationsDoNotMislabelScore(output)) return null;
  return output;
}

async function generate<Schema extends z.ZodType>(
  model: LanguageModel,
  input: NarrationInput,
  schema: Schema,
  opts: NarratorOptions,
): Promise<z.infer<Schema> | null> {
  try {
    const { object } = await generateObject({
      model,
      schema,
      system: SYSTEM_PROMPTS[input.surface],
      prompt: buildUserPrompt(input),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      temperature: 0.4,
    });
    return object;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts && pnpm typecheck`
Expected: PASS (existing brief tests untouched and green), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/narrator.ts src/lib/ai/narrator.test.ts
git commit -m "feat(ai): narrator dispatch and guards for driver_explanations"
```

---

### Task 6: Input assembly for driver explanations

**Files:**
- Modify: `src/lib/ai/input.ts`, `src/lib/ai/input.test.ts`

**Interfaces:**
- Consumes: Task 3 `driverExplanationsInputSchema`, `DRIVER_EXPLANATIONS_SURFACE`; existing engine functions.
- Produces: `buildDriverExplanationsInput(source: NarrationSource): DriverExplanationsInput | null`. Driver ids are positional `d1`…`dN` over `computeDrivers`' sorted order for the same fixed 30-day window `buildBriefInput` uses — the UI's index-based matching (Task 8) depends on this.

- [ ] **Step 1: Write the failing tests** (append to `input.test.ts`, reusing that file's existing snapshot/event fixtures)

```ts
describe("buildDriverExplanationsInput", () => {
  it("assembles totals and positional driver ids from engine outputs", () => {
    const input = buildDriverExplanationsInput(source);
    expect(input).not.toBeNull();
    expect(input!.surface).toBe("driver_explanations");
    expect(input!.drivers.map((d) => d.id)).toEqual(
      input!.drivers.map((_, i) => `d${i + 1}`),
    );
    const inflow = input!.drivers.filter((d) => d.impact > 0).reduce((s, d) => s + d.impact, 0);
    expect(input!.totalInflow).toBeCloseTo(inflow, 2);
  });

  it("never leaks an event label or real event id across the boundary", () => {
    const input = buildDriverExplanationsInput(source);
    const json = JSON.stringify(input);
    for (const event of source.events) {
      expect(json).not.toContain(event.label);
      expect(json).not.toContain(event.id);
    }
  });

  it("returns null when there are no snapshots", () => {
    expect(buildDriverExplanationsInput({ ...source, snapshots: [] })).toBeNull();
  });

  it("returns null when the window has no drivers", () => {
    expect(buildDriverExplanationsInput({ ...source, events: [] })).toBeNull();
  });

  it("matches buildBriefInput's window: same drivers, same order, same ids", () => {
    const brief = buildBriefInput(source);
    const exp = buildDriverExplanationsInput(source);
    expect(exp!.drivers).toEqual(brief!.drivers);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/input.test.ts`
Expected: FAIL — `buildDriverExplanationsInput` not exported.

- [ ] **Step 3: Implement** (in `input.ts`; extract the shared window logic so the two builders can't drift)

```ts
import {
  DRIVER_EXPLANATIONS_SURFACE,
  driverExplanationsInputSchema,
  type DriverExplanationsInput,
} from "./schemas";

interface WindowDrivers {
  periodDays: number;
  driverInputs: NarrationInput["drivers"];
}

/**
 * Shared 30-day window + driver mapping used by BOTH builders. Positional
 * ids over computeDrivers' sorted order — the accordion UI matches its own
 * computeDrivers output to these by index, which is only sound because both
 * surfaces derive from this single function.
 */
function windowDrivers(source: NarrationSource): WindowDrivers | null {
  const { snapshots, events } = source;
  if (snapshots.length === 0) return null;
  const { points } = buildIndexSeries(snapshots);
  if (points.length === 0) return null;
  const visible = points.slice(-NARRATION_WINDOW_DAYS);
  const drivers = computeDrivers(events, {
    start: visible[0].date,
    end: visible[visible.length - 1].date,
  });
  const cents = (n: number) => Math.round(n * 100) / 100;
  return {
    periodDays: visible.length,
    driverInputs: drivers.map((d, i) => ({
      id: `d${i + 1}`,
      kind: d.event.type,
      date: d.event.date,
      impact: cents(d.impact),
      buildsEquity: driverDisplay(d).buildsEquity,
    })),
  };
}

export function buildDriverExplanationsInput(
  source: NarrationSource,
): DriverExplanationsInput | null {
  const window = windowDrivers(source);
  if (!window || window.driverInputs.length === 0) return null;
  const cents = (n: number) => Math.round(n * 100) / 100;
  const totalInflow = window.driverInputs
    .filter((d) => d.impact > 0)
    .reduce((s, d) => s + d.impact, 0);
  const totalOutflow = window.driverInputs
    .filter((d) => d.impact < 0)
    .reduce((s, d) => s + Math.abs(d.impact), 0);
  const netImpact = window.driverInputs.reduce((s, d) => s + d.impact, 0);
  return driverExplanationsInputSchema.parse({
    surface: DRIVER_EXPLANATIONS_SURFACE,
    companyName: source.companyName,
    periodDays: window.periodDays,
    totalInflow: cents(totalInflow),
    totalOutflow: cents(totalOutflow),
    netImpact: cents(netImpact),
    drivers: window.driverInputs,
  });
}
```

Refactor `buildBriefInput` to consume `windowDrivers(source)` for its `periodDays` and `drivers` fields (its other fields — availableCapital, cushion, vsBaseline, vsWaterline, momentum, score — stay exactly as they are; it still recomputes `visible`/`latest` internally or the helper can return them too — implementer's choice, but the driver mapping must come from the shared helper).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/ai/input.test.ts && pnpm typecheck`
Expected: PASS including all pre-existing `buildBriefInput` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/input.ts src/lib/ai/input.test.ts
git commit -m "feat(ai): buildDriverExplanationsInput with shared window/driver mapping"
```

---

### Task 7: Engine — shared event-type labels + deterministic explanation text

**Files:**
- Modify: `src/lib/financial-engine/insights.ts`, `src/lib/financial-engine/insights.test.ts`
- Modify: `src/components/dashboard/AIPerformanceBrief.tsx` (drop its private `KIND_LABELS` for the shared map)

**Interfaces:**
- Produces: `EVENT_TYPE_LABELS: Record<FinancialEventType, string>` and `driverExplanationText(driver: Driver, context: { totalMovement: number }): string` — both exported through the engine barrel (`index.ts` already re-exports `./insights`). `totalMovement` = sum of `Math.abs(impact)` across the displayed drivers; callers compute it.

- [ ] **Step 1: Write the failing tests** (append to `insights.test.ts`)

```ts
import { driverExplanationText, EVENT_TYPE_LABELS } from "./insights";

describe("driverExplanationText", () => {
  const paycheck: Driver = {
    event: { id: "e1", date: "2026-07-03", type: "paycheck", label: "Acme payroll", amount: 3450, direction: "inflow" },
    impact: 3450,
  };
  const mortgage: Driver = {
    event: { id: "e2", date: "2026-07-01", type: "mortgage_payment", label: "Home loan", amount: 2200, direction: "outflow" },
    impact: -2200,
  };
  const investment: Driver = {
    event: { id: "e3", date: "2026-07-10", type: "investment_contribution", label: "401k", amount: 500, direction: "outflow" },
    impact: -500,
  };
  const total = 3450 + 2200 + 500;

  it("describes an inflow with amount, date, and share of movement", () => {
    const text = driverExplanationText(paycheck, { totalMovement: total });
    expect(text).toContain("Paycheck");
    expect(text).toContain("$3,450");
    expect(text).toContain("Jul 3");
    expect(text).toContain("56%");
    expect(text).not.toContain("Acme payroll"); // type-derived, parity with the AI path
  });

  it("describes an outflow as reducing available capital", () => {
    const text = driverExplanationText(mortgage, { totalMovement: total });
    expect(text).toContain("reduced available capital");
    expect(text).toContain("$2,200");
  });

  it("frames equity-building outflows constructively, never as losses", () => {
    const text = driverExplanationText(investment, { totalMovement: total });
    expect(text).toContain("equity");
    expect(text).not.toMatch(/loss(?!\w)/i);
  });

  it("omits the share clause when totalMovement is zero", () => {
    const text = driverExplanationText(paycheck, { totalMovement: 0 });
    expect(text).not.toContain("%");
  });

  it("has a label for every event type", () => {
    const types: FinancialEventType[] = [
      "paycheck", "bonus", "mortgage_payment", "large_purchase", "insurance_payment",
      "investment_contribution", "debt_payment", "debt_payoff", "tax_payment", "unexpected_expense",
    ];
    for (const t of types) expect(EVENT_TYPE_LABELS[t]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/financial-engine/insights.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement in `insights.ts`** (add imports `formatDollars`, `formatShortDate` from `./format`)

```ts
/** Type-derived display names. Shared by the AI disclosure UI and the
 * deterministic explanations so wording can't drift between the two paths. */
export const EVENT_TYPE_LABELS: Record<FinancialEventType, string> = {
  paycheck: "Paycheck",
  bonus: "Bonus",
  mortgage_payment: "Mortgage payment",
  large_purchase: "Large purchase",
  insurance_payment: "Insurance payment",
  investment_contribution: "Investment contribution",
  debt_payment: "Debt payment",
  debt_payoff: "Debt payoff",
  tax_payment: "Tax payment",
  unexpected_expense: "Unexpected expense",
};

/**
 * Deterministic per-driver explanation — the keyless/fallback counterpart of
 * the AI-narrated version. Type-derived wording only (parity with the AI
 * data boundary); the card above it already shows the user's own label.
 */
export function driverExplanationText(
  driver: Driver,
  context: { totalMovement: number },
): string {
  const display = driverDisplay(driver);
  const name = EVENT_TYPE_LABELS[driver.event.type];
  const when = formatShortDate(driver.event.date);
  const amount = formatDollars(Math.abs(driver.impact));
  const share =
    context.totalMovement > 0
      ? Math.round((Math.abs(driver.impact) / context.totalMovement) * 100)
      : 0;
  const shareText = share > 0 ? ` — ${share}% of this period's driver movement` : "";
  if (display.buildsEquity) {
    return `${name} on ${when} moved ${amount} from cash into owner-created equity${shareText}. It reduces cash on hand but builds equity you own.`;
  }
  if (driver.impact >= 0) {
    return `${name} on ${when} added ${amount} to available capital${shareText}.`;
  }
  return `${name} on ${when} reduced available capital by ${amount}${shareText}.`;
}
```

In `AIPerformanceBrief.tsx`, delete the private `KIND_LABELS` and use `EVENT_TYPE_LABELS` from `@/lib/financial-engine` in the disclosure list.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/financial-engine/insights.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/insights.ts src/lib/financial-engine/insights.test.ts src/components/dashboard/AIPerformanceBrief.tsx
git commit -m "feat(engine): EVENT_TYPE_LABELS and deterministic driverExplanationText"
```

---

### Task 8: Accordion UI + data wiring

**Files:**
- Modify: `src/components/dashboard/WhatMovedYourLine.tsx` (accordion restructure)
- Create: `src/components/dashboard/AIWhatMovedYourLine.tsx` (Suspense/`use()` wrapper)
- Modify: `src/components/dashboard/HomeDashboard.tsx` (new prop + Suspense wiring)
- Modify: `src/app/page.tsx` (second narration promise)
- Modify: `src/lib/data/narration.ts` (add the `driver_explanations` entry + result type/overloads)

**Interfaces:**
- Consumes: `driverExplanationText`, `EVENT_TYPE_LABELS` (Task 7); `buildDriverExplanationsInput`, `driverExplanationsOutputSchema`, types (Tasks 3/6); narrator dispatch (Task 5).
- Produces: `narration.ts` exports `interface DriverExplanationsResult { input: DriverExplanationsInput; output: DriverExplanationsOutput }` and the overload `getOrGenerateNarration(supabase, "driver_explanations", source): Promise<DriverExplanationsResult | null>`; `WhatMovedYourLine` props become `{ drivers: Driver[]; aiResult: DriverExplanationsResult | null }`.

- [ ] **Step 1: Extend `narration.ts`**

Add to the `SURFACES` map and the signature:

```ts
import { buildBriefInput, buildDriverExplanationsInput, type NarrationSource } from "@/lib/ai/input";
import {
  BRIEF_SURFACE,
  DRIVER_EXPLANATIONS_SURFACE,
  briefOutputSchema,
  driverExplanationsOutputSchema,
  type BriefInput,
  type BriefOutput,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
} from "@/lib/ai/schemas";

export interface DriverExplanationsResult {
  output: DriverExplanationsOutput;
  input: DriverExplanationsInput;
}

const SURFACES = {
  [BRIEF_SURFACE]: {
    buildInput: buildBriefInput,
    outputSchema: briefOutputSchema,
  },
  [DRIVER_EXPLANATIONS_SURFACE]: {
    buildInput: buildDriverExplanationsInput,
    outputSchema: driverExplanationsOutputSchema,
  },
} as const;

export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: typeof BRIEF_SURFACE,
  source: NarrationSource,
): Promise<BriefNarrationResult | null>;
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: typeof DRIVER_EXPLANATIONS_SURFACE,
  source: NarrationSource,
): Promise<DriverExplanationsResult | null>;
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: keyof typeof SURFACES,
  source: NarrationSource,
): Promise<BriefNarrationResult | DriverExplanationsResult | null> {
  // body unchanged from Task 2 except: `generateNarration(input)` needs the
  // narrowed input type — dispatch explicitly:
  //   const output = input.surface === "performance_brief"
  //     ? await generateNarration(input)
  //     : await generateNarration(input);
  // (the discriminated check narrows `input` so each call hits the right overload)
  ...
}
```

- [ ] **Step 2: Update `page.tsx`** — build both promises from one shared source object:

```ts
  const narrationSource =
    snapshots.length > 0
      ? {
          companyName: company.name,
          snapshots,
          events,
          score:
            scoreSummary.overall !== null
              ? { overall: scoreSummary.overall, band: scoreSummary.band, momentum: scoreSummary.momentum }
              : null,
        }
      : null;

  // Not awaited: unwrapped inside Suspense boundaries via React use(); the
  // promises never reject (null = deterministic fallback).
  const narration = narrationSource
    ? getOrGenerateNarration(supabase, "performance_brief", narrationSource)
    : Promise.resolve(null);
  const driverNarration = narrationSource
    ? getOrGenerateNarration(supabase, "driver_explanations", narrationSource)
    : Promise.resolve(null);
```

Pass `driverNarration={driverNarration}` to `HomeDashboard`.

- [ ] **Step 3: Rewrite `WhatMovedYourLine.tsx`** (complete file)

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  Home,
  PiggyBank,
  Receipt,
  Shield,
  Star,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import {
  driverDisplay,
  driverExplanationText,
  EVENT_TYPE_LABELS,
  formatDollars,
  type Driver,
} from "@/lib/financial-engine";
import { formatShortDate, formatSignedDollars } from "@/lib/financial-engine/format";
import type { FinancialEventType } from "@/lib/financial-engine/types";
import type { DriverExplanationsResult } from "@/lib/data/narration";

export const eventIcons: Record<FinancialEventType, LucideIcon> = {
  paycheck: Banknote,
  bonus: Star,
  mortgage_payment: Home,
  large_purchase: Receipt,
  insurance_payment: Shield,
  investment_contribution: TrendingUp,
  debt_payment: CreditCard,
  debt_payoff: CreditCard,
  tax_payment: Receipt,
  unexpected_expense: Receipt,
};

/**
 * The AI explanation for a driver, matched defensively: the AI input was
 * built over the default 30-day window, but the UI's drivers follow the
 * selected chart range. A driver only gets its AI text when it is
 * demonstrably the same event (position, type, date, and rounded impact all
 * agree); otherwise that panel falls back to the deterministic text. Range
 * switches therefore degrade per-card, gracefully, by construction.
 */
function aiBodyFor(
  driver: Driver,
  index: number,
  result: DriverExplanationsResult | null,
): string | null {
  if (!result) return null;
  const d = result.input.drivers[index];
  if (!d || d.kind !== driver.event.type || d.date !== driver.event.date) return null;
  if (Math.round(d.impact) !== Math.round(driver.impact)) return null;
  return result.output.explanations.find((e) => e.driverId === d.id)?.body ?? null;
}

/**
 * Deterministic "What moved your line" accordion. Drivers come straight
 * from the engine; the AI layer supplies wording only (aiResult null =
 * keyless/loading/failed, and every panel still works deterministically).
 */
export function WhatMovedYourLine({
  drivers,
  aiResult,
}: {
  drivers: Driver[];
  aiResult: DriverExplanationsResult | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (drivers.length === 0) {
    return (
      <p className="rounded-card border border-border-subtle bg-elevated p-4 text-sm text-secondary">
        No significant financial events in this period.
      </p>
    );
  }

  const totalMovement = drivers.reduce((s, d) => s + Math.abs(d.impact), 0);
  const expanded = drivers.find((d) => d.event.id === expandedId) ?? null;
  const expandedIndex = expanded ? drivers.indexOf(expanded) : -1;
  const expandedAiBody = expanded ? aiBodyFor(expanded, expandedIndex, aiResult) : null;

  return (
    <div>
      <ul className="grid grid-cols-4 gap-2 md:gap-3">
        {drivers.map((driver) => {
          const { event } = driver;
          const display = driverDisplay(driver);
          const Icon = eventIcons[event.type] ?? Receipt;
          const positive = display.tone === "positive";
          const isOpen = expandedId === event.id;
          return (
            <li key={event.id}>
              <button
                type="button"
                id={`driver-card-${event.id}`}
                aria-expanded={isOpen}
                aria-controls={`driver-panel-${event.id}`}
                aria-label={`${event.label}, ${formatSignedDollars(display.displayAmount)} on ${formatShortDate(event.date)}. ${isOpen ? "Hide" : "Show"} explanation`}
                onClick={() => setExpandedId(isOpen ? null : event.id)}
                className="block h-full w-full text-left"
              >
                <Card
                  className={`flex h-full min-h-24 flex-col justify-between gap-1 p-2.5 transition-colors hover:border-border-strong sm:min-h-28 sm:p-4 ${
                    isOpen ? "border-border-strong" : ""
                  }`}
                >
                  <span className="flex items-start justify-between">
                    <span
                      aria-hidden
                      className={`flex size-7 items-center justify-center rounded-full sm:size-9 ${
                        positive ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"
                      }`}
                    >
                      {display.buildsEquity ? <PiggyBank size={15} /> : <Icon size={15} />}
                    </span>
                    <ChevronDown
                      aria-hidden
                      size={14}
                      className={`shrink-0 text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                  <p className="truncate text-[11px] leading-tight font-medium text-primary sm:text-sm">
                    {event.label}
                  </p>
                  <p
                    className={`tabular text-xs font-semibold sm:text-sm ${
                      positive ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatSignedDollars(display.displayAmount)}
                  </p>
                  <p className="text-[10px] text-tertiary sm:text-xs">{formatShortDate(event.date)}</p>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>
      {expanded && (
        <DriverPanel
          driver={expanded}
          aiBody={expandedAiBody}
          totalMovement={totalMovement}
        />
      )}
    </div>
  );
}

function DriverPanel({
  driver,
  aiBody,
  totalMovement,
}: {
  driver: Driver;
  aiBody: string | null;
  totalMovement: number;
}) {
  const { event } = driver;
  const display = driverDisplay(driver);
  const body = aiBody ?? driverExplanationText(driver, { totalMovement });
  const share = totalMovement > 0 ? Math.round((Math.abs(driver.impact) / totalMovement) * 100) : 0;
  return (
    <div
      id={`driver-panel-${event.id}`}
      role="region"
      aria-labelledby={`driver-card-${event.id}`}
      className="mt-2"
    >
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-primary">{event.label}</p>
          <span className="shrink-0 rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
            {aiBody ? "AI narrative · numbers calculated" : "Calculated"}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-secondary">{body}</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-tertiary">
            How is this generated?
          </summary>
          <div className="mt-2 flex flex-col gap-1 text-xs text-tertiary">
            <p>
              {aiBody
                ? "The wording is AI-written from these verified, code-calculated facts only — the AI never sees raw transactions and cannot change any number:"
                : "Built directly from these verified, code-calculated facts:"}
            </p>
            <ul className="list-disc pl-4">
              <li>{EVENT_TYPE_LABELS[event.type]} on {event.date}</li>
              <li>Impact on available capital: {formatDollars(driver.impact)}</li>
              {display.buildsEquity && <li>Builds owner-created equity</li>}
              {share > 0 && <li>{share}% of this period&#39;s total driver movement</li>}
            </ul>
          </div>
        </details>
        <Link
          href={`/transactions?from=${event.date}&to=${event.date}&label=${encodeURIComponent(event.label)}`}
          className="mt-3 inline-block text-sm font-medium text-primary underline decoration-dotted underline-offset-2 hover:text-secondary"
        >
          View transactions →
        </Link>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Create `AIWhatMovedYourLine.tsx`**

```tsx
"use client";

import { use } from "react";
import { WhatMovedYourLine } from "@/components/dashboard/WhatMovedYourLine";
import type { DriverExplanationsResult } from "@/lib/data/narration";
import type { Driver } from "@/lib/financial-engine";

/**
 * Unwraps the driver-explanations narration promise inside a Suspense
 * boundary. Both the Suspense fallback and the AI-unavailable (null) path
 * render the identical deterministic accordion — no flash, no spinners.
 */
export function AIWhatMovedYourLine({
  drivers,
  narration,
}: {
  drivers: Driver[];
  narration: Promise<DriverExplanationsResult | null>;
}) {
  const result = use(narration);
  return <WhatMovedYourLine drivers={drivers} aiResult={result} />;
}
```

- [ ] **Step 5: Wire `HomeDashboard.tsx`**

Props gain `driverNarration: Promise<DriverExplanationsResult | null>`. The Drivers section becomes:

```tsx
      {/* Drivers: AI supplies per-driver wording; the cards, amounts, and
          deterministic explanations are always code-calculated. */}
      <section aria-labelledby="what-moved">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="what-moved" className="text-base font-semibold text-primary">
            What moved your line
          </h2>
          <span className="text-xs text-tertiary">Largest events · {range}</span>
        </div>
        <Suspense fallback={<WhatMovedYourLine drivers={view.drivers} aiResult={null} />}>
          <AIWhatMovedYourLine drivers={view.drivers} narration={driverNarration} />
        </Suspense>
      </section>
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: full unit suite green (no component unit tests in this project — coverage comes from Task 9's e2e + engine tests), typecheck and lint clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dashboard): per-driver explanation accordion with AI narration and deterministic fallback"
```

---

### Task 9: e2e coverage, visual verification, docs, full check

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `docs/DECISIONS.md` (new entry #31), `docs/KNOWN_LIMITATIONS.md`, `docs/ROADMAP.md` (Phase 4 slice 2), `docs/CURRENT_PHASE.md`

**Interfaces:**
- Consumes: everything above; keyless Playwright environment (`playwright.config.ts` already forces `AI_GATEWAY_API_KEY: ""` — verify, don't change).

- [ ] **Step 1: Add the e2e spec** (in `smoke.spec.ts`, after the dashboard test — same serial `page`)

```ts
test("driver card expands to the calculated explanation", async () => {
  await page.goto("/");
  const firstCard = page.getByRole("button", { name: /Show explanation/ }).first();
  await firstCard.click();
  const panel = page.getByRole("region").filter({ hasText: "How is this generated?" });
  await expect(panel).toBeVisible();
  // Keyless run: deterministic path, chip scoped to the panel ("Calculated"
  // also appears on the performance brief).
  await expect(panel.getByText("Calculated", { exact: true })).toBeVisible();
  // The relocated drill-down keeps its filtered URL.
  const link = panel.getByRole("link", { name: /View transactions/ });
  await expect(link).toHaveAttribute("href", /\/transactions\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&label=/);
  // Collapse works.
  await page.getByRole("button", { name: /Hide explanation/ }).click();
  await expect(panel).not.toBeVisible();
});
```

- [ ] **Step 2: Run e2e twice**

Run: `pnpm test:e2e` (twice, back-to-back)
Expected: all specs pass both runs (12 existing + 1 new = 13, or current count + 1 if it drifted).

- [ ] **Step 3: Live visual verification — mobile FIRST**

Using gstack `browse` against this worktree's dev server (mint a session with the `scripts/dev-login.ts` / mint-session technique; remember `tsx` needs explicit env sourcing, and use `npx next dev -p <port>` — `pnpm dev -- -p` misparses the flag):

1. **390×844:** dashboard renders; tap a driver card → panel expands full-width below the row with explanation, chip, "How is this generated?", "View transactions"; chevron rotates; one panel open at a time; tap again collapses; drill-down link navigates to the filtered `/transactions`; zero console errors.
2. **1280×900:** same pass; layout adapts from mobile, no overflow.
3. Switch chart range to 90D: panels still work (deterministic text is acceptable and expected for drivers outside the 30D AI window — with no key everything is deterministic anyway).

- [ ] **Step 4: Docs**

- `DECISIONS.md` #31: per-surface pipeline generalization + per-driver explanations design (date, decision, alternatives — parallel module, per-driver AI calls, section-level narrative — reasoning, consequences).
- `KNOWN_LIMITATIONS.md`: AI explanations cover the default 30-day window only — other chart ranges always show deterministic text (matched per-card by position/type/date/impact); single-shot generation; cache rows still unpruned and not prompt-versioned (existing entries — extend, don't duplicate).
- `ROADMAP.md`: Phase 4 slice 2 complete.
- `CURRENT_PHASE.md`: update per its standing format (recently completed, test status, next priorities).

- [ ] **Step 5: Full check**

Run: `pnpm check` (with `.env.local` present in the worktree)
Expected: lint 0 errors (1 pre-existing `AccountSheet.tsx` warning allowed), typecheck clean, all unit tests green, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(e2e)+docs: driver explanation accordion coverage; DECISIONS #31"
```

---

### Task 10: Live-provider QA (pre-merge gate)

Slice 1 proved keyless review misses real-model bugs — this task is mandatory before merge.

**Files:** none expected (fix rounds get their own commits if bugs surface).

- [ ] **Step 1:** With a real `AI_GATEWAY_API_KEY` in the worktree's `.env.local` and a fresh ephemeral test user (service-role admin API): load the dashboard at 390×844. Expand every driver card. Verify: AI chip (`AI narrative · numbers calculated`) on panels, explanation is 1–2 sentences, mentions only known figures, no internal ids (`d1`…) in prose, no advice, no shame language, equity drivers framed constructively.
- [ ] **Step 2:** Reload. Verify the cached row is served: `ai_narrations` row count and `created_at` unchanged for `surface = 'driver_explanations'`.
- [ ] **Step 3:** Switch range to 90D — drivers outside the 30D window show deterministic panels ("Calculated" chip), cards inside it keep AI text.
- [ ] **Step 4:** Remove the key, restart, reload: every panel deterministic with "Calculated" chip even though a cached row exists (key gate runs before cache lookup).
- [ ] **Step 5:** Repeat step 1's pass at 1280×900. Zero console errors throughout. Delete the test user and any scratch scripts.
- [ ] **Step 6:** If bugs were found: fix, add regression tests where deterministic, re-run `pnpm check` + affected e2e, and re-verify live. Record notable findings in CURRENT_PHASE's slice entry.

---

## Self-Review Notes

- **Spec coverage:** migration (T1), pipeline generalization (T2), schemas/guards (T3), prompt (T4), narrator (T5), input builder (T6), deterministic text + shared labels (T7), accordion UI + wiring + relocated drill-down + disclosure (T8), e2e + mobile-first visual verification + docs (T9), live-provider QA (T10). Spec's "no advice" enforcement is prompt-rule only by design (spec Guards §4).
- **Range-switch behavior** (AI covers only the 30D window) surfaced during planning; handled by per-card defensive matching in T8 and documented in KNOWN_LIMITATIONS (T9 step 4).
- **Type consistency check:** `BriefInput`/`BriefOutput`/`briefInputSchema`/`briefOutputSchema` (T2) are the names used in T3–T8; `DriverExplanationsResult` defined in T8-step-1 and consumed by T8's components; `driverExplanationText(driver, { totalMovement })` matches between T7 and T8.
