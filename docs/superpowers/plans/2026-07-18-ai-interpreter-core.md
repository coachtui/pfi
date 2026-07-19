# AI Interpreter Core + Performance Brief Narration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provider-agnostic AI service core (Vercel AI SDK, Zod-validated I/O, policy prompt, cache/audit table) and ship AI narration of the dashboard Performance brief with deterministic fallback on every failure path.

**Architecture:** New server-only, React-free module `src/lib/ai/` (schemas = the data boundary, prompt, narrator, hash, input assembly) + thin IO function in `src/lib/data/narration.ts` + migration `0009_ai_narrations` (owner-only RLS) + a Suspense-wrapped AI brief on the dashboard whose loading and failure state is today's deterministic `PerformanceBrief`. Spec: `docs/superpowers/specs/2026-07-18-ai-interpreter-core-design.md`.

**Tech Stack:** Next.js 16 App Router, strict TS, Vercel AI SDK (`ai` v7), Zod 4, Supabase (RLS), Vitest, Playwright.

## Global Constraints

- Binding policy: `docs/AI_RECOMMENDATION_POLICY.md`. AI narrates only supplied metrics; it never calculates.
- `src/lib/ai/` must contain **no React/Next imports** (same extraction rule as `financial-engine`).
- Data boundary: prompts carry derived metrics with dollar values but **never raw transaction rows, merchant names, account identifiers, or `FinancialEvent.label`** (labels may embed user-entered text — use `event.type` only).
- Unvalidated model output is never rendered; every failure collapses to the deterministic brief with no user-facing error.
- `AI_GATEWAY_API_KEY` is optional; dev/CI/e2e run keyless. Empty string counts as unset.
- Default model string: `anthropic/claude-haiku-4-5`, override via `PFI_AI_MODEL`.
- No color-only state signaling; chips are text. Mobile-first (~390px) before desktop.
- `pnpm check` green before any completion claim; commits per task.

---

### Task 1: `ai` dependency + env config

**Files:**
- Modify: `package.json` (via `pnpm add ai`)
- Modify: `src/lib/config/env.ts`
- Test: `src/lib/config/env.test.ts`

**Interfaces:**
- Produces: `env.AI_GATEWAY_API_KEY: string | undefined`, `env.PFI_AI_MODEL: string` (default `"anthropic/claude-haiku-4-5"`). All later tasks read AI config only through `env`.

- [ ] **Step 1: Install the AI SDK**

Run: `pnpm add ai`
Expected: `ai` (^7) added to dependencies; lockfile updated.

- [ ] **Step 2: Write failing env tests**

Append to `src/lib/config/env.test.ts` (match its existing describe/it style):

```ts
describe("AI config", () => {
  const base = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
  } as NodeJS.ProcessEnv;

  it("accepts a missing AI key and applies the model default", () => {
    const parsed = validateEnv(base);
    expect(parsed.AI_GATEWAY_API_KEY).toBeUndefined();
    expect(parsed.PFI_AI_MODEL).toBe("anthropic/claude-haiku-4-5");
  });

  it("treats an empty-string AI key as unset", () => {
    const parsed = validateEnv({ ...base, AI_GATEWAY_API_KEY: "" });
    expect(parsed.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  it("accepts a present AI key and model override", () => {
    const parsed = validateEnv({
      ...base,
      AI_GATEWAY_API_KEY: "vck_test",
      PFI_AI_MODEL: "anthropic/claude-sonnet-5",
    });
    expect(parsed.AI_GATEWAY_API_KEY).toBe("vck_test");
    expect(parsed.PFI_AI_MODEL).toBe("anthropic/claude-sonnet-5");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/config/env.test.ts`
Expected: FAIL (unknown keys / missing default).

- [ ] **Step 4: Implement**

In `src/lib/config/env.ts`, add to `envSchema`:

```ts
  // Phase 4 AI (optional — absent disables AI features; empty string = unset).
  AI_GATEWAY_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  PFI_AI_MODEL: z.string().min(1).default("anthropic/claude-haiku-4-5"),
```

Add to `defaultSource` (server-only vars are simply `undefined` in the client bundle, which the schema accepts):

```ts
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  PFI_AI_MODEL: process.env.PFI_AI_MODEL,
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run src/lib/config/env.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/config/env.ts src/lib/config/env.test.ts
git commit -m "feat(ai): add ai sdk dependency and optional AI env config"
```

---

### Task 2: Narration schemas — the data boundary

**Files:**
- Create: `src/lib/ai/schemas.ts`
- Test: `src/lib/ai/schemas.test.ts`

**Interfaces:**
- Produces: `NARRATION_SURFACE`, `narrationInputSchema`, `narrationOutputSchema`, types `NarrationInput`/`NarrationOutput`, `referencesOnlyKnownDrivers(input, output): boolean`.

- [ ] **Step 1: Write failing tests**

