import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText } from "./extract";
import { parseGenericStatement } from "./parse";

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
  it("extracts native text from text operators", async () => {
    const result = await extractPdfText(pdfWithText("Institution: Pacific Test Bank\nChecking Statement\nTransactions"));
    expect(result.method).toBe("native_text");
    expect(result.scanned).toBe(false);
    expect(result.text).toContain("Pacific Test Bank");
  });

  it("extracts positioned text from a normal generated statement PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Fictional Bank Checking Statement", { x: 50, y: 740, size: 16, font });
    page.drawText("Beginning Balance $1,000.00", { x: 50, y: 700, size: 11, font });
    page.drawText("01/02 Grocery Store 12.34", { x: 50, y: 660, size: 11, font });
    page.drawText("Ending Balance $987.66", { x: 50, y: 620, size: 11, font });

    const result = await extractPdfText(await document.save());

    expect(result.method).toBe("native_text");
    expect(result.nativeTextPageCount).toBe(1);
    expect(result.text).toContain("Checking Statement");
    expect(result.text).toContain("Beginning Balance $1,000.00");
  });

  it("extracts and parses a generated Capital One posted-activity PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const lines = [
      "7/21/26, 4:26 PM Capital One",
      "Posted Transactions Since Your Last Statement Account Ending in ...4242",
      "DATE DESCRIPTION CATEGORY CARD AMOUNT",
      "Jul 20 FICTIONAL MARKET Grocery Avery Q. $15.65",
      "...1111",
      "Jul 19 Payment from FICTIONAL CREDIT UNION Payment -$100.00",
      "...4242",
    ];
    lines.forEach((line, index) => {
      page.drawText(line, { x: 50, y: 740 - index * 30, size: 11, font });
    });

    const extracted = await extractPdfText(await document.save());
    const parsed = parseGenericStatement(extracted.text);

    expect(extracted.method).toBe("native_text");
    expect(parsed.unsupportedReason).toBeNull();
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions.map((transaction) => transaction.direction)).toEqual([
      "outflow",
      "inflow",
    ]);
  });

  it("marks files with no usable text as OCR candidates", async () => {
    const result = await extractPdfText(new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF"));
    expect(result.method).toBe("ocr");
    expect(result.scanned).toBe(true);
  });
});
