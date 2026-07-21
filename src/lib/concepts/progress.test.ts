import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import {
  academyTallies, adjacentLessons, appendCheckResponse, conceptStatus,
  lessonConcept, lessonSequence, nextUpLesson, recentlyCompleted,
  validateCheckAnswer, type ProgressRow,
} from "./progress";

const row = (conceptId: string, over: Partial<ProgressRow> = {}): ProgressRow => ({
  conceptId, startedAt: "2026-07-21T00:00:00Z", completedAt: null, checkResponses: [], ...over,
});
const done = (conceptId: string, at = "2026-07-21T01:00:00Z") =>
  row(conceptId, { completedAt: at });

describe("conceptStatus", () => {
  it("derives all three states", () => {
    expect(conceptStatus(undefined)).toBe("not-started");
    expect(conceptStatus(row("revenue"))).toBe("in-progress");
    expect(conceptStatus(done("revenue"))).toBe("completed");
  });
});

describe("lessonSequence", () => {
  it("is the 10 lesson-bearing published concepts in module order", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(seq).toHaveLength(10);
    expect(seq[0]).toBe("revenue"); // module 1 starts the curriculum
    // glossary-only records never appear
    for (const id of ["short-term-obligations", "financial-flexibility", "retained-cash", "capital-allocation", "available-capital"]) {
      expect(seq).not.toContain(id);
    }
    // every entry has a lesson
    for (const id of seq) expect(CONCEPT_REGISTRY.byId(id)?.lesson).toBeTruthy();
  });
});

describe("academyTallies", () => {
  it("zero progress", () => {
    expect(academyTallies(CONCEPT_REGISTRY, [])).toEqual({
      lessonsCompleted: 0, lessonsTotal: 10, modulesCompleted: 0, modulesTotal: 3, percentComplete: 0,
    });
  });
  it("partial progress; in-progress rows do not count as completed", () => {
    const t = academyTallies(CONCEPT_REGISTRY, [done("revenue"), row("cash-flow")]);
    expect(t.lessonsCompleted).toBe(1);
    expect(t.modulesCompleted).toBe(0);
    expect(t.percentComplete).toBe(10);
  });
  it("a module completes when all its lesson-bearing concepts complete", () => {
    const module1 = ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"];
    const t = academyTallies(CONCEPT_REGISTRY, module1.map((id) => done(id)));
    expect(t.modulesCompleted).toBe(1); // module 3's glossary-only records don't block anything
  });
});

describe("nextUpLesson", () => {
  it("is the first not-completed lesson in module order", () => {
    expect(nextUpLesson(CONCEPT_REGISTRY, [])?.id).toBe("revenue");
    expect(nextUpLesson(CONCEPT_REGISTRY, [done("revenue")])?.id).toBe("operating-expenses");
  });
  it("skips over later completions and returns null when everything is done", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(nextUpLesson(CONCEPT_REGISTRY, [done(seq[1]!)])?.id).toBe(seq[0]);
    expect(nextUpLesson(CONCEPT_REGISTRY, seq.map((id) => done(id)))).toBeNull();
  });
});

describe("recentlyCompleted", () => {
  it("returns newest-first, capped, completed-only", () => {
    const rows = [
      done("revenue", "2026-07-18T00:00:00Z"),
      done("assets", "2026-07-20T00:00:00Z"),
      done("cash-flow", "2026-07-19T00:00:00Z"),
      done("net-worth", "2026-07-17T00:00:00Z"),
      row("liquidity"), // in progress — excluded
    ];
    expect(recentlyCompleted(CONCEPT_REGISTRY, rows).map((r) => r.conceptId))
      .toEqual(["assets", "cash-flow", "revenue"]);
  });
});

describe("adjacentLessons", () => {
  it("walks module order across boundaries and clamps the ends", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[0]!)).toEqual({ prev: null, next: seq[1] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[5]!)).toEqual({ prev: seq[4], next: seq[6] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[9]!)).toEqual({ prev: seq[8], next: null });
    expect(adjacentLessons(CONCEPT_REGISTRY, "short-term-obligations")).toEqual({ prev: null, next: null });
  });
});

describe("lessonConcept", () => {
  it("returns published lesson-bearing concepts only", () => {
    expect(lessonConcept(CONCEPT_REGISTRY, "revenue")?.id).toBe("revenue");
    expect(lessonConcept(CONCEPT_REGISTRY, "short-term-obligations")).toBeNull(); // glossary-only
    expect(lessonConcept(CONCEPT_REGISTRY, "no-such-concept")).toBeNull();
  });
});

describe("validateCheckAnswer", () => {
  it("accepts a valid answer", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 0)).toBeNull();
  });
  it("rejects unknown lessons, unknown check ids, and out-of-bounds choices", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "no-such-concept", "x", 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "short-term-obligations", "x", 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "nope", 0)).toBe("Unknown knowledge check");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 99)).toBe("Unknown choice");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 0.5)).toBe("Unknown choice");
  });
});

describe("appendCheckResponse", () => {
  it("appends and reports allAnswered when every check has a response", () => {
    const first = appendCheckResponse(2, [], { checkId: "c-1", choiceIndex: 1 });
    expect(first).toEqual({ responses: [{ checkId: "c-1", choiceIndex: 1 }], allAnswered: false, duplicate: false });
    const second = appendCheckResponse(2, first.responses, { checkId: "c-2", choiceIndex: 0 });
    expect(second.allAnswered).toBe(true);
  });
  it("first answer wins; duplicates are ignored", () => {
    const prior = [{ checkId: "c-1", choiceIndex: 1 }];
    const dup = appendCheckResponse(2, prior, { checkId: "c-1", choiceIndex: 2 });
    expect(dup).toEqual({ responses: prior, allAnswered: false, duplicate: true });
  });
});
