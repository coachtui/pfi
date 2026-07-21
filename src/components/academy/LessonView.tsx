"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { startLesson } from "@/app/actions/academy";
import { useTermSheet } from "@/components/concepts/TermSheetProvider";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { adjacentLessons, lessonConcept, type CheckResponse } from "@/lib/concepts/progress";
import { KnowledgeChecks } from "./KnowledgeChecks";
import { LessonSections } from "./LessonSections";

const TABS = [
  { key: "lesson", label: "Lesson" },
  { key: "related", label: "Related" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function LessonView({
  conceptId, initialResponses, initialCompleted,
}: {
  conceptId: string;
  initialResponses: CheckResponse[];
  initialCompleted: boolean;
}) {
  // The page validated the id; non-null here.
  const concept = lessonConcept(CONCEPT_REGISTRY, conceptId)!;
  const [tab, setTab] = useState<TabKey>("lesson");
  const { openTerm } = useTermSheet();
  const { prev, next } = adjacentLessons(CONCEPT_REGISTRY, conceptId);
  const prevConcept = prev ? CONCEPT_REGISTRY.byId(prev) : null;
  const nextConcept = next ? CONCEPT_REGISTRY.byId(next) : null;

  useEffect(() => {
    // Idempotent upsert; a failure only delays "In progress" until an answer lands.
    void startLesson(conceptId);
  }, [conceptId]);

  function onTablistKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const nextIndex = event.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
    setTab(TABS[nextIndex]!.key);
    document.getElementById(`tab-${TABS[nextIndex]!.key}`)?.focus();
  }

  const related = concept.relatedConceptIds
    .map((id) => CONCEPT_REGISTRY.byId(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.status === "published");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-primary">{concept.title}</h1>
        <p className="mt-1 text-sm text-secondary">{concept.shortDefinition}</p>
      </header>

      <div role="tablist" aria-label="Lesson sections" onKeyDown={onTablistKeyDown}
        className="flex rounded-full border border-border-subtle bg-inset p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            className={`min-h-8 flex-1 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.key ? "bg-elevated-2 text-primary shadow-card" : "text-secondary hover:text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="panel-lesson" role="tabpanel" aria-labelledby="tab-lesson" hidden={tab !== "lesson"}
        className="flex flex-col gap-6">
        <LessonSections concept={concept} />
        <KnowledgeChecks
          conceptId={conceptId}
          checks={concept.lesson!.knowledgeCheck}
          initialResponses={initialResponses}
          initialCompleted={initialCompleted}
        />
      </div>

      <div id="panel-related" role="tabpanel" aria-labelledby="tab-related" hidden={tab !== "related"}
        className="flex flex-col gap-4">
        {concept.businessContext && (
          <section>
            <h2 className="mb-1 text-sm font-semibold text-primary">In business terms</h2>
            <p className="text-sm leading-relaxed text-secondary">{concept.businessContext}</p>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">Related concepts</h2>
          {related.map((r) =>
            r.lesson ? (
              <Link key={r.id} href={`/academy/${r.id}`}
                className="flex flex-col rounded-xl border border-border-subtle bg-inset p-3 transition-colors hover:border-border-strong">
                <span className="text-sm font-medium text-primary">{r.title}</span>
                <span className="text-xs text-secondary">{r.shortDefinition}</span>
              </Link>
            ) : (
              <button key={r.id} type="button" onClick={() => openTerm(r.id)}
                className="flex flex-col rounded-xl border border-border-subtle bg-inset p-3 text-left transition-colors hover:border-border-strong">
                <span className="text-sm font-medium text-primary">{r.title}</span>
                <span className="text-xs text-secondary">{r.shortDefinition}</span>
              </button>
            ),
          )}
        </section>
      </div>

      <nav aria-label="Lesson pager" className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
        {prevConcept ? (
          <Link href={`/academy/${prevConcept.id}`} className="flex items-center gap-1 text-xs text-secondary hover:text-primary">
            <ChevronLeft size={14} aria-hidden /> {prevConcept.title}
          </Link>
        ) : <span />}
        {nextConcept ? (
          <Link href={`/academy/${nextConcept.id}`} className="flex items-center gap-1 text-xs text-secondary hover:text-primary">
            {nextConcept.title} <ChevronRight size={14} aria-hidden />
          </Link>
        ) : <span />}
      </nav>
    </div>
  );
}