`src/lib/ai/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NARRATION_SURFACE,
  narrationInputSchema,
  narrationOutputSchema,
  referencesOnlyKnownDrivers,
} from "./schemas";

const validInput = {
  surface: NARRATION_SURFACE,
  companyName: "Blue Reef Partners",
  periodDays: 30,
  availableCapital: 12450.75,
  cushion: 3200.5,
  vsBaseline: "above",
  vsWaterline: "above",
  momentum: { direction: "improving", delta: 2.3, windowDays: 7 },
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-15", impact: 4200, buildsEquity: false },
    { id: "d2", kind: "investment_contribution", date: "2026-07-10", impact: -500, buildsEquity: true },
  ],
  score: { overall: 612, band: "Solid", momentum: "improving" },
};

describe("narrationInputSchema", () => {
  it("accepts a valid input", () => {
    expect(narrationInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects unknown fields (raw-data smuggling)", () => {
    expect(
      narrationInputSchema.safeParse({ ...validInput, transactions: [] }).success,
    ).toBe(false);
    expect(
      narrationInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], label: "ACME PAYROLL" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a driver kind outside the event-type enum", () => {
    expect(
      narrationInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], kind: "merchant_purchase" }],
      }).success,
    ).toBe(false);
  });

  it("allows a null score", () => {
    expect(narrationInputSchema.safeParse({ ...validInput, score: null }).success).toBe(true);
  });
});

describe("narrationOutputSchema", () => {
  it("accepts a valid output", () => {
    const out = {
      body: "Blue Reef Partners is trading above its baseline with $12,451 of available capital, lifted mainly by a $4,200 paycheck on Jul 15.",
      referencedDriverIds: ["d1"],
    };
    expect(narrationOutputSchema.parse(out)).toEqual(out);
  });

  it("rejects extra fields and out-of-bounds body length", () => {
    expect(
      narrationOutputSchema.safeParse({ body: "short", referencedDriverIds: [] }).success,
    ).toBe(false);
    expect(
      narrationOutputSchema.safeParse({
        body: "x".repeat(50),
        referencedDriverIds: [],
        advice: "buy stocks",
      }).success,
    ).toBe(false);
  });
});

describe("referencesOnlyKnownDrivers", () => {
  const input = narrationInputSchema.parse(validInput);
  it("passes when all referenced ids exist", () => {
    expect(
      referencesOnlyKnownDrivers(input, { body: "x".repeat(50), referencedDriverIds: ["d1", "d2"] }),
    ).toBe(true);
  });
  it("fails on an invented driver id", () => {
    expect(
      referencesOnlyKnownDrivers(input, { body: "x".repeat(50), referencedDriverIds: ["d9"] }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/schemas.ts`**

```ts
import { z } from "zod";

/**
 * The AI data boundary. NarrationInput is the ONLY thing the model ever
 * sees about a user: derived metrics with dollar values, never raw
 * transaction rows, merchant names, account identifiers, or event labels
 * (labels may embed user-entered text — drivers carry the type enum only).
 * `.strict()` everywhere makes smuggling extra fields a runtime error.
 * See docs/AI_RECOMMENDATION_POLICY.md.
 */

export const NARRATION_SURFACE = "performance_brief" as const;

/** Mirrors FinancialEventType in src/lib/financial-engine/types.ts. */
const driverKindSchema = z.enum([
  "paycheck",
  "bonus",
  "mortgage_payment",
  "large_purchase",
  "insurance_payment",
  "investment_contribution",
  "debt_payment",
  "debt_payoff",
  "tax_payment",
  "unexpected_expense",
]);

const narrationDriverSchema = z
  .object({
    id: z.string().regex(/^d\d+$/),
    kind: driverKindSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Signed dollar impact on available position (+ improves, − reduces). */
    impact: z.number(),
    buildsEquity: z.boolean(),
  })
  .strict();

export const narrationInputSchema = z
  .object({
    surface: z.literal(NARRATION_SURFACE),
    companyName: z.string().min(1),
    periodDays: z.number().int().positive(),
    availableCapital: z.number(),
    cushion: z.number(),
    vsBaseline: z.enum(["above", "below", "at", "unknown"]),
    vsWaterline: z.enum(["above", "below", "at"]),
    momentum: z
      .object({
        direction: z.enum(["improving", "stable", "declining"]),
        delta: z.number(),
        windowDays: z.number().int().positive(),
      })
      .strict(),
    drivers: z.array(narrationDriverSchema).max(4),
    score: z
      .object({
        overall: z.number().nullable(),
        band: z.string().nullable(),
        momentum: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const narrationOutputSchema = z
  .object({
    /** The narrated brief. Bounds keep it a paragraph, not an essay. */
    body: z.string().min(40).max(700),
    /** Every driver the narration mentions, by input id — traceability. */
    referencedDriverIds: z.array(z.string()),
  })
  .strict();

export type NarrationInput = z.infer<typeof narrationInputSchema>;
export type NarrationOutput = z.infer<typeof narrationOutputSchema>;

/** Policy check: AI may not invent a driver (AI_RECOMMENDATION_POLICY.md). */
export function referencesOnlyKnownDrivers(
  input: NarrationInput,
  output: NarrationOutput,
): boolean {
  const known = new Set(input.drivers.map((d) => d.id));
  return output.referencedDriverIds.every((id) => known.has(id));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/ai/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/schemas.test.ts
git commit -m "feat(ai): narration input/output schemas — the typed AI data boundary"
```

---

### Task 3: Canonical input hash

**Files:**
- Create: `src/lib/ai/hash.ts`
- Test: `src/lib/ai/hash.test.ts`

**Interfaces:**
- Consumes: `NarrationInput` from Task 2.
- Produces: `narrationInputHash(input: NarrationInput): string` (64-char sha256 hex, key-order independent).

- [ ] **Step 1: Write failing tests**

