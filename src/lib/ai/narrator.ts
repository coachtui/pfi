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
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      temperature: 0.4,
    });
    if (!referencesOnlyKnownDrivers(input, object)) return null;
    return object;
  } catch {
    return null;
  }
}
