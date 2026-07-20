/** Shared display formatters. Pure functions, safe to unit test. */

export function formatDollars(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const body = `$${rounded.toLocaleString("en-US")}`;
  return n < 0 ? `−${body}` : body;
}

/** Signed dollars for event/driver rows, e.g. "+ $3,200" / "− $640". */
export function formatSignedDollars(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign} $${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** Signed percent with one decimal, e.g. "+2.7%". */
export function formatSignedPercent(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

/** Signed index points with one decimal, e.g. "+1.3" / "−0.4". */
export function formatSignedPoints(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${Math.abs(n).toFixed(1)}`;
}

/** "May 15" style short date from an ISO date string. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
