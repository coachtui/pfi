import { describe, expect, it } from "vitest";
import { normalizeOcrDocument, ocrFailureMessage } from "./ocr-utils";
import { parseStatementWithRegistry } from "./registry";
import type { OcrDocument } from "./types";

function ocrDoc(): OcrDocument {
  return {
    provider: "test-ocr",
    averageConfidence: 82,
    pages: [{
      pageNumber: 1,
      averageConfidence: 82,
      text: "",
      blocks: [
        { text: "Transactions", confidence: 95, boundingBox: { x: 80, y: 300, width: 120, height: 18 } },
        { text: "01/02 Grocery Mart Debit $12 . 34", confidence: 80, boundingBox: { x: 80, y: 340, width: 360, height: 18 } },
        { text: "Pacific Test Bank", confidence: 92, boundingBox: { x: 80, y: 70, width: 170, height: 20 } },
        { text: "Checking Statement", confidence: 91, boundingBox: { x: 80, y: 100, width: 170, height: 20 } },
        { text: "Statement Period 01/01/2026 - 01/31/2026", confidence: 88, boundingBox: { x: 80, y: 130, width: 320, height: 20 } },
        { text: "Beginning Balance $100.00", confidence: 88, boundingBox: { x: 80, y: 160, width: 220, height: 20 } },
        { text: "Ending Balance $87.66", confidence: 88, boundingBox: { x: 80, y: 190, width: 220, height: 20 } },
      ],
    }],
    fullText: "",
  };
}

describe("OCR normalization", () => {
  it("orders OCR blocks by position and normalizes money spacing", () => {
    const normalized = normalizeOcrDocument(ocrDoc());
    expect(normalized.fullText).toContain("Pacific Test Bank");
    expect(normalized.fullText.indexOf("Pacific Test Bank")).toBeLessThan(normalized.fullText.indexOf("Transactions"));
    expect(normalized.fullText).toContain("$12.34");
  });

  it("feeds OCR text through the existing statement parser with review confidence", () => {
    const parsed = parseStatementWithRegistry(normalizeOcrDocument(ocrDoc()).fullText, "ocr");
    expect(parsed.extractionMethod).toBe("ocr");
    expect(parsed.metadata.accountType).toBe("checking");
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].amount).toBe(12.34);
    expect(parsed.confidence).toBe("medium");
    expect(parsed.issues).toContain("OCR was used. Review balances and transaction amounts before importing.");
  });

  it("maps OCR failure codes to user-safe messages", () => {
    expect(ocrFailureMessage("ocr_not_configured")).toContain("OCR is not configured");
    expect(ocrFailureMessage("ocr_provider_failed")).not.toContain("stack");
  });
});
