import { inflateSync } from "node:zlib";
import { countPdfPages } from "./validate";
import type { ExtractedText } from "./types";
import { pdfjs } from "./pdfjs-node";

const MIN_USABLE_PAGE_CHARACTERS = 40;

type PositionedTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

function isPositionedTextItem(value: unknown): value is PositionedTextItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PositionedTextItem>;
  return typeof item.str === "string" && Array.isArray(item.transform) && item.transform.length >= 6;
}

function lineText(items: PositionedTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  let text = "";
  let priorRight: number | null = null;
  for (const item of sorted) {
    const value = item.str.trim();
    if (!value) continue;
    const x = item.transform[4];
    const gap = priorRight === null ? 0 : x - priorRight;
    if (text && gap > Math.max(0.75, item.height * 0.08)) text += " ";
    text += value;
    priorRight = x + Math.max(0, item.width);
  }
  return text.replace(/[ \t]+/g, " ").trim();
}

function pageText(items: PositionedTextItem[]): string {
  const lines: Array<{ y: number; height: number; items: PositionedTextItem[] }> = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    const tolerance = Math.max(2, item.height * 0.35);
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= Math.max(tolerance, candidate.height * 0.35));
    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + y) / line.items.length;
      line.height = Math.max(line.height, item.height);
    } else {
      lines.push({ y, height: item.height, items: [item] });
    }
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => lineText(line.items))
    .filter(Boolean)
    .join("\n");
}

function usableCharacterCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

async function extractWithPdfjs(bytes: Uint8Array): Promise<{ text: string; pageCount: number; nativeTextPageCount: number }> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    let nativeTextPageCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const positionedItems = content.items.filter(isPositionedTextItem) as PositionedTextItem[];
      const text = pageText(positionedItems);
      if (usableCharacterCount(text) >= MIN_USABLE_PAGE_CHARACTERS) nativeTextPageCount += 1;
      pages.push(text ? `--- Page ${pageNumber} ---\n${text}` : `--- Page ${pageNumber} ---`);
      page.cleanup();
    }
    return { text: pages.join("\n\n").trim(), pageCount: document.numPages, nativeTextPageCount };
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => {
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      return map[c] ?? c;
    })
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
}

function extractTextOperators(src: string): string[] {
  const out: string[] = [];
  const literal = /\(((?:\\.|[^\\)])*)\)\s*T[jJ]/g;
  for (const m of src.matchAll(literal)) out.push(decodePdfString(m[1]));

  let searchFrom = 0;
  while (true) {
    const tj = src.indexOf("TJ", searchFrom);
    if (tj === -1) break;
    const start = src.lastIndexOf("[", tj);
    searchFrom = tj + 2;
    if (start === -1 || tj - start > 10_000) continue;
    const snippet = src.slice(start + 1, tj);
    const pieces = [...snippet.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((p) => decodePdfString(p[0].slice(1, -1)));
    if (pieces.length) out.push(pieces.join(""));
  }

  const hex = /<([0-9a-fA-F\s]+)>\s*T[jJ]/g;
  for (const m of src.matchAll(hex)) {
    const clean = m[1].replace(/\s+/g, "");
    const bytes = clean.match(/.{1,2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
    out.push(new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes)));
  }
  return out;
}

function streamBodies(pdf: string): string[] {
  const bodies: string[] = [];
  const streamRe = /(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const m of pdf.matchAll(streamRe)) {
    const dict = m[1];
    const raw = m[2];
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        const inflated = inflateSync(Buffer.from(raw, "latin1"));
        bodies.push(new TextDecoder("latin1").decode(inflated));
      } catch {
        // Corrupt streams are handled by the caller as no usable text.
      }
    } else {
      bodies.push(raw);
    }
  }
  return bodies;
}

function extractTextOperatorsFallback(bytes: Uint8Array): ExtractedText {
  const pdf = new TextDecoder("latin1").decode(bytes);
  const pageCount = countPdfPages(bytes);
  const chunks: string[] = [];

  for (const body of streamBodies(pdf)) chunks.push(...extractTextOperators(body));
  if (chunks.length === 0) chunks.push(...extractTextOperators(pdf));

  const text = chunks
    .join("\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    method: text.length > 40 ? "native_text" : "ocr",
    pageCount,
    scanned: text.length <= 40,
  };
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedText> {
  try {
    const extracted = await extractWithPdfjs(bytes);
    if (extracted.nativeTextPageCount > 0) {
      return {
        text: extracted.text,
        method: extracted.nativeTextPageCount === extracted.pageCount ? "native_text" : "hybrid",
        pageCount: extracted.pageCount,
        scanned: false,
        nativeTextPageCount: extracted.nativeTextPageCount,
      };
    }
  } catch {
    // Preserve support for unusual PDFs that the legacy operator scanner can read.
  }
  return extractTextOperatorsFallback(bytes);
}
