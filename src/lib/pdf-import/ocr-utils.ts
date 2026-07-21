import type { OcrBlock, OcrDocument, OcrFailureCode } from "./types";

function orderBlocks(blocks: OcrBlock[] | undefined): string {
  if (!blocks?.length) return "";
  const sorted = [...blocks].sort((a, b) => {
    const ay = a.boundingBox?.y ?? 0;
    const by = b.boundingBox?.y ?? 0;
    if (Math.abs(ay - by) > 8) return ay - by;
    return (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0);
  });
  return sorted.map((b) => b.text.trim()).filter(Boolean).join("\n");
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[|¦]/g, " ")
    .replace(/([,$])\s+(\d)/g, "$1$2")
    .replace(/(\d)\s+([.,])\s+(\d{2})(\D|$)/g, "$1.$3$4")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOcrDocument(document: OcrDocument): OcrDocument {
  const pages = document.pages.map((page) => {
    const layoutText = orderBlocks(page.blocks);
    const text = normalizeOcrText(layoutText || page.text);
    return { ...page, text };
  });
  return {
    ...document,
    pages,
    fullText: pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n").trim(),
  };
}

export function ocrFailureMessage(code: OcrFailureCode, detail?: string | null): string {
  const messages: Record<OcrFailureCode, string> = {
    ocr_not_configured: "OCR is not configured on the server. Try a CSV export or a text-native statement PDF.",
    pdf_render_failed: "The scanned PDF could not be rendered for OCR.",
    ocr_provider_failed: "OCR could not read the scanned statement.",
    ocr_timeout: "OCR processing took too long and was stopped.",
    ocr_low_quality: "OCR quality was too low to extract reliable financial data.",
    no_statement_data_detected: "No supported financial statement data was detected.",
    unsupported_statement_type: "This statement type is not supported.",
    multiple_accounts_detected: "This statement appears to contain multiple accounts. Multi-account PDFs are not supported yet.",
    password_protected: "Password-protected PDFs are not supported.",
    corrupted_pdf: "That PDF appears to be corrupted.",
    page_limit_exceeded: "That statement has too many pages for OCR import.",
    file_limit_exceeded: "That PDF is too large for OCR import.",
    parser_failed: "The statement text was read, but parsing failed before review.",
  };
  return detail && process.env.NODE_ENV !== "production" ? `${messages[code]} (${detail})` : messages[code];
}
