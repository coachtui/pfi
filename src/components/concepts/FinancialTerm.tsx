"use client";

import type { ReactNode } from "react";
import { CONCEPT_REGISTRY, type ConceptId } from "@/lib/concepts";
import { useTermSheet } from "./TermSheetProvider";

/**
 * Inline tappable financial term. Opens the definition sheet for `conceptId`.
 * If the id is not a published concept, renders the children as plain text
 * (never a broken control) — miswires are caught by label-consistency.test.ts.
 * Affordance is shape-based (dashed underline), never color, per project rules.
 */
export function FinancialTerm({ conceptId, children }: { conceptId: ConceptId; children: ReactNode }) {
  const { openTerm } = useTermSheet();
  const concept = CONCEPT_REGISTRY.byId(conceptId);

  if (!concept || concept.status !== "published") return <>{children}</>;

  return (
    <button
      type="button"
      onClick={() => openTerm(conceptId)}
      aria-label={`${concept.title} — show definition`}
      className="rounded-sm underline decoration-dotted decoration-tertiary underline-offset-2 hover:decoration-secondary focus:outline-none focus-visible:decoration-primary focus-visible:decoration-solid"
    >
      {children}
    </button>
  );
}
