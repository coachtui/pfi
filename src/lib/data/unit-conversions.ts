/**
 * Small, framework-free unit conversions used at the data boundary between
 * stored rows (which follow the validation schema's documented units) and
 * the financial engine (which expects normalized units, e.g. decimal APR).
 */

/**
 * Converts a percent value (e.g. 6.25 meaning 6.25%) to its decimal form
 * (0.0625). Null-safe: null in, null out.
 */
export function percentToDecimal(rate: number | null): number | null {
  return rate === null ? null : rate / 100;
}
