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

export interface KnowledgeCheck {
  /** Stable persistence key, e.g. "revenue-check-1" — never re-derived from position. */
  id: string;
  kind: "interpretation" | "identify-figure" | "which-action";
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** How the term relates to established finance vocabulary (spec §Definition-sheet header). */
export type ConceptClassification = "standard_finance" | "household_adaptation" | "pfi_metric";

/** One line of a statement-style visual calculation. */
export interface FormulaRow {
  label: string;
  operator?: "+" | "-" | "=";
  /** Binds to a live figure; same namespace as PersonalApplication.metricKey. */
  valueKey?: string;
  /** Sample display value (must be presented labeled as sample). */
  staticValue?: string | number;
}

/** One included/excluded example supporting the memorable distinction. */
export interface ComparisonRow {
  label: string;
  included: boolean;
  explanation?: string;
}

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

/** The lesson template (spec §Lesson framework; named fields per decision #7). */
export interface Lesson {
  opening: string;                    // 1. household scenario, then names the standard term
  standardTerm: string;               // 2.
  whyItMattersExtended?: string;      // extends concept.whyItMatters
  calculation?: { formula?: string; walkthrough: string }; // formula legacy — concept.formulaRows preferred
  genericExample: string;             // Rivera-household sample, labeled as sample
  personalApplication?: PersonalApplication;
  commonMisunderstanding: string;
  knowledgeChecks: KnowledgeCheck[];  // 1–2 items, stable ids
  completionSummary?: string;         // completion-card copy; generic fluency fallback when absent
  reinforcementPreview?: string;      // legacy; superseded by concept.whereUsed on migrated concepts
}

export interface FinancialConcept {
  id: ConceptId;
  title: string;                      // canonical name, e.g. "Free cash flow"
  classification: ConceptClassification;
  shortDefinition: string;            // one sentence; the pre-completion tap definition
  fullDefinition: string;
  whyItMatters: string;
  /** One strong sentence for the definition sheet; sheet falls back to shortDefinition+fullDefinition when absent. */
  plainEnglishSummary?: string;
  /** The lesson's one retained takeaway, e.g. "Not every deposit is revenue." */
  memorableDistinction?: string;
  formula?: string;                   // display string, e.g. "Revenue − operating expenses"
  /** Required when the household formula differs from the strict business definition. */
  householdAdaptation?: string;
  businessContext?: string;
  commonMisunderstanding?: string;
  /** Structured calculation block; `formula` remains the accessible text fallback and is required alongside. */
  formulaRows?: FormulaRow[];
  comparisonRows?: ComparisonRow[];
  /** What increases/decreases mean — and don't mean — in context. Never "higher is always good". */
  interpretation?: string;
  relatedConceptIds: ConceptId[];
  prerequisiteConceptIds: ConceptId[];
  dataMetricKey?: string;             // same namespace as PersonalApplication.metricKey
  /** Surfaces where the concept actually appears in PFI. Supersedes lesson.reinforcementPreview when present. */
  whereUsed?: string[];
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