`src/lib/ai/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { narrationInputHash } from "./hash";
import { NARRATION_SURFACE, narrationInputSchema, type NarrationInput } from "./schemas";

function makeInput(overrides: Partial<NarrationInput> = {}): NarrationInput {
  return narrationInputSchema.parse({
    surface: NARRATION_SURFACE,
    companyName: "Test Co",
    periodDays: 30,
    availableCapital: 100,
    cushion: 50,
    vsBaseline: "above",
    vsWaterline: "above",
    momentum: { direction: "stable", delta: 0, windowDays: 7 },
    drivers: [],
    score: null,
    ...overrides,
  });
}

describe("narrationInputHash", () => {
  it("is stable across object key order", () => {
    const a = makeInput();
    const reordered = JSON.parse(
      JSON.stringify({ score: a.score, drivers: a.drivers, ...a }),
    ) as NarrationInput;
    expect(narrationInputHash(a)).toBe(narrationInputHash(reordered));
    expect(narrationInputHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any value changes", () => {
    expect(narrationInputHash(makeInput())).not.toBe(
      narrationInputHash(makeInput({ availableCapital: 101 })),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/hash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/hash.ts`**

```ts
import { createHash } from "node:crypto";
import type { NarrationInput } from "./schemas";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonicalize(obj[k])]),
    );
  }
  return value;
}

/** Cache key for ai_narrations: any input change invalidates naturally. */
export function narrationInputHash(input: NarrationInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/ai/hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/hash.ts src/lib/ai/hash.test.ts
git commit -m "feat(ai): canonical narration input hash for cache keying"
```

---

### Task 4: Policy prompt

**Files:**
- Create: `src/lib/ai/prompts.ts`
- Test: `src/lib/ai/prompts.test.ts`

**Interfaces:**
- Consumes: `NarrationInput` from Task 2.
- Produces: `SYSTEM_PROMPT: string`, `buildUserPrompt(input: NarrationInput): string`.

- [ ] **Step 1: Write failing tests**

`src/lib/ai/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { NARRATION_SURFACE, narrationInputSchema } from "./schemas";

const input = narrationInputSchema.parse({
  surface: NARRATION_SURFACE,
  companyName: "Test Co",
  periodDays: 30,
  availableCapital: 8000,
  cushion: 1200,
  vsBaseline: "below",
  vsWaterline: "above",
  momentum: { direction: "declining", delta: -1.8, windowDays: 7 },
  drivers: [{ id: "d1", kind: "large_purchase", date: "2026-07-12", impact: -2400, buildsEquity: false }],
  score: null,
});

describe("policy prompt", () => {
  it("encodes the binding policy rules", () => {
    for (const phrase of [
      "only the metrics provided",
      "never invent",
      "not financial, tax, legal, or investment advice",
      "no shame",
      "referencedDriverIds",
    ]) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("embeds the input metrics verbatim and nothing else", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('"availableCapital": 8000');
    expect(prompt).toContain('"kind": "large_purchase"');
    expect(prompt).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/prompts.ts`**

```ts
import type { NarrationInput } from "./schemas";

/**
 * Encodes docs/AI_RECOMMENDATION_POLICY.md for the narration surface.
 * The snapshot test in prompts.test.ts makes wording changes deliberate.
 */
export const SYSTEM_PROMPT = `You narrate a household's financial performance in the voice of a neutral analyst covering a small company. You will receive a JSON object of verified, pre-calculated metrics. Rules, in priority order:

1. Use ONLY the metrics provided. Never invent, recalculate, or extrapolate numbers, balances, or drivers. Every figure you mention must appear in the input.
2. List every driver id you mention in referencedDriverIds. Never reference a driver id that is not in the input.
3. Be specific and measurable ("available capital stands at $8,000"), never vague ("finances may need attention").
4. Below the personal baseline and below the waterline are distinct conditions — never conflate them.
5. Drivers with buildsEquity=true reduce cash but build owner-created equity; present them constructively, never as losses.
6. No advice of any kind: no securities, no tax or legal conclusions, no guarantees, no "you should". You describe; you do not prescribe.
7. Tone: no shame-oriented language, no celebration of extreme austerity. This is educational analysis, not financial, tax, legal, or investment advice — do not claim otherwise or present yourself as a professional adviser.
8. Write 2–4 sentences in plain language (no jargon like FCF), in the third person using the company name provided.`;

export function buildUserPrompt(input: NarrationInput): string {
  return `Narrate this performance brief covering the last ${input.periodDays} days. Verified metrics:

${JSON.stringify(input, null, 2)}`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/ai/prompts.test.ts`
Expected: PASS (snapshot written on first run).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts.ts src/lib/ai/prompts.test.ts src/lib/ai/__snapshots__
git commit -m "feat(ai): policy-encoding system prompt for performance-brief narration"
```

---

### Task 5: Narrator service

**Files:**
- Create: `src/lib/ai/narrator.ts`
- Test: `src/lib/ai/narrator.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`env`, schemas, prompts).
- Produces: `generateNarration(input: NarrationInput, opts?: { model?: LanguageModel; timeoutMs?: number }): Promise<NarrationOutput | null>`. Returns `null` on every failure; never throws.

- [ ] **Step 1: Write failing tests**

