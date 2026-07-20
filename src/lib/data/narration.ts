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
