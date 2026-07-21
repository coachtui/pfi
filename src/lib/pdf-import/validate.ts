import { PDF_IMPORT_MAX_BYTES, PDF_IMPORT_MAX_PAGES, type PdfValidationResult } from "./types";

export function countPdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

export function validatePdfUpload(input: {
  filename: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
  maxBytes?: number;
  maxPages?: number;
}): PdfValidationResult {
  const maxBytes = input.maxBytes ?? PDF_IMPORT_MAX_BYTES;
  const maxPages = input.maxPages ?? PDF_IMPORT_MAX_PAGES;
  const name = input.filename.trim();
  if (!/\.pdf$/i.test(name)) return { ok: false, reason: "Choose a PDF statement file." };
  if (input.mimeType !== "application/pdf") return { ok: false, reason: "PDF import accepts application/pdf files only." };
  if (input.size <= 0 || input.bytes.length === 0) return { ok: false, reason: "That PDF is empty." };
  if (input.size > maxBytes) {
    return { ok: false, reason: `That PDF is over ${Math.floor(maxBytes / 1024 / 1024)} MB.` };
  }
  const header = new TextDecoder("latin1").decode(input.bytes.slice(0, 16));
  if (!header.startsWith("%PDF-")) return { ok: false, reason: "That file is not a valid PDF." };

  const body = new TextDecoder("latin1").decode(input.bytes);
  if (/\/Encrypt\b/.test(body)) return { ok: false, reason: "Password-protected PDFs are not supported yet.", encrypted: true };

  const pageCount = countPdfPages(input.bytes);
  if (pageCount !== null && pageCount > maxPages) {
    return { ok: false, reason: `That statement has ${pageCount} pages. Upload ${maxPages} pages or fewer.`, pageCount };
  }
  return pageCount === null ? { ok: true } : { ok: true, pageCount };
}