`src/lib/ai/narrator.test.ts` (mock model per AI SDK testing docs — `MockLanguageModelV4` from `ai/test`; its `doGenerate` returns `content`, `finishReason`, `usage`, `warnings`):

```ts
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateNarration } from "./narrator";
import { NARRATION_SURFACE, narrationInputSchema } from "./schemas";

const input = narrationInputSchema.parse({
  surface: NARRATION_SURFACE,
  companyName: "Test Co",
  periodDays: 30,
  availableCapital: 8000,
  cushion: 1200,
  vsBaseline: "above",
  vsWaterline: "above",
  momentum: { direction: "improving", delta: 2.1, windowDays: 7 },
  drivers: [{ id: "d1", kind: "paycheck", date: "2026-07-15", impact: 4200, buildsEquity: false }],
  score: null,
});

const VALID_BODY =
  "Test Co is trading above its personal baseline with $8,000 of available capital, lifted by a $4,200 paycheck.";

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("generateNarration", () => {
  it("returns validated output from a well-formed response", async () => {
    const result = await generateNarration(input, {
      model: mockModel(JSON.stringify({ body: VALID_BODY, referencedDriverIds: ["d1"] })),
    });
    expect(result).toEqual({ body: VALID_BODY, referencedDriverIds: ["d1"] });
  });

  it("returns null when the model emits malformed output", async () => {
    const result = await generateNarration(input, {
      model: mockModel("I am not JSON at all"),
    });
    expect(result).toBeNull();
  });

  it("returns null when the narration references an invented driver", async () => {
    const result = await generateNarration(input, {
      model: mockModel(JSON.stringify({ body: VALID_BODY, referencedDriverIds: ["d7"] })),
    });
    expect(result).toBeNull();
  });

  it("returns null with no API key and no model override", async () => {
    // Vitest env stubs AI_GATEWAY_API_KEY as absent (env.ts test branch).
    expect(await generateNarration(input)).toBeNull();
  });
});
```

Note: `env.ts`'s `VITEST` branch parses a fixed test env — confirm it leaves `AI_GATEWAY_API_KEY` undefined (it will, since Task 1 didn't add it there). If the mock-model constructor name differs in the installed `ai` version (`MockLanguageModelV3` vs `V4`), check `node_modules/ai/dist` exports for `ai/test` and use the exported name — do not pin to this plan's guess if the package disagrees.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/narrator.ts`**

```ts
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { env } from "@/lib/config/env";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import {
  narrationOutputSchema,
  referencesOnlyKnownDrivers,
  type NarrationInput,
  type NarrationOutput,
} from "./schemas";

export interface NarratorOptions {
  /** DI/test override; defaults to the gateway model string from env. */
  model?: LanguageModel;
  timeoutMs?: number;
}

/**
 * Provider-agnostic narration call. Returns null on EVERY failure —
 * missing key, provider error, timeout, schema violation, invented
 * driver — so callers fall back to the deterministic brief and
 * unvalidated text is never rendered.
 */
export async function generateNarration(
  input: NarrationInput,
  opts: NarratorOptions = {},
): Promise<NarrationOutput | null> {
  const model =
    opts.model ?? (env.AI_GATEWAY_API_KEY ? env.PFI_AI_MODEL : undefined);
  if (!model) return null;
  try {
    const { object } = await generateObject({
      model,
      schema: narrationOutputSchema,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 8_000,
      temperature: 0.4,
    });
    if (!referencesOnlyKnownDrivers(input, object)) return null;
    return object;
  } catch {
    return null;
  }
}
```

If `generateObject`'s installed typings reject a plain `timeout` option, use `abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8_000)` instead — both are supported patterns; prefer whichever typechecks.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/ai/narrator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/narrator.ts src/lib/ai/narrator.test.ts
git commit -m "feat(ai): provider-agnostic narrator with null-on-any-failure contract"
```

---

### Task 6: Migration `0009_ai_narrations` + RLS tests

**Files:**
- Create: `supabase/migrations/0009_ai_narrations.sql`
- Modify: `scripts/test-rls.mts`

**Interfaces:**
- Produces: table `public.ai_narrations` (columns `id`, `user_id`, `surface`, `input_hash`, `input_json`, `output_json`, `model`, `created_at`; unique `(user_id, surface, input_hash)`; owner-only RLS). Task 8 reads/writes it.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0009_ai_narrations.sql` (style of `0007_balance_anchors.sql`):

