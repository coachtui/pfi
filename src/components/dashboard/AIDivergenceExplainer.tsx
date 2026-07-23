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
