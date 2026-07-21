import { inflateSync } from "node:zlib";
import { countPdfPages } from "./validate";
import type { ExtractedText } from "./types";

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

export function extractPdfText(bytes: Uint8Array): ExtractedText {
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
