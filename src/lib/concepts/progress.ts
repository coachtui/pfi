// Framework-free (no React/Next). Derives Academy progress state from the
// registry + academy_progress rows. Status is always derived, never stored;
// answer correctness is never persisted (deterministic code calculates).
// Spec: docs/superpowers/specs/2026-07-21-academy-slice3-home-lesson-progress-design.md
import type { ConceptRegistry } from "./registry";
import type { ConceptId, FinancialConcept } from "./types";

export interface CheckResponse {
  checkId: string;
  choiceIndex: number;
}

export interface ProgressRow {
  conceptId: ConceptId;
  startedAt: string; // ISO timestamp
  completedAt: string | null;
  checkResponses: CheckResponse[];
}

export type ConceptProgressStatus = "not-started" | "in-progress" | "completed";

export function conceptStatus(row: ProgressRow | undefined): ConceptProgressStatus {
  if (!row) return "not-started";
  return row.completedAt ? "completed" : "in-progress";
}

/** The canonical lesson order: published lesson-bearing concept ids, module by module. */
export function lessonSequence(registry: ConceptRegistry): ConceptId[] {
  return registry.modules.flatMap((m) =>
    m.conceptIds.filter((id) => {
      const c = registry.byId(id);
      return !!c && c.status === "published" && !!c.lesson;
    }),
  );
}

export interface AcademyTallies {
  lessonsCompleted: number;
  lessonsTotal: number;
  modulesCompleted: number;
  modulesTotal: number;
  percentComplete: number; // 0–100, rounded
}

export function academyTallies(registry: ConceptRegistry, rows: ProgressRow[]): AcademyTallies {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const seq = lessonSequence(registry);
  const lessonSet = new Set(seq);
  const lessonsCompleted = seq.filter((id) => conceptStatus(byId.get(id)) === "completed").length;
  const modulesCompleted = registry.modules.filter((m) => {
    const lessons = m.conceptIds.filter((id) => lessonSet.has(id));
    return lessons.length > 0 && lessons.every((id) => conceptStatus(byId.get(id)) === "completed");
  }).length;
  return {
    lessonsCompleted,
    lessonsTotal: seq.length,
    modulesCompleted,
    modulesTotal: registry.modules.length,
    percentComplete: seq.length === 0 ? 0 : Math.round((lessonsCompleted / seq.length) * 100),
  };
}

/** First not-completed lesson in module order; null when the curriculum is done. */
export function nextUpLesson(registry: ConceptRegistry, rows: ProgressRow[]): FinancialConcept | null {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const id = lessonSequence(registry).find((i) => conceptStatus(byId.get(i)) !== "completed");
  return id ? (registry.byId(id) ?? null) : null;
}

export interface RecentCompletion {
  conceptId: ConceptId;
  title: string;
  completedAt: string;
}

export function recentlyCompleted(
  registry: ConceptRegistry,
  rows: ProgressRow[],
  limit = 3,
): RecentCompletion[] {
  return rows
    .filter((r): r is ProgressRow & { completedAt: string } => r.completedAt !== null)
    .flatMap((r) => {
      const c = registry.byId(r.conceptId);
      return c && c.status === "published"
        ? [{ conceptId: r.conceptId, title: c.title, completedAt: r.completedAt }]
        : [];
    })
    .sort((x, y) => (x.completedAt < y.completedAt ? 1 : -1))
    .slice(0, limit);
}

export function adjacentLessons(
  registry: ConceptRegistry,
  conceptId: ConceptId,
): { prev: ConceptId | null; next: ConceptId | null } {
  const seq = lessonSequence(registry);
  const i = seq.indexOf(conceptId);
  if (i === -1) return { prev: null, next: null };
  return { prev: seq[i - 1] ?? null, next: seq[i + 1] ?? null };
}

/** The concept a lesson route may render: published AND lesson-bearing, else null (→ notFound). */
export function lessonConcept(registry: ConceptRegistry, conceptId: string): FinancialConcept | null {
  const c = registry.byId(conceptId);
  return c && c.status === "published" && c.lesson ? c : null;
}

/** Server-action guard. Returns a human-readable error, or null when recordable. */
export function validateCheckAnswer(
  registry: ConceptRegistry,
  conceptId: string,
  checkId: string,
  choiceIndex: number,
): string | null {
  const c = lessonConcept(registry, conceptId);
  if (!c) return "Unknown lesson";
  const check = c.lesson!.knowledgeChecks.find((k) => k.id === checkId);
  if (!check) return "Unknown knowledge check";
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= check.choices.length) {
    return "Unknown choice";
  }
  return null;
}

/** First answer wins; duplicates are ignored. allAnswered ⇒ the caller sets completed_at. */
export function appendCheckResponse(
  totalChecks: number,
  responses: CheckResponse[],
  response: CheckResponse,
): { responses: CheckResponse[]; allAnswered: boolean; duplicate: boolean } {
  const duplicate = responses.some((r) => r.checkId === response.checkId);
  const next = duplicate ? responses : [...responses, response];
  const answered = new Set(next.map((r) => r.checkId));
  return { responses: next, allAnswered: answered.size >= totalChecks, duplicate };
}
