"use server";

import { createClient } from "@/lib/supabase/server";
import {
  csvMappingAiInputSchema,
  generateCsvMappingSuggestion,
  type CsvMappingAiInput,
} from "@/lib/csv-import/ai-mapping";
import type { CsvMappingSuggestion } from "@/lib/csv-import/types";

export async function suggestCsvMapping(
  input: CsvMappingAiInput,
): Promise<{ suggestion: CsvMappingSuggestion | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { suggestion: null };
  const parsed = csvMappingAiInputSchema.safeParse(input);
  if (!parsed.success) return { suggestion: null };
  return { suggestion: await generateCsvMappingSuggestion(parsed.data) };
}
