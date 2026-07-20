import { createHash } from "node:crypto";
import type { BriefInput } from "./schemas";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonicalize(obj[k])]),
    );
  }
  return value;
}

/** Cache key for ai_narrations: any input change invalidates naturally. */
export function narrationInputHash(input: BriefInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}
