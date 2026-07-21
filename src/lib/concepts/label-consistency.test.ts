// src/lib/concepts/label-consistency.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { SCORE_METRIC_CONCEPT_IDS } from "./score-term-map";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// "Owner-created equity" has no corresponding glossary concept
// (CONCEPT_REGISTRY.byId("owner-created-equity") is undefined) — kept hardcoded.
const OWNER_CREATED_EQUITY_LABEL = "Owner-created equity";
const FREE_CASH_FLOW_TITLE = CONCEPT_REGISTRY.byId("free-cash-flow")!.title;
const AVAILABLE_CAPITAL_TITLE = CONCEPT_REGISTRY.byId("available-capital")!.title;

/**
 * Governance guard (docs/TERMINOLOGY.md): user-visible financial labels must
 * match the canonical glossary. If this test fails, either the rename
 * regressed or a label changed without a glossary ruling.
 */
describe("canonical labels", () => {
  it("report statement uses canonical row labels", () => {
    const src = read("src/app/report/ReportView.tsx");
    expect(src).toContain(`label="${FREE_CASH_FLOW_TITLE}"`);
    expect(src).toContain(`label="${OWNER_CREATED_EQUITY_LABEL}"`);
    expect(src).not.toContain("Monthly surplus");
    expect(src).not.toContain("Growth you created");
  });

  it("metric registry uses canonical metric names", () => {
    const src = read("src/lib/financial-engine/metrics.ts");
    expect(src).toContain(`name: "${FREE_CASH_FLOW_TITLE} margin"`);
    expect(src).toContain(`name: "Typical monthly ${FREE_CASH_FLOW_TITLE.toLowerCase()}"`);
    // Display names must not use "surplus"; stable metric IDS (recurring_surplus) are exempt.
    expect(src).not.toMatch(/name: "[^"]*surplus[^"]*"/i);
  });

  it("report narration never uses 'surplus' as the noun for free cash flow", () => {
    const src = read("src/lib/financial-engine/report.ts");
    expect(src).not.toContain('"surplus"');
  });

  it("dashboard card label matches glossary casing", () => {
    const src = read("src/components/dashboard/HomeDashboard.tsx");
    expect(src).toContain(`label="${AVAILABLE_CAPITAL_TITLE}"`);
    expect(src).not.toContain('label="Available Capital"');
  });
});

describe("FinancialTerm wiring coverage (slice 2)", () => {
  const wiring: Array<[file: string, conceptIds: string[]]> = [
    ["src/app/report/ReportView.tsx", ["revenue", "operating-expenses", "free-cash-flow", "retained-cash", "savings-rate"]],
    ["src/components/dashboard/HomeDashboard.tsx", ["available-capital", "short-term-obligations", "financial-flexibility"]],
  ];

  it("each wired call site references its published concept ids", () => {
    for (const [file, ids] of wiring) {
      const src = read(file);
      for (const id of ids) {
        expect(CONCEPT_REGISTRY.byId(id)?.status, `${id} not published`).toBe("published");
        expect(src, `${file} missing conceptId="${id}"`).toContain(`conceptId="${id}"`);
      }
    }
  });

  it("report still uses the canonical free-cash-flow row label alongside its term wiring", () => {
    const src = read("src/app/report/ReportView.tsx");
    expect(src).toContain(`label="${FREE_CASH_FLOW_TITLE}"`);
    expect(src).toContain(`conceptId="free-cash-flow"`);
  });

  // Score wiring uses a conditional lookup (SCORE_METRIC_CONCEPT_IDS[m.id]) rather
  // than a literal conceptId="..." string, since the concept id is derived per
  // metric row rather than fixed per call site — so it's checked separately from
  // the literal-string wiring table above. score-term-map.test.ts already asserts
  // every SCORE_METRIC_CONCEPT_IDS value is a published concept; this test only
  // needs to confirm the source actually wires that map into FinancialTerm.
  it("score view wires FinancialTerm via SCORE_METRIC_CONCEPT_IDS for every wired metric id", () => {
    const src = read("src/app/score/ScoreView.tsx");
    expect(src).toContain("SCORE_METRIC_CONCEPT_IDS[m.id]");
    expect(src).toContain("<FinancialTerm conceptId={SCORE_METRIC_CONCEPT_IDS[m.id]}>");
    for (const id of Object.values(SCORE_METRIC_CONCEPT_IDS)) {
      expect(CONCEPT_REGISTRY.byId(id)?.status, `${id} not published`).toBe("published");
    }
  });
});
