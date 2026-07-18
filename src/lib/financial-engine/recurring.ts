/**
 * Collapse a raw bank/CSV description into a stable grouping key: lowercase,
 * digit runs (reference codes, invoice numbers, dates) removed, punctuation
 * removed, whitespace collapsed. "NETFLIX.COM 4529" and "NETFLIX.COM 8817"
 * both normalize to "netflix com".
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\d+[/\-.\d]*/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable identity for a recurring series: FNV-1a over account + direction +
 * normalized description ONLY. Cadence and amount are deliberately excluded
 * so a series that reclassifies as more data arrives keeps its key — and the
 * user's confirm/dismiss override keeps sticking to it.
 */
export function seriesKeyOf(
  accountId: string,
  direction: "inflow" | "outflow",
  normalizedDescription: string,
): string {
  const input = `${accountId}|${direction}|${normalizedDescription}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
