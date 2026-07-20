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
