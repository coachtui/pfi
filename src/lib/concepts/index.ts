// src/lib/concepts/index.ts
import { ALL_CONCEPTS } from "./content";
import { MODULES } from "./modules";
import { buildRegistry } from "./registry";

export type { ConceptId, DataRequirement, FinancialConcept, KnowledgeCheck, Lesson, Module, PersonalApplication } from "./types";
export { buildRegistry, validateRegistry, type ConceptRegistry } from "./registry";
export { ALL_CONCEPTS } from "./content";
export { MODULES } from "./modules";
export {
  academyTallies, adjacentLessons, appendCheckResponse, conceptStatus,
  lessonConcept, lessonSequence, nextUpLesson, recentlyCompleted, validateCheckAnswer,
} from "./progress";
export type {
  AcademyTallies, CheckResponse, ConceptProgressStatus, ProgressRow, RecentCompletion,
} from "./progress";

export const CONCEPT_REGISTRY = buildRegistry(ALL_CONCEPTS, MODULES);
