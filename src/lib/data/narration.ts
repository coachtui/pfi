import "server-only";
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
 * deterministic brief — Task 9 passes this promise into React `use()`,
 * where a rejection would trip an error boundary instead of the intended
 * graceful fallback. Failures are not cached — the next load retries.
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

    const { data: cached, error: cacheReadError } = await supabase
      .from("ai_narrations")
      .select("output_json")
      .eq("surface", NARRATION_SURFACE)
      .eq("input_hash", inputHash)
      .maybeSingle();
    if (cacheReadError) {
      // Redaction rule: log the failure class only, never metric values.
      // Falls through to regeneration either way — a persistent read
      // failure (e.g. an RLS regression) should be diagnosable, not silent.
      console.error("[ai] narration cache read failed:", cacheReadError.message);
    }
    if (cached) {
      const parsed = narrationOutputSchema.safeParse(cached.output_json);
      if (parsed.success) return { output: parsed.data, input };
    }

    const output = await generateNarration(input);
    if (!output) return null;

    // Persistence is best-effort and isolated in its own try/catch: a
    // transient DB error writing to the cache must not discard a successful
    // generation. If this were inside the outer try, an upsert failure would
    // fall into the outer catch and return null, wasting a good narration
    // and forcing a re-generation (cost + latency) on the very next load.
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { error: upsertError } = await supabase.from("ai_narrations").upsert(
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
        if (upsertError) {
          // Redaction rule: log the failure class only, never metric values.
          console.error("[ai] narration cache write failed:", upsertError.message);
        }
      }
    } catch (err) {
      // Redaction rule: log the failure class only, never metric values.
      console.error(
        "[ai] narration cache write failed:",
        err instanceof Error ? err.message : "unknown",
      );
    }

    return { output, input };
  } catch (err) {
    // Redaction rule: log the failure class only, never metric values.
    console.error(
      "[ai] narration generation failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
