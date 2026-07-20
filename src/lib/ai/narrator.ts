import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { env } from "@/lib/config/env";
import { BRIEF_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import {
  briefOutputSchema,
  referencesOnlyKnownDrivers,
  bodyOnlyReferencesKnownAmounts,
  bodyDoesNotMislabelScore,
  type BriefInput,
  type BriefOutput,
} from "./schemas";

export interface NarratorOptions {
  /** DI/test override; defaults to the gateway model string from env. */
  model?: LanguageModel;
  timeoutMs?: number;
}

/**
 * Provider-agnostic narration call. Returns null on EVERY failure —
 * missing key, provider error, timeout, schema violation, invented
 * driver, hallucinated dollar figure, or a narration that mislabels the
 * PFI Score as a credit score — so callers fall back to the deterministic
 * brief and unvalidated text is never rendered.
 */
export async function generateNarration(
  input: BriefInput,
  opts: NarratorOptions = {},
): Promise<BriefOutput | null> {
  const model =
    opts.model ?? (env.AI_GATEWAY_API_KEY ? env.PFI_AI_MODEL : undefined);
  if (!model) return null;
  try {
    const { object } = await generateObject({
      model,
      schema: briefOutputSchema,
      system: BRIEF_SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      temperature: 0.4,
    });
    if (!referencesOnlyKnownDrivers(input, object)) return null;
    if (!bodyOnlyReferencesKnownAmounts(input, object)) return null;
    if (!bodyDoesNotMislabelScore(object)) return null;
    return object;
  } catch {
    return null;
  }
}
