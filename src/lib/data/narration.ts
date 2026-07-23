import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { env } from "@/lib/config/env";
import { narrationInputHash } from "@/lib/ai/hash";
import {
  buildBriefInput,
  buildDivergenceInput,
  buildDriverExplanationsInput,
  type NarrationSource,
} from "@/lib/ai/input";
import { generateNarration } from "@/lib/ai/narrator";
import {
  BRIEF_SURFACE,
  DIVERGENCE_SURFACE,
  DRIVER_EXPLANATIONS_SURFACE,
  briefOutputSchema,
  divergenceOutputSchema,
  driverExplanationsOutputSchema,
  type BriefInput,
  type BriefOutput,
  type DivergenceInput,
  type DivergenceOutput,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
} from "@/lib/ai/schemas";

export interface BriefNarrationResult {
  output: BriefOutput;
  input: BriefInput;
}

export interface DriverExplanationsResult {
  output: DriverExplanationsOutput;
  input: DriverExplanationsInput;
}

export interface DivergenceNarrationResult {
  output: DivergenceOutput;
  input: DivergenceInput;
}

/** Per-surface wiring: input assembly for each surface. */
const SURFACES = {
  [BRIEF_SURFACE]: {
    buildInput: buildBriefInput,
  },
  [DRIVER_EXPLANATIONS_SURFACE]: {
    buildInput: buildDriverExplanationsInput,
  },
  [DIVERGENCE_SURFACE]: {
    buildInput: buildDivergenceInput,
  },
} as const;

/**
 * Best-effort cache lookup for a previously generated + schema-validated
 * narration row. A read error is logged (failure class only, never metric
 * values) and treated as a miss so the caller falls through to generation.
 */
async function readCachedOutput<TOutput>(
  supabase: SupabaseClient,
  surface: string,
  inputHash: string,
  outputSchema: z.ZodType<TOutput>,
): Promise<TOutput | null> {
  const { data: cached, error } = await supabase
    .from("ai_narrations")
    .select("output_json")
    .eq("surface", surface)
    .eq("input_hash", inputHash)
    .maybeSingle();
  if (error) {
    // Redaction rule: log the failure class only, never metric values.
    console.error("[ai] narration cache read failed:", error.message);
  }
  if (!cached) return null;
  const parsed = outputSchema.safeParse(cached.output_json);
  return parsed.success ? parsed.data : null;
}

/**
 * Best-effort cache write, isolated in its own try/catch: a transient DB
 * error persisting the cache row must not discard a successful generation
 * the caller already has in hand.
 */
async function writeCachedOutput(
  supabase: SupabaseClient,
  surface: string,
  inputHash: string,
  input: unknown,
  output: unknown,
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await supabase.from("ai_narrations").upsert(
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
    if (error) {
      console.error("[ai] narration cache write failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[ai] narration cache write failed:",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Cache-or-generate for a narration surface. Returns null (and NEVER
 * rejects) on any failure so the dashboard falls back to the deterministic
 * rendering — callers pass this promise into React `use()`, where a
 * rejection would trip an error boundary instead of the intended graceful
 * fallback. Failures are not cached — the next load retries.
 */
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
  surface: typeof DIVERGENCE_SURFACE,
  source: NarrationSource,
): Promise<DivergenceNarrationResult | null>;
export async function getOrGenerateNarration(
  supabase: SupabaseClient,
  surface: keyof typeof SURFACES,
  source: NarrationSource,
): Promise<BriefNarrationResult | DriverExplanationsResult | DivergenceNarrationResult | null> {
  try {
    if (!env.AI_GATEWAY_API_KEY) return null;
    const config = SURFACES[surface];
    const input = config.buildInput(source);
    if (!input) return null;
    const inputHash = narrationInputHash(input);

    // generateNarration (Task 5) and each surface's output schema are keyed
    // to the input's own discriminant, not the wider union SURFACES[surface]
    // produces here — branch explicitly on `input.surface` so every call
    // below hits its correctly-narrowed overload and every returned object
    // pairs an input with its matching output type.
    if (input.surface === BRIEF_SURFACE) {
      const cachedOutput = await readCachedOutput(supabase, surface, inputHash, briefOutputSchema);
      if (cachedOutput) return { output: cachedOutput, input };

      const output = await generateNarration(input);
      if (!output) return null;
      await writeCachedOutput(supabase, surface, inputHash, input, output);
      return { output, input };
    }

    if (input.surface === DIVERGENCE_SURFACE) {
      const cachedOutput = await readCachedOutput(
        supabase,
        surface,
        inputHash,
        divergenceOutputSchema,
      );
      if (cachedOutput) return { output: cachedOutput, input };
      const output = await generateNarration(input);
      if (!output) return null;
      await writeCachedOutput(supabase, surface, inputHash, input, output);
      return { output, input };
    }

    const cachedOutput = await readCachedOutput(
      supabase,
      surface,
      inputHash,
      driverExplanationsOutputSchema,
    );
    if (cachedOutput) return { output: cachedOutput, input };

    const output = await generateNarration(input);
    if (!output) return null;
    await writeCachedOutput(supabase, surface, inputHash, input, output);
    return { output, input };
  } catch (err) {
    console.error(
      "[ai] narration generation failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
