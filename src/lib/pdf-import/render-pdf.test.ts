import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderPdfPagesWithPdfjs } from "./render-pdf";

describe("PDF rendering for OCR", () => {
  it("renders a PDF page using the packaged PDF.js worker", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Fictional Bank Checking Statement", { x: 60, y: 720, size: 18, font });

    const bytes = await document.save();
    const images = await renderPdfPagesWithPdfjs(bytes, { dpi: 96, maxDimension: 1200 });

    expect(images).toHaveLength(1);
    expect(images[0].subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