```sql
-- 0009_ai_narrations.sql
-- AI narration cache + audit log (docs/superpowers/specs/2026-07-18-ai-interpreter-core-design.md).
-- One row per (user, surface, input-hash): input_json is the exact verified
-- metrics the model received (derived values only — the NarrationInput type
-- cannot carry raw transactions/merchants), output_json the validated
-- narration. Failures are never cached. No cross-table FK beyond user_id,
-- so no ownership trigger is needed (contrast balance_anchors, DECISIONS #25).

create table public.ai_narrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  surface text not null check (surface in ('performance_brief')),
  input_hash text not null,
  input_json jsonb not null,
  output_json jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, surface, input_hash)
);

alter table public.ai_narrations enable row level security;

create policy "own_select" on public.ai_narrations for select using (auth.uid() = user_id);
create policy "own_insert" on public.ai_narrations for insert with check (auth.uid() = user_id);
create policy "own_update" on public.ai_narrations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.ai_narrations for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply to the linked project**

Run: `supabase db push` (same mechanism used for 0007/0008 — check `git log --grep 0008` / DECISIONS #25 notes if it differs).
Expected: migration applied cleanly.

- [ ] **Step 3: Extend `scripts/test-rls.mts`**

After the existing `balance_anchors` block, following the established `check(...)` style (A already has a profile; use A's user id):

```ts
  // ai_narrations: owner-only cache/audit rows.
  const narrationRow = {
    user_id: a.id, surface: "performance_brief", input_hash: "t".repeat(64),
    input_json: { surface: "performance_brief" }, output_json: { body: "x".repeat(40), referencedDriverIds: [] },
    model: "test-model",
  };
  const { error: nIns } = await a.client.from("ai_narrations").insert(narrationRow);
  check("A can insert own narration", !nIns, nIns?.message);

  const { data: nOwn } = await a.client.from("ai_narrations").select("id").eq("user_id", a.id);
  check("A can read own narration", (nOwn?.length ?? 0) === 1);

  const { data: nCross } = await b.client.from("ai_narrations").select("id");
  check("B cannot read A's narrations", (nCross?.length ?? 0) === 0);

  const { error: nForge } = await b.client.from("ai_narrations")
    .insert({ ...narrationRow, input_hash: "u".repeat(64) });
  check("B cannot insert a narration for A", !!nForge);

  const { data: nUpd } = await b.client.from("ai_narrations")
    .update({ model: "evil" }).eq("user_id", a.id).select("id");
  check("B cannot update A's narrations", (nUpd?.length ?? 0) === 0);

  const { data: nDel } = await b.client.from("ai_narrations")
    .delete().eq("user_id", a.id).select("id");
  check("B cannot delete A's narrations", (nDel?.length ?? 0) === 0);
```

- [ ] **Step 4: Run the RLS suite**

Run: `pnpm test:rls`
Expected: all checks pass — 32 existing + 6 new = **38/38**, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_ai_narrations.sql scripts/test-rls.mts
git commit -m "feat(ai): ai_narrations cache/audit table with owner-only RLS + tests"
```

---

### Task 7: Narration input assembly

**Files:**
- Create: `src/lib/ai/input.ts`
- Test: `src/lib/ai/input.test.ts`

**Interfaces:**
- Consumes: `financial-engine` (`buildIndexSeries`, `computeDrivers`, `computeMomentum`, `availablePosition`, `cushion`, `waterline`, `driverDisplay`, types `DailySnapshot`/`FinancialEvent`); `narrationInputSchema` from Task 2.
- Produces: `NarrationSource` interface and `buildNarrationInput(source: NarrationSource): NarrationInput | null`. Task 8 calls it; Task 9's page assembles a `NarrationSource`.

- [ ] **Step 1: Write failing tests**

`src/lib/ai/input.test.ts`. Build snapshots the way `insights.test.ts` / `position.test.ts` do (check one for the minimal `DailySnapshot` fixture shape and reuse its helper pattern):

```ts
import { describe, expect, it } from "vitest";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine";
import { buildNarrationInput } from "./input";

// Minimal fixture helpers — mirror the shape used in financial-engine tests.
function snap(date: string, liquid: number): DailySnapshot {
  return {
    date,
    liquid_balance: liquid,
    credit_balance: 0,
    investment_balance: 0,
    loan_balance: 0,
    near_term_obligations: 500,
  } as DailySnapshot; // align fields with the real type from types.ts
}

function event(id: string, date: string, type: FinancialEvent["type"], amount: number, direction: "inflow" | "outflow"): FinancialEvent {
  return { id, date, type, label: "RAW LABEL — MUST NOT LEAK", amount, direction };
}

const snapshots = Array.from({ length: 40 }, (_, i) =>
  snap(`2026-06-${String(i + 1).padStart(2, "0")}`.replace(/^2026-06-(3[1-9]|40)$/, (m) => `2026-07-${String(Number(m.slice(8)) - 30).padStart(2, "0")}`), 1000 + i * 10),
);

describe("buildNarrationInput", () => {
  it("returns null with no snapshots", () => {
    expect(buildNarrationInput({ companyName: "T", snapshots: [], events: [], score: null })).toBeNull();
  });

  it("assembles a schema-valid input from engine outputs", () => {
    const events = [event("e1", snapshots[35].date, "paycheck", 4200, "inflow")];
    const input = buildNarrationInput({ companyName: "Test Co", snapshots, events, score: { overall: 600, band: "Solid", momentum: "improving" } });
    expect(input).not.toBeNull();
    expect(input!.companyName).toBe("Test Co");
    expect(input!.drivers[0]).toMatchObject({ id: "d1", kind: "paycheck", impact: 4200, buildsEquity: false });
    expect(input!.periodDays).toBeLessThanOrEqual(30);
  });

  it("never includes event labels or ids (raw-data boundary)", () => {
    const events = [event("e1", snapshots[35].date, "large_purchase", 900, "outflow")];
    const input = buildNarrationInput({ companyName: "T", snapshots, events, score: null });
    expect(JSON.stringify(input)).not.toContain("RAW LABEL");
    expect(JSON.stringify(input)).not.toContain('"e1"');
  });

  it("marks equity-building drivers", () => {
    const events = [event("e1", snapshots[35].date, "investment_contribution", 500, "outflow")];
    const input = buildNarrationInput({ companyName: "T", snapshots, events, score: null });
    expect(input!.drivers[0]).toMatchObject({ impact: -500, buildsEquity: true });
  });
});
```

