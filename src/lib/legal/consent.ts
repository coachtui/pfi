import { CURRENT_AGREEMENTS } from "./versions";

export interface AgreementRow {
  document: string;
  version: string;
}

/** Which current-version agreements this user still lacks. Empty = fully consented. */
export function missingAgreements(rows: AgreementRow[]): { document: string; version: string }[] {
  return CURRENT_AGREEMENTS.filter(
    (required) => !rows.some((r) => r.document === required.document && r.version === required.version),
  );
}
