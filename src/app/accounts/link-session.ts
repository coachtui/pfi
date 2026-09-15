/**
 * Plaid Link session persistence (Slice 2 spec §1a). An OAuth institution
 * sends the browser to the bank and back to `/plaid/oauth`; the in-flight
 * link token and mode survive that round-trip in sessionStorage (tab-scoped,
 * same-origin, cleared on completion). Pure functions over a Storage-like
 * object so they are unit-testable without a browser.
 */

export type LinkMode = { kind: "connect" } | { kind: "update"; itemId: string };

export interface LinkSession {
  linkToken: string;
  mode: LinkMode;
  /** Epoch ms when the session was written. */
  createdAt: number;
}

export interface LinkResult {
  ok: boolean;
  message: string;
  /** Succeeded with a caveat (e.g. the rebuild failed) — shown as a notice, not an error. */
  warning?: boolean;
}

export const LINK_SESSION_KEY = "pfi.plaid.link";
export const LINK_RESULT_KEY = "pfi.plaid.result";
export const DISCLOSURE_KEY = "pfi.plaid.disclosure.v1";
/** Link tokens live 4 hours; 30 minutes bounds a stale resume after an abandoned bank sign-in. */
export const LINK_SESSION_TTL_MS = 30 * 60 * 1000;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // private mode / blocked storage: degrade to "no session"
  }
}

export function saveLinkSession(storage: StorageLike, session: Omit<LinkSession, "createdAt">, now: number = Date.now()): void {
  safe(() => storage.setItem(LINK_SESSION_KEY, JSON.stringify({ ...session, createdAt: now })), undefined);
}

/** The stored session, or null when absent, malformed, or older than the TTL (stale entries are removed). */
export function readLinkSession(storage: StorageLike, now: number = Date.now()): LinkSession | null {
  const raw = safe(() => storage.getItem(LINK_SESSION_KEY), null);
  if (!raw) return null;
  const parsed = safe(() => JSON.parse(raw) as unknown, null);
  if (!isLinkSession(parsed) || now - parsed.createdAt > LINK_SESSION_TTL_MS || now < parsed.createdAt) {
    clearLinkSession(storage);
    return null;
  }
  return parsed;
}

export function clearLinkSession(storage: StorageLike): void {
  safe(() => storage.removeItem(LINK_SESSION_KEY), undefined);
}

function isLinkSession(v: unknown): v is LinkSession {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.linkToken !== "string" || o.linkToken.length === 0 || typeof o.createdAt !== "number") return false;
  const m = o.mode as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return false;
  return m.kind === "connect" || (m.kind === "update" && typeof m.itemId === "string" && m.itemId.length > 0);
}

/** Hand a result from the OAuth return page to the Accounts card. */
export function saveLinkResult(storage: StorageLike, result: LinkResult): void {
  safe(() => storage.setItem(LINK_RESULT_KEY, JSON.stringify(result)), undefined);
}

/** Read-and-clear the pending result (shown once). */
export function takeLinkResult(storage: StorageLike): LinkResult | null {
  const raw = safe(() => storage.getItem(LINK_RESULT_KEY), null);
  if (!raw) return null;
  safe(() => storage.removeItem(LINK_RESULT_KEY), undefined);
  const parsed = safe(() => JSON.parse(raw) as unknown, null);
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.ok !== "boolean" || typeof o.message !== "string") return null;
  return { ok: o.ok, message: o.message, warning: o.warning === true };
}

/** Just-in-time disclosure (spec §1b): a per-device notice, not a recorded consent. */
export function hasSeenDisclosure(storage: StorageLike): boolean {
  return safe(() => storage.getItem(DISCLOSURE_KEY) === "1", false);
}

export function markDisclosureSeen(storage: StorageLike): void {
  safe(() => storage.setItem(DISCLOSURE_KEY, "1"), undefined);
}
