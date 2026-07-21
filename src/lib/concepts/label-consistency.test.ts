// src/lib/concepts/label-consistency.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Governance guard (docs/TERMINOLOGY.md): user-visible financial labels must
 * match the canonical glossary. If this test fails, either the rename
 * regressed or a label changed without a glossary ruling.
 */
describe("canonical labels", () => {
  it("report statement uses canonical row labels", () => {
    const src = read("src/app/report/ReportView.tsx");
    expect(src).toContain('label="Free cash flow"');
    expect(src).toContain('label="Owner-created equity"');
    expect(src).not.toContain("Monthly surplus");
    expect(src).not.toContain("Growth you created");
  });

  it("metric registry uses canonical metric names", () => {
    const src = read("src/lib/financial-engine/metrics.ts");
    expect(src).toContain('name: "Free cash flow margin"');
    expect(src).toContain('name: "Typical monthly free cash flow"');
    // Display names must not use "surplus"; stable metric IDS (recurring_surplus) are exempt.
    expect(src).not.toMatch(/name: "[^"]*surplus[^"]*"/i);
  });

  it("report narration never uses 'surplus' as the noun for free cash flow", () => {
    const src = read("src/lib/financial-engine/report.ts");
    expect(src).not.toContain('"surplus"');
  });

  it("dashboard card label matches glossary casing", () => {
    const src = read("src/components/dashboard/HomeDashboard.tsx");
    expect(src).toContain('label="Available capital"');
    expect(src).not.toContain('label="Available Capital"');
  });
});
