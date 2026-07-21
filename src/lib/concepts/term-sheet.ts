// src/lib/concepts/term-sheet.ts
// Framework-free (no React/Next). Builds the definition-sheet view-model.
// Depth content (whyItMatters, businessContext, classification) is un-gated —
// shown at every progress state; completion only adds the live-data block
// (spec 2026-07-21-academy-content-refinement, decision #4).
import type { ConceptProgressStatus } from "./progress";
import type { ConceptRegistry } from "./registry";
import type { ConceptClassification, ConceptId, FinancialConcept, FormulaRow } from "./types";

export interface TermSheetRelated {
  id: ConceptId;
  title: string;
}

export interface TermSheetModel {
  id: ConceptId;
  title: string;
  classification: ConceptClassification;
  /** plainEnglishSummary when authored; shortDefinition otherwise. */
  summary: string;
  /** fullDefinition, only for concepts not yet migrated to plainEnglishSummary. */
  detail?: string;
  whyItMatters: string;
  businessContext?: string;
  formula?: string;
  formulaRows?: FormulaRow[];
  householdAdaptation?: string;
  whereUsed: string[];
  related: TermSheetRelated[];
  hasLesson: boolean;
  /** Always "not-started" for glossary-only concepts. */
  progress: ConceptProgressStatus;
  /** Present ⇒ the completed live block may fetch (via getConceptLive). */
  dataMetricKey?: string;
}

export function buildTermSheetModel(
  registry: ConceptRegistry,
  conceptId: ConceptId,
  opts?: { progress?: ConceptProgressStatus },
): TermSheetModel | null {
  const c = registry.byId(conceptId);
  if (!c || c.status !== "published") return null;

  const related: TermSheetRelated[] = c.relatedConceptIds
    .map((id) => registry.byId(id))
    .filter((r): r is FinancialConcept => !!r && r.status === "published")
    .map((r) => ({ id: r.id, title: r.title }));

  const hasLesson = !!c.lesson;
  const progress: ConceptProgressStatus = hasLesson ? (opts?.progress ?? "not-started") : "not-started";

  return {
    id: c.id,
    title: c.title,
    classification: c.classification,
    summary: c.plainEnglishSummary ?? c.shortDefinition,
    detail: c.plainEnglishSummary ? undefined : c.fullDefinition,
    whyItMatters: c.whyItMatters,
    businessContext: c.businessContext,
    formula: c.formula,
    formulaRows: c.formulaRows,
    householdAdaptation: c.householdAdaptation,
    whereUsed: c.whereUsed ?? [],
    related,
    hasLesson,
    progress,
    dataMetricKey: c.dataMetricKey,
  };
}
