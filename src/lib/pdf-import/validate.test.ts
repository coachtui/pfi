import { describe, expect, it } from "vitest";
import { validatePdfUpload } from "./validate";

const pdf = (body = "1 0 obj << /Type /Page >> endobj") => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);

describe("validatePdfUpload", () => {
  it("accepts private PDF uploads within limits", () => {
    const bytes = pdf();
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "application/pdf", size: bytes.length, bytes }).ok).toBe(true);
  });

  it("rejects wrong extension, MIME type, empty, oversized, encrypted, and too many pages", () => {
    const bytes = pdf();
    expect(validatePdfUpload({ filename: "statement.csv", mimeType: "application/pdf", size: bytes.length, bytes }).ok).toBe(false);
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "text/plain", size: bytes.length, bytes }).ok).toBe(false);
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "application/pdf", size: 0, bytes: new Uint8Array() }).ok).toBe(false);
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "application/pdf", size: bytes.length, bytes, maxBytes: 1 }).ok).toBe(false);
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "application/pdf", size: pdf("/Encrypt").length, bytes: pdf("/Encrypt") }).ok).toBe(false);
    const manyPages = pdf(Array.from({ length: 3 }, () => "<< /Type /Page >>").join("\n"));
    expect(validatePdfUpload({ filename: "statement.pdf", mimeType: "application/pdf", size: manyPages.length, bytes: manyPages, maxPages: 2 }).ok).toBe(false);
  });
});
