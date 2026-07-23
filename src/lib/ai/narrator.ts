import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { env } from "@/lib/config/env";
import { SYSTEM_PROMPTS, buildUserPrompt } from "./prompts";
import {
  briefOutputSchema,
  driverExplanationsOutputSchema,
  divergenceOutputSchema,
  referencesOnlyKnownDrivers,
  bodyOnlyReferencesKnownAmounts,
  bodyDoesNotMislabelScore,
  explanationsCoverExactlyKnownDrivers,
  explanationAmountsAreKnown,
  explanationsDoNotMislabelScore,
  bodyIsDirectionConsistent,
  textDoesNotMislabelScore,
  DIVERGENCE_SURFACE,
  type BriefInput,
  type BriefOutput,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
  type DivergenceInput,
  type DivergenceOutput,
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
  input: DivergenceInput,
  opts?: NarratorOptions,
): Promise<DivergenceOutput | null>;
export async function generateNarration(
  input: NarrationInput,
  opts: NarratorOptions = {},
): Promise<BriefOutput | DriverExplanationsOutput | DivergenceOutput | null> {
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
  if (input.surface === DIVERGENCE_SURFACE) {
    const output = await generate(model, input, divergenceOutputSchema, opts);
    if (!output) return null;
    if (!textDoesNotMislabelScore(output.body)) return null;
    if (!bodyIsDirectionConsistent(input, output)) return null;
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
    // generateObject's return type is a conditional type keyed on a
    // default-inferred OUTPUT parameter that doesn't collapse against a
    // generic `Schema extends z.ZodType` here; the runtime shape is exactly
    // z.infer<Schema> because `schema` is always passed directly.
    return object as z.infer<Schema>;
  } catch {
    return null;
  }
}
