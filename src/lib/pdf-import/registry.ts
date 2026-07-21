import { parseGenericStatement } from "./parse";
import type { ParserAdapter, ParsedStatement } from "./types";

const genericAdapter: ParserAdapter = {
  id: "generic-statement-v1",
  supports: () => true,
  parse: parseGenericStatement,
};

export const statementParsers: ParserAdapter[] = [genericAdapter];

export function parseStatementWithRegistry(text: string): ParsedStatement & { adapterId: string } {
  const adapter = statementParsers.find((p) => p.supports(text)) ?? genericAdapter;
  return { ...adapter.parse(text), adapterId: adapter.id };
}
