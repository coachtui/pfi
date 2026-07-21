import { describe, expect, it } from "vitest";
import { extractPdfText } from "./extract";

function pdfWithText(text: string) {
  const escaped = text.replace(/[()\\]/g, "\\$&").replace(/\n/g, ") Tj\n(");
  return new TextEncoder().encode(`%PDF-1.7
1 0 obj << /Type /Page >> endobj
2 0 obj << /Length 10 >> stream
BT
(${escaped}) Tj
ET
endstream
endobj
%%EOF`);
}

describe("extractPdfText", () => {
  it("extracts native text from text operators", () => {
    const result = extractPdfText(pdfWithText("Institution: Pacific Test Bank\nChecking Statement\nTransactions"));
    expect(result.method).toBe("native_text");
    expect(result.scanned).toBe(false);
    expect(result.text).toContain("Pacific Test Bank");
  });

  it("marks files with no usable text as OCR candidates", () => {
    const result = extractPdfText(new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF"));
    expect(result.method).toBe("ocr");
    expect(result.scanned).toBe(true);
  });
});
