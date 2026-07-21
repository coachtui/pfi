"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import { answerKnowledgeCheck } from "@/app/actions/academy";
import type { KnowledgeCheck } from "@/lib/concepts";
import type { CheckResponse } from "@/lib/concepts/progress";

export function KnowledgeChecks({
  conceptId, checks, initialResponses, initialCompleted,
}: {
  conceptId: string;
  checks: KnowledgeCheck[];
  initialResponses: CheckResponse[];
  initialCompleted: boolean;
}) {
  const [responses, setResponses] = useState<CheckResponse[]>(initialResponses);
  const [completed, setCompleted] = useState(initialCompleted);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const answerFor = (checkIndex: number) => responses.find((r) => r.checkIndex === checkIndex);

  function choose(checkIndex: number, choiceIndex: number) {
    if (answerFor(checkIndex) || pending) return;
    setError("");
    startTransition(async () => {
      const result = await answerKnowledgeCheck(conceptId, checkIndex, choiceIndex);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResponses(result.responses ?? []);
      setCompleted(!!result.completed);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-primary">Check your understanding</h2>

      {checks.map((check, i) => {
        const answered = answerFor(i);
        return (
          <div
            key={i}
            role="group"
            aria-label={`Knowledge check ${i + 1} of ${checks.length}`}
            className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-inset p-3"
          >
            <p className="text-sm text-primary">{check.prompt}</p>
            {check.choices.map((choice, c) => {
              const isCorrect = c === check.correctIndex;
              const isChosen = answered?.choiceIndex === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={!!answered || pending}
                  onClick={() => choose(i, c)}
                  className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors ${
                    isChosen ? "border-border-strong text-primary" : "border-border-subtle text-secondary"
                  } ${answered ? "" : "hover:border-border-strong hover:text-primary"}`}
                >
                  <span>{choice}</span>
                  {answered && isCorrect && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-positive">
                      <Check size={12} aria-hidden /> Correct answer
                    </span>
                  )}
                  {answered && isChosen && !isCorrect && (
                    <span className="shrink-0 text-[11px] text-tertiary">Your answer</span>
                  )}
                </button>
              );
            })}
            <div aria-live="polite">
              {answered && <p className="text-xs leading-relaxed text-secondary">{check.explanation}</p>}
            </div>
          </div>
        );
      })}

      {error && (
        <p role="alert" className="text-xs text-negative">
          {error} — your answer wasn&apos;t saved. Tap a choice to try again.
        </p>
      )}

      {completed && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-inset p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <CheckCircle2 size={16} aria-hidden className="text-positive" />
            Lesson complete
          </p>
          <p className="text-xs text-secondary">
            This term&apos;s definition sheet now includes its full analytical depth.
          </p>
          <Link
            href="/academy"
            className="self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
          >
            Back to Academy
          </Link>
        </div>
      )}
    </section>
  );
}
