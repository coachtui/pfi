"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ConceptId } from "@/lib/concepts";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { buildTermSheetModel } from "@/lib/concepts/term-sheet";
import { TermDefinitionSheet } from "./TermDefinitionSheet";

interface TermSheetApi {
  openTerm(id: ConceptId): void;
  pushTerm(id: ConceptId): void;
  backTerm(): void;
  closeTerm(): void;
}

const TermSheetContext = createContext<TermSheetApi | null>(null);

export function useTermSheet(): TermSheetApi {
  const ctx = useContext(TermSheetContext);
  if (!ctx) throw new Error("useTermSheet must be used within TermSheetProvider");
  return ctx;
}

export function TermSheetProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ConceptId[]>([]);

  const openTerm = useCallback((id: ConceptId) => setStack([id]), []);
  const pushTerm = useCallback((id: ConceptId) => setStack((s) => [...s, id]), []);
  const backTerm = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeTerm = useCallback(() => setStack([]), []);

  const api = useMemo<TermSheetApi>(
    () => ({ openTerm, pushTerm, backTerm, closeTerm }),
    [openTerm, pushTerm, backTerm, closeTerm],
  );

  const currentId = stack.at(-1) ?? null;
  const model = currentId ? buildTermSheetModel(CONCEPT_REGISTRY, currentId) : null;

  return (
    <TermSheetContext.Provider value={api}>
      {children}
      <TermDefinitionSheet
        model={model}
        canGoBack={stack.length > 1}
        onBack={backTerm}
        onClose={closeTerm}
        onRelated={pushTerm}
      />
    </TermSheetContext.Provider>
  );
}