Fix the date-fixture helper to whatever is cleanest — the intent is 40 consecutive daily snapshots ending in July 2026; copy the fixture convention from `financial-engine`'s existing tests rather than inventing one. Align `snap()` fields with the real `DailySnapshot` in `src/lib/financial-engine/types.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ai/input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ai/input.ts`**

```ts
import {
  availablePosition,
  buildIndexSeries,
  computeDrivers,
  computeMomentum,
  cushion,
  driverDisplay,
  waterline,
  type DailySnapshot,
  type FinancialEvent,
} from "@/lib/financial-engine";
import {
  NARRATION_SURFACE,
  narrationInputSchema,
  type NarrationInput,
} from "./schemas";

/** Matches the dashboard's default 30D view. */
const NARRATION_WINDOW_DAYS = 30;

export interface NarrationSource {
  companyName: string;
  snapshots: DailySnapshot[];
  events: FinancialEvent[];
  score: { overall: number | null; band: string | null; momentum: string } | null;
}

/**
 * Deterministic assembly of the AI data boundary from engine outputs.
 * Deliberately maps drivers to event TYPE only — FinancialEvent.label and
 * event ids never cross the boundary. Final .parse() guarantees the result
 * conforms to the strict schema at runtime, not just at the type level.
 */
export function buildNarrationInput(source: NarrationSource): NarrationInput | null {
  const { snapshots, events } = source;
  if (snapshots.length === 0) return null;
  const { points } = buildIndexSeries(snapshots);
  if (points.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const visible = points.slice(-NARRATION_WINDOW_DAYS);
  const momentum = computeMomentum(points.map((p) => p.actual));
  const drivers = computeDrivers(events, {
    start: visible[0].date,
    end: visible[visible.length - 1].date,
  });

  const compare = (a: number, b: number): "above" | "below" | "at" =>
    a > b ? "above" : a < b ? "below" : "at";
  const cents = (n: number) => Math.round(n * 100) / 100;

  return narrationInputSchema.parse({
    surface: NARRATION_SURFACE,
    companyName: source.companyName,
    periodDays: visible.length,
    availableCapital: cents(availablePosition(latest)),
    cushion: cents(cushion(latest)),
    vsBaseline:
      latestPoint.baseline === null
        ? "unknown"
        : compare(latestPoint.actual, latestPoint.baseline),
    vsWaterline: compare(availablePosition(latest), waterline(latest)),
    momentum: {
      direction: momentum.direction,
      delta: Math.round(momentum.delta * 10) / 10,
      windowDays: momentum.windowDays,
    },
    drivers: drivers.map((d, i) => ({
      id: `d${i + 1}`,
      kind: d.event.type,
      date: d.event.date,
      impact: cents(d.impact),
      buildsEquity: driverDisplay(d).buildsEquity,
    })),
    score: source.score,
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/ai/input.test.ts`
Expected: PASS. Also run `pnpm vitest run src/lib/ai` — all ai-module tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/input.ts src/lib/ai/input.test.ts
git commit -m "feat(ai): deterministic narration input assembly from engine outputs"
```

---

### Task 8: Cache-or-generate data function

**Files:**
- Create: `src/lib/data/narration.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 7 + `SupabaseClient` (same import style as `queries.ts`).
- Produces: `NarrationResult { output: NarrationOutput; input: NarrationInput }` and `getOrGenerateNarration(supabase: SupabaseClient, source: NarrationSource): Promise<NarrationResult | null>`. **The returned promise never rejects** — Task 9 passes it through React `use()`, where a rejection would hit an error boundary instead of the fallback.

- [ ] **Step 1: Implement `src/lib/data/narration.ts`**

Thin IO composition — no unit test, matching the `queries.ts` convention; behavior is covered by the RLS suite (Task 6), the keyless e2e (Task 10), and live QA (Task 10):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";
import { narrationInputHash } from "@/lib/ai/hash";
import { buildNarrationInput, type NarrationSource } from "@/lib/ai/input";
import { generateNarration } from "@/lib/ai/narrator";
import {
  NARRATION_SURFACE,
  narrationOutputSchema,
  type NarrationInput,
  type NarrationOutput,
} from "@/lib/ai/schemas";

export interface NarrationResult {
  output: NarrationOutput;
  input: NarrationInput;
}

