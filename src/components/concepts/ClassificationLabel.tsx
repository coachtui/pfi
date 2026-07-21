import type { ConceptClassification } from "@/lib/concepts";

const LABELS: Record<ConceptClassification, string> = {
  standard_finance: "Standard finance term",
  household_adaptation: "Household adaptation",
  pfi_metric: "PFI metric",
};

/** Subtle text label — never a dominant badge (spec §Definition-sheet header). */
export function ClassificationLabel({ classification }: { classification: ConceptClassification }) {
  return (
    <p className="text-xs font-medium tracking-wide text-tertiary uppercase">{LABELS[classification]}</p>
  );
}
