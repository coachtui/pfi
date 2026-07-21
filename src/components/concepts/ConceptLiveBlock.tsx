"use client";

import { useEffect, useState } from "react";
import { getConceptLive } from "@/app/actions/academy";
import type { ConceptLiveData } from "@/lib/data/concept-live";

/**
 * Completed-state deepening: the user's current figure for this concept,
 * fetched lazily when the sheet opens. Renders nothing while loading and
 * nothing at all when the household lacks the data — never a fake value.
 */
export function ConceptLiveBlock({ conceptId }: { conceptId: string }) {
  const [live, setLive] = useState<ConceptLiveData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getConceptLive(conceptId).then((result) => {
      if (!cancelled && !result.error) setLive(result.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [conceptId]);

  if (!live) return null;
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Your data</p>
      <p className="text-sm text-primary">
        {live.periodLabel}: <span className="tabular font-semibold">{live.display}</span>
      </p>
      {live.deltaDisplay && <p className="mt-0.5 text-xs text-secondary">{live.deltaDisplay}</p>}
    </div>
  );
}
