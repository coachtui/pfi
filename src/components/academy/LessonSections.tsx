import type { ReactNode } from "react";
import type { FinancialConcept } from "@/lib/concepts";

/** The 10-part lesson template, numbered. personalApplication is Slice 4. */
export function LessonSections({ concept }: { concept: FinancialConcept }) {
  const lesson = concept.lesson!;
  const sections: { title: string; body: ReactNode }[] = [
    { title: `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.intro}</p> },
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
              <p className="rounded-lg bg-inset p-2 font-mono text-sm text-primary">
                {lesson.calculation.formula}
              </p>
              <p className="mt-2">{lesson.calculation.walkthrough}</p>
            </>
          ),
        }]
      : []),
    {
      title: "A sample household",
      body: (
        <>
          <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
            Sample data
          </span>
          <p>{lesson.genericExample}</p>
        </>
      ),
    },
    { title: "Common misunderstanding", body: <p>{lesson.commonMisunderstanding}</p> },
    { title: "Where you'll see this in PFI", body: <p>{lesson.reinforcementPreview}</p> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {sections.map((s, i) => (
        <section key={s.title}>
          <h2 className="mb-1 text-sm font-semibold text-primary">
            {i + 1}. {s.title}
          </h2>
          <div className="text-sm leading-relaxed text-secondary">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
