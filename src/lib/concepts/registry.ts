import type { FinancialConcept, Module } from "./types";

export interface ConceptRegistry {
  byId(id: string): FinancialConcept | undefined;
  published(): FinancialConcept[];
  forModule(moduleId: string): FinancialConcept[];
  concepts: FinancialConcept[];
  modules: Module[];
}

export function buildRegistry(concepts: FinancialConcept[], modules: Module[]): ConceptRegistry {
  const map = new Map(concepts.map((c) => [c.id, c]));
  const sortedModules = [...modules].sort((a, b) => a.order - b.order);
  return {
    concepts,
    modules: sortedModules,
    byId: (id) => map.get(id),
    published: () => concepts.filter((c) => c.status === "published"),
    forModule: (moduleId) => {
      const m = modules.find((x) => x.id === moduleId);
      return m ? m.conceptIds.flatMap((id) => map.get(id) ?? []) : [];
    },
  };
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Returns a list of human-readable problems; empty array = valid. */
export function validateRegistry(concepts: FinancialConcept[], modules: Module[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const c of concepts) {
    if (ids.has(c.id)) errors.push(`duplicate concept id: ${c.id}`);
    ids.add(c.id);
    if (!KEBAB.test(c.id)) errors.push(`concept id is not kebab-case: ${c.id}`);
  }

  for (const c of concepts) {
    for (const rel of c.relatedConceptIds) {
      if (!ids.has(rel)) errors.push(`${c.id}: unknown relatedConceptId ${rel}`);
    }
    for (const pre of c.prerequisiteConceptIds) {
      if (!ids.has(pre)) errors.push(`${c.id}: unknown prerequisiteConceptId ${pre}`);
    }
    const checks = c.lesson?.knowledgeCheck;
    if (checks && (checks.length < 1 || checks.length > 2)) {
      errors.push(`${c.id}: lessons need 1–2 knowledge checks, found ${checks.length}`);
    }
    for (const [i, check] of (checks ?? []).entries()) {
      if (check.correctIndex < 0 || check.correctIndex >= check.choices.length) {
        errors.push(`${c.id}: knowledge check ${i} correctIndex out of bounds`);
      }
    }
  }

  // Prerequisite cycle detection (DFS, three-color).
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const visit = (id: string): boolean => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "visiting") return true;
    state.set(id, "visiting");
    const found = (byId.get(id)?.prerequisiteConceptIds ?? []).some((pre) => byId.has(pre) && visit(pre));
    state.set(id, "done");
    return found;
  };
  for (const c of concepts) {
    if (state.get(c.id) === undefined && visit(c.id)) {
      errors.push(`prerequisite cycle involving ${c.id}`);
      break;
    }
  }

  for (const m of modules) {
    for (const cid of m.conceptIds) {
      if (!ids.has(cid)) errors.push(`module ${m.id}: unknown concept ${cid}`);
    }
  }

  return errors;
}
