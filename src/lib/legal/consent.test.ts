import { describe, expect, it } from "vitest";
import { missingAgreements } from "./consent";
import { PRIVACY_VERSION, TERMS_VERSION, agreedCookieValue } from "./versions";

describe("missingAgreements", () => {
  it("reports both documents for a user with no rows", () => {
    expect(missingAgreements([])).toEqual([
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: PRIVACY_VERSION },
    ]);
  });

  it("reports only the stale document", () => {
    const rows = [
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: "2020-01-01" },
    ];
    expect(missingAgreements(rows)).toEqual([{ document: "privacy", version: PRIVACY_VERSION }]);
  });

  it("reports nothing when both current versions are present (extra old rows ignored)", () => {
    const rows = [
      { document: "terms", version: "2020-01-01" },
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: PRIVACY_VERSION },
    ];
    expect(missingAgreements(rows)).toEqual([]);
  });
});

describe("agreedCookieValue", () => {
  it("encodes the user id and both current versions", () => {
    expect(agreedCookieValue("user-123")).toBe(`user-123:${TERMS_VERSION}|${PRIVACY_VERSION}`);
  });
});
