// src/lib/concepts/term-sheet.ts
// Framework-free (no React/Next). Builds the pre-completion definition-sheet
// view-model from the concept registry. Slice 2 (docs/superpowers/plans/2026-07-20-academy-slice2-financial-term.md).
import type { ConceptRegistry } from "./registry";
import type { ConceptId, FinancialConcept } from "./types";

export interface TermSheetRelated {
  id: ConceptId;
  title: string;
}

export interface TermSheetModel {
  id: ConceptId;
  title: string;
  shortDefinition: string;
  fullDefinition: string;
  formula?: string;
  householdAdaptation?: string;
  related: TermSheetRelated[];
}

/**
 * Build the definition-sheet view-model for a concept. Returns null when the
 * concept is missing or not published, so callers render nothing (FinancialTerm
 * degrades to plain text). Related concepts are filtered to published records.
 */
export function buildTermSheetModel(
  registry: ConceptRegistry,
  conceptId: ConceptId,
): TermSheetModel | null {
  const c = registry.byId(conceptId);
  if (!c || c.status !== "published") return null;

  const related: TermSheetRelated[] = c.relatedConceptIds
    .map((id) => registry.byId(id))
    .filter((r): r is FinancialConcept => !!r && r.status === "published")
    .map((r) => ({ id: r.id, title: r.title }));

  return {
    id: c.id,
    title: c.title,
    shortDefinition: c.shortDefinition,
    fullDefinition: c.fullDefinition,
    formula: c.formula,
    householdAdaptation: c.householdAdaptation,
    related,
  };
}
