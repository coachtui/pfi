import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, type Category } from "@/lib/config/categories";
import { mapCategory, mapCategoryDetailed } from "./map-category";
import type { PfcVersion } from "./types";

/** Minimal RFC-4180 parser: quoted fields with commas/quotes, CRLF tolerant. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function fixture(name: string): string[][] {
  return parseCsv(readFileSync(path.join(__dirname, "fixtures", name), "utf8").replace(/^﻿/, ""));
}

/** [primary, detailed] pairs per version, from Plaid's published CSVs. */
function taxonomy(version: PfcVersion): Array<[string, string]> {
  if (version === "v1") {
    const [header, ...rows] = fixture("pfc-v1.csv");
    expect(header.slice(0, 2)).toEqual(["PRIMARY", "DETAILED"]);
    return rows.map((r) => [r[0], r[1]]);
  }
  const [header, ...rows] = fixture("pfc-v2.csv");
  expect(header.slice(0, 2)).toEqual(["PFCv2 Primary", "PFCv2 Detailed"]);
  return rows.filter((r) => r[0] && !r[0].startsWith("Note:")).map((r) => [r[0], r[1]]);
}

describe("mapCategory — published taxonomies", () => {
  it.each<PfcVersion>(["v1", "v2"])("%s: every detailed value resolves through a detailed or primary rule", (version) => {
    const rows = taxonomy(version);
    expect(rows.length).toBeGreaterThan(100);
    const unknown = rows.filter(([p, d]) => mapCategoryDetailed(version, p, d).matched === "unknown");
    expect(unknown).toEqual([]);
    for (const [p, d] of rows) expect(CATEGORIES).toContain(mapCategory(version, p, d));
  });

  it("v2 covers every v1 value by name or by a documented rename, and adds the expected new values", () => {
    // Plaid's pfc-taxonomy-all.csv maps three v1 names to new v2 names.
    const RENAMED_IN_V2: Record<string, string> = {
      INCOME_WAGES: "INCOME_SALARY",
      INCOME_OTHER_INCOME: "INCOME_OTHER",
      TRANSFER_IN_CASH_ADVANCES_AND_LOANS: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
    };
    const v1 = new Set(taxonomy("v1").map(([, d]) => d));
    const v2 = taxonomy("v2").map(([, d]) => d);
    for (const d of v1) expect(v2, `v1 value ${d} missing from v2`).toContain(RENAMED_IN_V2[d] ?? d);
    // Renamed values still map to the same PFI category under each version.
    for (const [from, to] of Object.entries(RENAMED_IN_V2)) {
      expect(mapCategory("v1", from.split("_")[0] === "TRANSFER" ? "TRANSFER_IN" : "INCOME", from))
        .toBe(mapCategory("v2", to.startsWith("LOAN_DISBURSEMENTS") ? "LOAN_DISBURSEMENTS" : "INCOME", to));
    }
    const added = v2.filter((d) => !v1.has(d));
    expect(added).toEqual(expect.arrayContaining([
      "INCOME_GIG_ECONOMY", "LOAN_DISBURSEMENTS_MORTGAGE", "LOAN_PAYMENTS_BNPL", "TRANSFER_OUT_CRYPTO", "BANK_FEES_LATE_FEES", "OTHER_OTHER",
    ]));
    expect(added.length).toBe(26); // 22 genuinely new + 3 rename targets + OTHER_OTHER
  });

  it("every PFI category is reachable from at least one PFC value (v2)", () => {
    const reached = new Set<Category>(taxonomy("v2").map(([p, d]) => mapCategory("v2", p, d)));
    for (const c of CATEGORIES) expect(reached.has(c), `unreachable: ${c}`).toBe(true);
  });

  it("snapshot: full v2 mapping (review any change deliberately)", () => {
    const table = Object.fromEntries(taxonomy("v2").map(([p, d]) => [d, mapCategory("v2", p, d)]));
    expect(table).toMatchSnapshot();
  });
});

describe("mapCategory — normative rules (spec §8)", () => {
  it.each([
    ["INCOME", "INCOME_WAGES", "income"],
    ["INCOME", "INCOME_TAX_REFUND", "income"],
    ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_PERSONAL", "other"], // loan proceeds are not income
    ["LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", "housing"],
    ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "debt_payment"],
    ["LOAN_PAYMENTS", "LOAN_PAYMENTS_BNPL", "debt_payment"],
    ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT", "housing"],
    ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", "utilities"],
    ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "groceries"],
    ["FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", "dining"],
    ["TRANSPORTATION", "TRANSPORTATION_GAS", "transport"],
    ["GENERAL_SERVICES", "GENERAL_SERVICES_AUTOMOTIVE", "transport"],
    ["MEDICAL", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS", "health"],
    ["GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE", "insurance"],
    ["GENERAL_SERVICES", "GENERAL_SERVICES_CHILDCARE", "other"],
    ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "shopping"],
    ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_HARDWARE", "housing"],
    ["ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES", "discretionary"],
    ["TRAVEL", "TRAVEL_FLIGHTS", "discretionary"],
    ["PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", "discretionary"],
    ["TRANSFER_OUT", "TRANSFER_OUT_SAVINGS", "savings"],
    ["TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", "savings"],
    ["TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "other"],
    ["TRANSFER_IN", "TRANSFER_IN_SAVINGS", "other"],
    ["BANK_FEES", "BANK_FEES_OVERDRAFT_FEES", "other"],
    ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "other"],
    ["OTHER", "OTHER_OTHER", "other"],
  ] as const)("%s / %s → %s", (primary, detailed, expected) => {
    expect(mapCategory("v2", primary, detailed)).toBe(expected);
  });

  it("is version-aware: v2-only primaries are unknown under v1", () => {
    expect(mapCategoryDetailed("v1", "LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_AUTO")).toEqual({ category: "other", matched: "unknown" });
    expect(mapCategoryDetailed("v2", "LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_AUTO")).toEqual({ category: "other", matched: "primary" });
  });

  it("falls back to other on missing or unrecognized values", () => {
    expect(mapCategoryDetailed("v2", null, null)).toEqual({ category: "other", matched: "unknown" });
    expect(mapCategoryDetailed("v2", "SOMETHING_NEW", "SOMETHING_NEW_X")).toEqual({ category: "other", matched: "unknown" });
    expect(mapCategory("v2", "food_and_drink", "food_and_drink_coffee")).toBe("dining"); // case-insensitive
  });
});