/**
 * Cache-or-generate for the performance-brief narration. Returns null (and
 * NEVER rejects) on any failure so the dashboard falls back to the
 * deterministic brief. Failures are not cached — the next load retries.
 */
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  source: NarrationSource,
): Promise<NarrationResult | null> {
  try {
    if (!env.AI_GATEWAY_API_KEY) return null;
    const input = buildNarrationInput(source);
    if (!input) return null;
    const inputHash = narrationInputHash(input);

    const { data: cached } = await supabase
      .from("ai_narrations")
      .select("output_json")
      .eq("surface", NARRATION_SURFACE)
      .eq("input_hash", inputHash)
      .maybeSingle();
    if (cached) {
      const parsed = narrationOutputSchema.safeParse(cached.output_json);
      if (parsed.success) return { output: parsed.data, input };
    }

    const output = await generateNarration(input);
    if (!output) return null;

    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      await supabase.from("ai_narrations").upsert(
        {
          user_id: auth.user.id,
          surface: NARRATION_SURFACE,
          input_hash: inputHash,
          input_json: input,
          output_json: output,
          model: env.PFI_AI_MODEL,
        },
        { onConflict: "user_id,surface,input_hash" },
      );
    }
    return { output, input };
  } catch (err) {
    // Redaction rule: log the failure class only, never metric values.
    console.error("[ai] narration generation failed:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/narration.ts
git commit -m "feat(ai): cache-or-generate narration data function (never rejects)"
```

---

### Task 9: Dashboard wiring — Suspense AI brief with deterministic fallback

**Files:**
- Create: `src/components/dashboard/PerformanceBrief.tsx` (extracted from `HomeDashboard.tsx`)
- Create: `src/components/dashboard/AIPerformanceBrief.tsx`
- Modify: `src/components/dashboard/HomeDashboard.tsx` (remove inline `PerformanceBrief`, add `narration` prop + Suspense block)
- Modify: `src/app/page.tsx` (create the narration promise, pass it down)

**Interfaces:**
- Consumes: `NarrationResult`/`getOrGenerateNarration` (Task 8), existing `PerformanceBrief` props.
- Produces: `HomeDashboard` gains required prop `narration: Promise<NarrationResult | null>`.

- [ ] **Step 1: Extract the deterministic brief**

Move the inline `PerformanceBrief` component out of `HomeDashboard.tsx` into `src/components/dashboard/PerformanceBrief.tsx`, unchanged except: export it, and replace the chip text `"Calculated · AI narration in Phase 4"` with `"Calculated"`. Keep the same props (`companyName`, `momentum`, `available`, `cushionNow`, `aboveWaterline`, `aboveBaseline`) and the closing disclaimer line ("Educational analysis, not financial, tax, or investment advice."). It stays a plain (client-tree) component.

- [ ] **Step 2: Create `src/components/dashboard/AIPerformanceBrief.tsx`**

```tsx
"use client";

import { use, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { formatDollars } from "@/lib/financial-engine";
import type { NarrationResult } from "@/lib/data/narration";
import type { NarrationInput } from "@/lib/ai/schemas";

/** Type-derived display names — never event labels (data boundary). */
const KIND_LABELS: Record<NarrationInput["drivers"][number]["kind"], string> = {
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

export function AIPerformanceBrief({
  narration,
  fallback,
}: {
  narration: Promise<NarrationResult | null>;
  fallback: ReactNode;
}) {
  const result = use(narration);
  if (!result) return <>{fallback}</>;
  const { output, input } = result;

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">Performance brief</h2>
        <span className="rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
          AI narrative · numbers calculated
        </span>
      </div>
      <p className="text-sm leading-relaxed text-secondary">{output.body}</p>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-tertiary">
          How is this generated?
        </summary>
        <div className="mt-2 flex flex-col gap-1 text-xs text-tertiary">
          <p>
            The wording is AI-written from these verified, code-calculated metrics only —
            the AI never sees raw transactions and cannot change any number:
          </p>
          <ul className="list-disc pl-4">
            <li>Available capital {formatDollars(input.availableCapital)}; cushion {formatDollars(input.cushion)}</li>
            <li>
              {input.vsBaseline === "unknown" ? "Baseline not yet established" : `${input.vsBaseline} personal baseline`}
              {" · "}
              {input.vsWaterline} the waterline
            </li>
            <li>
              Momentum {input.momentum.direction} ({input.momentum.delta >= 0 ? "+" : ""}
              {input.momentum.delta} pts over {input.momentum.windowDays}d)
            </li>
            {input.drivers.map((d) => (
              <li key={d.id}>
                {KIND_LABELS[d.kind]} on {d.date}: {formatDollars(d.impact)}
                {d.buildsEquity ? " (builds equity)" : ""}
              </li>
            ))}
            {input.score && input.score.overall !== null && (
              <li>PFI Score {input.score.overall} ({input.score.band})</li>
            )}
          </ul>
        </div>
      </details>
      <p className="mt-3 text-xs text-tertiary">
        Educational analysis, not financial, tax, or investment advice.
      </p>
    </Card>
  );
}
```

- [ ] **Step 3: Wire `HomeDashboard.tsx`**

Add to `HomeDashboardProps`: `narration: Promise<NarrationResult | null>;` (type-only import from `@/lib/data/narration`). Import `Suspense` from react, `PerformanceBrief` from its new file, and `AIPerformanceBrief`. Replace the current `<PerformanceBrief ... />` render with:

```tsx
      {(() => {
        const deterministicBrief = (
          <PerformanceBrief
            companyName={profile.companyName}
            momentum={momentum}
            available={availableNow}
            cushionNow={cushionNow}
            aboveWaterline={availableNow > waterline(latest)}
            aboveBaseline={latestPoint.baseline !== null && latestPoint.actual > latestPoint.baseline}
          />
        );
        return (
          <Suspense fallback={deterministicBrief}>
            <AIPerformanceBrief narration={narration} fallback={deterministicBrief} />
          </Suspense>
        );
      })()}
```

(Or hoist `deterministicBrief` to a `const` above the return — whichever reads better in place.)

- [ ] **Step 4: Wire `src/app/page.tsx`**

After `freshness` is loaded, create the promise **without awaiting** and pass it down:

```tsx
  const narration = getOrGenerateNarration(supabase, {
    companyName: company.name,
    snapshots,
    events,
    score:
      scoreSummary.overall !== null
        ? { overall: scoreSummary.overall, band: scoreSummary.band, momentum: scoreSummary.momentum }
        : null,
  });
```

Add `narration={narration}` to the `<HomeDashboard />` props (import `getOrGenerateNarration` from `@/lib/data/narration`). The `EmptyDashboard` branch needs no change — the promise is only created when snapshots exist? No: create it unconditionally is wasteful; move the `const narration = ...` inside a ternary is awkward — instead create it only when `snapshots.length > 0`, else `Promise.resolve(null)`:

```tsx
  const narration =
    snapshots.length > 0
      ? getOrGenerateNarration(supabase, { ... })
      : Promise.resolve(null);
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green (keyless: `getOrGenerateNarration` short-circuits to null; dashboard renders the deterministic brief exactly as before).

Run: `pnpm dev`, open `http://localhost:3000` logged in (see `scripts/dev-login.ts`), confirm the brief renders with the "Calculated" chip and no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/PerformanceBrief.tsx src/components/dashboard/AIPerformanceBrief.tsx src/components/dashboard/HomeDashboard.tsx src/app/page.tsx
git commit -m "feat(ai): dashboard AI performance brief behind Suspense with deterministic fallback"
```

---

### Task 10: E2E guard, docs, full verification

**Files:**
- Modify: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `docs/DECISIONS.md`, `docs/SECURITY_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Pin e2e to keyless mode**

In `playwright.config.ts`, add an env override to `webServer` so a developer's real key in `.env.local` can never make e2e nondeterministic (shell env beats `.env.local` in Next; `env.ts` treats `""` as unset):

```ts
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    env: { ...process.env, AI_GATEWAY_API_KEY: "" },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
```

- [ ] **Step 2: Assert the deterministic brief in the dashboard smoke test**

In `e2e/smoke.spec.ts`, in the onboarding/dashboard test after the existing `PFI Score` assertion, add:

```ts
  // Keyless run: the deterministic brief must render (AI fallback path).
  await expect(page.getByRole("heading", { name: "Performance brief" })).toBeVisible();
  await expect(page.getByText("Calculated", { exact: true })).toBeVisible();
```

Run: `pnpm test:e2e` — expected 12/12 + the extended spec passing. Run twice back-to-back per project convention.

- [ ] **Step 3: Update docs**

- `docs/DECISIONS.md` — add **#26**: Phase 4 slice 1 — provider strategy (Vercel AI SDK + gateway model strings, default `anthropic/claude-haiku-4-5`, optional-key progressive enhancement), `ai_narrations` cache/audit design, the event-label exclusion from the data boundary, alternatives considered (direct Anthropic SDK, hand-rolled fetch; generate-at-rebuild; ephemeral), consequences.
- `docs/SECURITY_MODEL.md` — document `ai_narrations` (owner-only RLS, no ownership trigger needed — no cross-table FK), and the AI data boundary (what leaves the app, what never does, logging redaction).
- `docs/KNOWN_LIMITATIONS.md` — add: narration is single-shot (no streaming); driver references are type-level only (labels excluded by policy); cache rows accumulate one per data-change (no pruning yet).
- `docs/CURRENT_PHASE.md` — new slice section, next priorities, test status per the established format.
- `docs/ROADMAP.md` — mark Phase 4's first slice progress (service core + performance-brief narration ✅ when done).

- [ ] **Step 4: Full verification**

Run: `pnpm check` — expected green (lint 0 errors / 1 pre-existing `AccountSheet.tsx` warning, typecheck clean, all unit tests passing, build with all routes compiling).
Run: `pnpm test:rls` — expected 38/38.
Run: `pnpm test:e2e` — expected all passing, twice.

**Live browse QA** (requires a real `AI_GATEWAY_API_KEY` in `.env.local` — ask the user for one if absent; this is the one step that cannot run keyless): at 390×844 and 1280×900 — cold load generates and renders the AI brief with the "AI narrative · numbers calculated" chip; reload serves the cached row (verify via `ai_narrations` row count staying at 1); "How is this generated?" disclosure lists the exact input metrics; delete the key → deterministic brief returns with "Calculated" chip; zero console errors throughout. Verify a `ai_narrations` row's `input_json` contains no label/merchant text.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/smoke.spec.ts docs/
git commit -m "test(ai): keyless e2e guard + docs for AI interpreter core slice"
```

---

## Plan Self-Review (completed)

- **Spec coverage:** provider-agnostic service (T1/T5), Zod I/O boundary (T2), policy prompt (T4), hash/cache/audit (T3/T6/T8), input assembly with label exclusion (T7), Suspense UI + disclosure + chips (T9), keyless degradation + e2e + docs (T10). Redacted logging = `ai_narrations` rows + the no-values `console.error` rule (T8).
- **Placeholders:** none; every step has code or exact commands.
- **Type consistency:** `NarrationInput`/`NarrationOutput`/`NarrationSource`/`NarrationResult` names and shapes match across T2/T5/T7/T8/T9; `generateNarration` and `getOrGenerateNarration` signatures consistent.
- **Known uncertainty flagged inline:** mock-model export name (`MockLanguageModelV4` vs `V3`) and `timeout` vs `abortSignal` typing in the installed `ai` version — both have explicit verify-and-adapt instructions in Task 5.
