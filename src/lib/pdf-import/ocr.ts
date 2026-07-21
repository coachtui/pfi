import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, PSM } from "tesseract.js";
import {
  PDF_IMPORT_OCR_DPI,
  PDF_IMPORT_OCR_MAX_DIMENSION,
  PDF_IMPORT_OCR_TIMEOUT_MS,
  type OcrBlock,
  type OcrDocument,
  type OcrFailureCode,
  type OcrPage,
  type StatementOcrProvider,
} from "./types";
import { normalizeOcrDocument } from "./ocr-utils";

const execFileAsync = promisify(execFile);

pdfjs.GlobalWorkerOptions.workerSrc = "";
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as typeof globalThis.Path2D;

export class OcrImportError extends Error {
  constructor(
    public readonly code: OcrFailureCode,
    message: string,
  ) {
    super(message);
  }
}

function configuredNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function assertCommand(command: string, label: string) {
  try {
    await execFileAsync(command, ["-v"], { timeout: 5_000 });
  } catch {
    throw new OcrImportError(
      "ocr_not_configured",
      `${label} is not configured on the server. OCR imports require Poppler rendering and Tesseract OCR support.`,
    );
  }
}

async function renderWithPdfjs(bytes: Uint8Array): Promise<Buffer[]> {
  const dpi = configuredNumber("PDF_IMPORT_OCR_DPI", PDF_IMPORT_OCR_DPI);
  const maxDimension = configuredNumber("PDF_IMPORT_OCR_MAX_DIMENSION", PDF_IMPORT_OCR_MAX_DIMENSION);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  let document: pdfjs.PDFDocumentProxy | null = null;
  try {
    document = await loadingTask.promise;
    const images: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: dpi / 72 });
      const scale = Math.min(1, maxDimension / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: (dpi / 72) * scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;
      images.push(canvas.toBuffer("image/png"));
      page.cleanup();
    }
    return images;
  } catch {
    throw new OcrImportError("pdf_render_failed", "The scanned PDF could not be rendered for OCR.");
  } finally {
    await document?.cleanup();
  }
}

async function renderWithPoppler(bytes: Uint8Array, command: string): Promise<{ pages: Array<{ pageNumber: number; image: string }>; cleanup: () => Promise<void> }> {
  await assertCommand(command, "PDF renderer");
  const dir = await mkdtemp(path.join(tmpdir(), "pfi-ocr-"));
  const pdfPath = path.join(dir, "statement.pdf");
  const prefix = path.join(dir, "page");
  const dpi = configuredNumber("PDF_IMPORT_OCR_DPI", PDF_IMPORT_OCR_DPI);
  const maxDimension = configuredNumber("PDF_IMPORT_OCR_MAX_DIMENSION", PDF_IMPORT_OCR_MAX_DIMENSION);
  try {
    await writeFile(pdfPath, Buffer.from(bytes));
    try {
      await execFileAsync(command, [
        "-png",
        "-r", String(dpi),
        "-scale-to", String(maxDimension),
        "-q",
        pdfPath,
        prefix,
      ], { timeout: configuredNumber("PDF_IMPORT_RENDER_TIMEOUT_MS", 45_000), maxBuffer: 1024 * 1024 });
    } catch {
      throw new OcrImportError("pdf_render_failed", "The scanned PDF could not be rendered for OCR.");
    }

    const images = (await readdir(dir))
      .filter((f) => /^page-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
    if (images.length === 0) throw new OcrImportError("pdf_render_failed", "No pages were rendered from the PDF.");
    return {
      pages: images.map((image) => ({
        pageNumber: Number(image.match(/\d+/)?.[0] ?? 1),
        image: path.join(dir, image),
      })),
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

function bbox(box: { x0: number; y0: number; x1: number; y1: number } | undefined): OcrBlock["boundingBox"] {
  if (!box) return undefined;
  return { x: box.x0, y: box.y0, width: Math.max(0, box.x1 - box.x0), height: Math.max(0, box.y1 - box.y0) };
}

function blocksFromTesseract(page: Tesseract.Page): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = line.text.trim();
        if (!text) continue;
        blocks.push({ text, confidence: line.confidence, boundingBox: bbox(line.bbox) });
      }
    }
  }
  return blocks;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrImportError("ocr_timeout", "OCR processing exceeded the configured timeout.")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class LocalTesseractOcrProvider implements StatementOcrProvider {
  async extract(input: { pdfBytes: Uint8Array; importId: string; ownerId: string; pageCount: number | null }): Promise<OcrDocument> {
    return withTimeout(this.extractInternal(input), configuredNumber("PDF_IMPORT_OCR_TIMEOUT_MS", PDF_IMPORT_OCR_TIMEOUT_MS));
  }

  private async extractInternal(input: { pdfBytes: Uint8Array; importId: string; ownerId: string; pageCount: number | null }): Promise<OcrDocument> {
    const dpi = configuredNumber("PDF_IMPORT_OCR_DPI", PDF_IMPORT_OCR_DPI);
    const renderCommand = process.env.PDF_IMPORT_RENDER_COMMAND?.trim();
    const rendered = renderCommand
      ? await renderWithPoppler(input.pdfBytes, renderCommand)
      : { pages: (await renderWithPdfjs(input.pdfBytes)).map((image, index) => ({ pageNumber: index + 1, image })), cleanup: async () => {} };
    if (rendered.pages.length === 0) throw new OcrImportError("pdf_render_failed", "No pages were rendered from the PDF.");

    try {
      const worker = await createWorker("eng", undefined, {
        ...(process.env.PDF_IMPORT_OCR_LANG_PATH ? { langPath: process.env.PDF_IMPORT_OCR_LANG_PATH } : {}),
        ...(process.env.PDF_IMPORT_OCR_CACHE_PATH ? { cachePath: process.env.PDF_IMPORT_OCR_CACHE_PATH } : {}),
      });
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: "1",
          user_defined_dpi: String(dpi),
        });
        const pages: OcrPage[] = [];
        for (const { image, pageNumber } of rendered.pages) {
          const result = await worker.recognize(image, {}, { text: true, blocks: true });
          const data = result.data;
          pages.push({
            pageNumber,
            text: data.text ?? "",
            averageConfidence: data.confidence,
            blocks: blocksFromTesseract(data),
          });
        }
        const avg = pages.length
          ? pages.reduce((sum, p) => sum + (p.averageConfidence ?? 0), 0) / pages.length
          : undefined;
        return normalizeOcrDocument({
          pages,
          fullText: "",
          averageConfidence: avg,
          provider: "local-tesseract",
          providerVersion: pages[0] ? "tesseract.js" : undefined,
        });
      } catch (e) {
        if (e instanceof OcrImportError) throw e;
        throw new OcrImportError("ocr_provider_failed", "OCR failed while reading the rendered statement pages.");
      } finally {
        await worker.terminate();
      }
    } finally {
      await rendered.cleanup();
    }
  }
}

export function defaultOcrProvider(): StatementOcrProvider {
  return new LocalTesseractOcrProvider();
}
