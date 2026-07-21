"use client";

import { ChevronLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import type { ConceptId } from "@/lib/concepts";
import type { TermSheetModel } from "@/lib/concepts/term-sheet";
import { ClassificationLabel } from "./ClassificationLabel";
import { ConceptLiveBlock } from "./ConceptLiveBlock";
import { FormulaBlock } from "./FormulaBlock";
import { WhereUsedList } from "./WhereUsedList";

const CTA_LABEL = {
  "not-started": "Take the lesson",
  "in-progress": "Continue lesson",
  completed: "Review lesson",
} as const;

export function TermDefinitionSheet({
  model,
  canGoBack,
  onBack,
  onClose,
  onRelated,
}: {
  model: TermSheetModel | null;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onRelated: (id: ConceptId) => void;
}) {
  return (
    <Sheet open={model !== null} onClose={onClose} title={model?.title ?? ""} contentKey={model?.id}>
      {model && (
        <div className="flex flex-col gap-4">
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="-mt-1 flex items-center gap-1 self-start text-xs text-secondary hover:text-primary"
            >
              <ChevronLeft size={14} aria-hidden />
              Back
            </button>
          )}

          <div className="flex flex-col gap-1">
            <ClassificationLabel classification={model.classification} />
            {model.businessContext && (
              <p className="text-xs leading-relaxed text-tertiary">{model.businessContext}</p>
            )}
          </div>

          <p className="text-base leading-relaxed text-primary">{model.summary}</p>
          {model.detail && <p className="text-sm leading-relaxed text-secondary">{model.detail}</p>}

          {model.progress === "completed" && (
            <p className="flex items-center gap-1.5 text-xs text-secondary">
              <CheckCircle2 size={14} aria-hidden className="text-positive" />
              Academy concept completed
            </p>
          )}

          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Why it matters</p>
            <p className="text-sm leading-relaxed text-secondary">{model.whyItMatters}</p>
          </div>

          {model.formulaRows && model.formula ? (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
              <FormulaBlock rows={model.formulaRows} fallbackText={model.formula} showValues={false} />
              {model.householdAdaptation && (
                <p className="mt-2 text-xs text-tertiary">Household: {model.householdAdaptation}</p>
              )}
            </div>
          ) : (
            (model.formula || model.householdAdaptation) && (
              <div className="rounded-xl border border-border-subtle bg-inset p-3">
                {model.formula && (
                  <>
                    <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
                    <p className="font-mono text-sm text-primary">{model.formula}</p>
                  </>
                )}
                {model.householdAdaptation && (
                  <p className={model.formula ? "mt-2 text-xs text-tertiary" : "text-xs text-tertiary"}>
                    Household: {model.householdAdaptation}
                  </p>
                )}
              </div>
            )
          )}

          {model.whereUsed.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Where it appears</p>
              <WhereUsedList items={model.whereUsed} />
            </div>
          )}

          {model.progress === "completed" && model.dataMetricKey && <ConceptLiveBlock conceptId={model.id} />}

          {model.related.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-tertiary uppercase">Related</p>
              <div className="flex flex-wrap gap-2">
                {model.related.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRelated(r.id)}
                    className="rounded-full border border-border-subtle bg-inset px-3 py-1.5 text-xs text-primary hover:border-border-strong focus:border-border-strong focus:outline-none"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {model.hasLesson && (
            <Link
              href={`/academy/${model.id}`}
              onClick={onClose}
              className="mt-1 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
            >
              {CTA_LABEL[model.progress]}
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}
