/**
 * Effective versions of the legal documents. Bump a version when its
 * document materially changes — the consent gate then re-prompts every
 * user. Never edit a document's content without bumping its version.
 */
export const TERMS_VERSION = "2026-07-19";
export const PRIVACY_VERSION = "2026-07-19";

export type AgreementDocument = "terms" | "privacy";

export const CURRENT_AGREEMENTS: readonly { document: AgreementDocument; version: string }[] = [
  { document: "terms", version: TERMS_VERSION },
  { document: "privacy", version: PRIVACY_VERSION },
];

/** Cookie that caches "this session already proved consent" (proxy gate). */
export const AGREED_COOKIE = "pfi_agreed";

export function agreedCookieValue(userId: string): string {
  return `${userId}:${TERMS_VERSION}|${PRIVACY_VERSION}`;
}
