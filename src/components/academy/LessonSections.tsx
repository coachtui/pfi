import type { ReactNode } from "react";
import type { FinancialConcept } from "@/lib/concepts";
import type { ConceptLiveData } from "@/lib/data/concept-live";
import { ComparisonRows } from "@/components/concepts/ComparisonRows";
import { FormulaBlock } from "@/components/concepts/FormulaBlock";
import { WhereUsedList } from "@/components/concepts/WhereUsedList";
import { HouseholdApplication } from "./HouseholdApplication";

/**
 * The lesson framework (spec §Lesson page). Sections render conditionally so
 * concepts not yet migrated to the new fields keep their Slice 3 layout;
 * the memorable-distinction callout sits unnumbered after the opening.
 */
export function LessonSections({
  concept,
  live,
}: {
  concept: FinancialConcept;
  live: ConceptLiveData | null;
}) {
  const lesson = concept.lesson!;
  const legacyFormula = lesson.calculation?.formula ?? concept.formula;

  const sections: { title: string; body: ReactNode }[] = [
    { title: lesson.openingHeading ?? `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.opening}</p> },
    { title: "The standard term", body: <p>{lesson.standardTerm}</p> },
    {
      title: "Why it matters",
      body: <p>{[concept.whyItMatters, lesson.whyItMattersExtended].filter(Boolean).join(" ")}</p>,
    },
    ...(lesson.calculation
      ? [{
          title: "How it's calculated",
          body: (
            <>
              {concept.formulaRows && concept.formula ? (
                <>
                  {concept.formulaRows.some((r) => r.staticValue !== undefined) && (
                    <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
                      Sample figures
                    </span>
                  )}
                  <FormulaBlock rows={concept.formulaRows} fallbackText={concept.formula} />
                </>
              ) : legacyFormula ? (
                <p className="rounded-lg bg-inset p-2 font-mono text-sm text-primary">{legacyFormula}</p>
              ) : null}
              <p className="mt-2">{lesson.calculation.walkthrough}</p>
            </>
          ),
        }]
      : []),
    {
      title: "Applied to your household",
      body: <HouseholdApplication live={live} genericExample={lesson.genericExample} />,
    },
    ...(concept.interpretation
      ? [{ title: "How to read it", body: <p>{concept.interpretation}</p> }]
      : []),
    {
      title: "Common misunderstanding",
      body: (
        <p className="rounded-xl border border-border-subtle bg-inset p-3">{lesson.commonMisunderstanding}</p>
      ),
    },
    ...(concept.whereUsed?.length
      ? [{ title: "Where you'll see this in PFI", body: <WhereUsedList items={concept.whereUsed} /> }]
      : lesson.reinforcementPreview
        ? [{ title: "Where you'll see this in PFI", body: <p>{lesson.reinforcementPreview}</p> }]
        : []),
  ];

  const [first, ...rest] = sections;

  return (
    <div className="flex flex-col gap-5">
      <section key={first!.title}>
        <h2 className="mb-1 text-sm font-semibold text-primary">1. {first!.title}</h2>
        <div className="text-sm leading-relaxed text-secondary">{first!.body}</div>
      </section>

      {concept.memorableDistinction && (
        <div className="rounded-xl border border-border-strong bg-inset p-4">
          <p className="text-base font-semibold text-primary">{concept.memorableDistinction}</p>
          {concept.comparisonRows && concept.comparisonRows.length > 0 && (
            <div className="mt-3">
              <ComparisonRows rows={concept.comparisonRows} />
            </div>
          )}
        </div>
      )}

      {rest.map((s, i) => (
        <section key={s.title}>
          <h2 className="mb-1 text-sm font-semibold text-primary">
            {i + 2}. {s.title}
          </h2>
          <div className="text-sm leading-relaxed text-secondary">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
