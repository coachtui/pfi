"use client";

import { ChevronLeft } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { ConceptId } from "@/lib/concepts";
import type { TermSheetModel } from "@/lib/concepts/term-sheet";

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
    <Sheet open={model !== null} onClose={onClose} title={model?.title ?? ""}>
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

          <p className="text-base leading-relaxed text-primary">{model.shortDefinition}</p>
          <p className="text-sm leading-relaxed text-secondary">{model.fullDefinition}</p>

          {model.formula && (
            <div className="rounded-xl border border-border-subtle bg-inset p-3">
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
              <p className="font-mono text-sm text-primary">{model.formula}</p>
              {model.householdAdaptation && (
                <p className="mt-2 text-xs text-tertiary">Household: {model.householdAdaptation}</p>
              )}
            </div>
          )}

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
        </div>
      )}
    </Sheet>
  );
}
