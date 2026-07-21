// src/lib/concepts/types.ts
/**
 * PFI Academy concept system. Framework-free (no React/Next imports) so it
 * can be extracted to a package later, like financial-engine and demo-data.
 * Content is compile-time data validated by unit tests (registry.test.ts,
 * content.test.ts) — there is no runtime CMS.
 * Normative spec: docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md
 * Governance: docs/TERMINOLOGY.md
 */

/** Stable kebab-case slug, e.g. "free-cash-flow". The slug IS the id. */
export type ConceptId = string;

/**
 * What household data must exist before a lesson's personalApplication can
 * render real figures (Slice 3+ renderers check this; Slice 1 only declares it).
 */
export type DataRequirement =
  | "income-transactions"
  | "spending-transactions"
  | "balance-history"
  | "debt-accounts"
  | "recurring-obligations";

export type KnowledgeCheck =
  | { kind: "interpretation"; prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "identify-figure"; prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "which-action"; prompt: string; choices: string[]; correctIndex: number; explanation: string };

export interface PersonalApplication {
  /**
   * Namespaced engine binding — never a literal figure:
   *   "metric:<metric registry id>"      e.g. "metric:liquid_runway_months"
   *   "report:<PeriodStatement field>"   e.g. "report:freeCashFlow"
   *   "snapshot:<DailySnapshot field>"   e.g. "snapshot:netWorth"
   *   "position:<position.ts function>"  e.g. "position:availablePosition"
   * Validated against the real engine in content.test.ts.
   */
  metricKey: string;
  /** How renderers frame positive/negative/strengthening/weakening/unavailable. Neutral tone only. */
  interpretationRules: string;
  requiresData: DataRequirement[];
}

/** The 10-part lesson template (spec §Lesson template). */
export interface Lesson {
  intro: string;                      // 1. plain language, assumes zero prior knowledge
  standardTerm: string;               // 2. the real terminology and how business/investing uses it
  whyItMattersExtended?: string;      // 3. optional extension of concept.whyItMatters
  calculation?: { formula: string; walkthrough: string }; // 4.
  genericExample: string;             // 5. Rivera-household sample, labeled as sample
  personalApplication?: PersonalApplication; // 6–7. binding, not prose
  commonMisunderstanding: string;     // 8.
  knowledgeCheck: KnowledgeCheck[];   // 9. one or two items (validated)
  reinforcementPreview: string;       // 10. where this appears throughout PFI
}

export interface FinancialConcept {
  id: ConceptId;
  title: string;                      // canonical name, e.g. "Free cash flow"
  shortDefinition: string;            // one sentence; the pre-completion tap definition
  fullDefinition: string;
  whyItMatters: string;
  formula?: string;                   // display string, e.g. "Revenue − operating expenses"
  /** Required when the household formula differs from the strict business definition. */
  householdAdaptation?: string;
  businessContext?: string;
  commonMisunderstanding?: string;
  relatedConceptIds: ConceptId[];
  prerequisiteConceptIds: ConceptId[];
  dataMetricKey?: string;             // same namespace as PersonalApplication.metricKey
  status: "draft" | "published" | "archived";
  lesson?: Lesson;                    // absent = glossary-only record
}

export interface Module {
  id: string;
  title: string;
  order: number;
  /** Lesson order = array order. Glossary-only concepts may appear here too (taught inline). */
  conceptIds: ConceptId[];
}
