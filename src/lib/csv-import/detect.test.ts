import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";
import { inferDateFormat, profileCsvColumns, proposeMapping } from "./detect";

describe("proposeMapping", () => {
  it("detects a Chase-style export (Posting Date / Description / Amount)", () => {
    const p = parseCsv(
      "Details,Posting Date,Description,Amount,Type,Balance\nDEBIT,07/01/2026,COFFEE SHOP,-4.50,DEBIT,100.00\n",
    );
    const { mapping, detected, confidence } = proposeMapping(p, "checking");
    expect(mapping.date).toBe(1);
    expect(mapping.description).toBe(2);
    expect(mapping.amount).toBe(3);
    expect(mapping.debit).toBe(-1);
    expect(detected).toEqual({ date: true, description: true, amount: true, category: false });
    expect(confidence.overall).toBe("low");
    expect(confidence.columns).toBe("high");
    expect(mapping.signConvention).toBe("positive_inflow");
  });

  it("detects a debit/credit pair export", () => {
    const p = parseCsv("Date,Payee,Debit,Credit\n01/07/2026,SHOP,4.50,\n");
    const { mapping } = proposeMapping(p);
    expect(mapping.amount).toBe(-1);
    expect(mapping.debit).toBe(2);
    expect(mapping.credit).toBe(3);
  });

  it("detects a category column and leaves unknown layouts undetected", () => {
    const p = parseCsv("Transaction Date,Merchant,Amount,Category\n2026-07-01,SHOP,-1.00,Food\n");
    expect(proposeMapping(p).mapping.category).toBe(3);
    const weird = parseCsv("col1,col2\nx,y\n");
    const { mapping, detected } = proposeMapping(weird);
    expect(mapping.date).toBe(-1);
    expect(detected.date).toBe(false);
    expect(proposeMapping(weird).confidence.overall).toBe("low");
  });

  it("uses account type for the signed-amount convention", () => {
    const p = parseCsv("Date,Description,Amount\n07/21/2026,MERCHANT,42.00\n");
    expect(proposeMapping(p, "checking").mapping.signConvention).toBe("positive_inflow");
    expect(proposeMapping(p, "credit_card").mapping.signConvention).toBe("positive_outflow");
  });

  it("requires review for dates that are ambiguous throughout the file", () => {
    const p = parseCsv("Date,Description,Amount\n07/08/2026,SHOP,-4.00\n08/09/2026,CAFE,-5.00\n");
    const proposal = proposeMapping(p, "checking");
    expect(proposal.confidence.dateFormat).toBe("low");
    expect(proposal.confidence.overall).toBe("low");
    expect(proposal.reviewReasons).toContain("The date order is ambiguous.");
  });

  it("maps familiar bank categories and reports unfamiliar values", () => {
    const p = parseCsv(
      "Date,Description,Amount,Category\n07/21/2026,MARKET,-42.00,Groceries\n07/22/2026,X,-5.00,Quasar Club\n",
    );
    const proposal = proposeMapping(p, "checking");
    expect(proposal.mapping.categoryValues.groceries).toBe("groceries");
    expect(proposal.unmatchedCategoryValues).toEqual(["quasar club"]);
    expect(proposal.confidence.categories).toBe("low");
  });

  it("creates structural AI profiles without exposing cell values", () => {
    const p = parseCsv("When,Narrative,Value\n07/21/2026,PRIVATE MERCHANT,-42.18\n");
    const profiles = profileCsvColumns(p);
    expect(profiles[0].dateLikeRatio).toBe(1);
    expect(profiles[2].amountLikeRatio).toBe(1);
    expect(JSON.stringify(profiles)).not.toContain("PRIVATE MERCHANT");
    expect(JSON.stringify(profiles)).not.toContain("42.18");
    expect(JSON.stringify(profiles)).not.toContain("07/21/2026");
  });

  it("does not expose a data row when a headerless file treats it as headers", () => {
    const p = parseCsv("07/21/2026,PRIVATE MERCHANT,-42.18\n07/22/2026,SECOND MERCHANT,-8.00\n");
    const profiles = profileCsvColumns(p);
    expect(profiles.map((profile) => profile.header)).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(JSON.stringify(profiles)).not.toContain("PRIVATE MERCHANT");
    expect(JSON.stringify(profiles)).not.toContain("42.18");
  });
});

describe("inferDateFormat", () => {
  it("recognizes ISO as ymd", () => {
    expect(inferDateFormat(["2026-07-01", "2026-07-02"])).toBe("ymd");
  });
  it("uses a >12 first component to pick dmy", () => {
    expect(inferDateFormat(["13/07/2026", "01/07/2026"])).toBe("dmy");
  });
  it("uses a >12 second component to pick mdy, and defaults ambiguous to mdy", () => {
    expect(inferDateFormat(["07/13/2026"])).toBe("mdy");
    expect(inferDateFormat(["01/02/2026"])).toBe("mdy");
  });
});
