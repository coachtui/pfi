import { parseGenericStatement } from "./parse";
import type { ExtractionMethod, ParserAdapter, ParsedStatement } from "./types";

const genericAdapter: ParserAdapter = {
  id: "generic-statement-v1",
  supports: () => true,
  parse: (text) => parseGenericStatement(text),
};

export const statementParsers: ParserAdapter[] = [genericAdapter];

export function parseStatementWithRegistry(text: string, extractionMethod: ExtractionMethod = "native_text"): ParsedStatement & { adapterId: string } {
  const adapter = statementParsers.find((p) => p.supports(text)) ?? genericAdapter;
  if (adapter.id === genericAdapter.id) {
    return { ...parseGenericStatement(text, extractionMethod === "ocr" || extractionMethod === "hybrid" ? extractionMethod : "native_text"), adapterId: adapter.id };
  }
  return { ...adapter.parse(text), extractionMethod, adapterId: adapter.id };
}
