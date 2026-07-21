// src/lib/concepts/content/short-term-obligations.ts
import type { FinancialConcept } from "../types";

export const shortTermObligations: FinancialConcept = {
  id: "short-term-obligations",
  title: "Short-term obligations",
  shortDefinition: "Payments your household is committed to before your next expected income.",
  fullDefinition:
    "Short-term obligations are the payments a household is already committed to make before its next expected income arrives — rent or a mortgage installment, a loan payment, a credit-card minimum, or any other bill already due. They are distinct from total liabilities: a liability is the full balance owed, while a short-term obligation is only the slice of it that's due right now.",
  whyItMatters:
    "Short-term obligations determine how much of a household's current liquid assets are actually free to use. Money sitting in an account can look available while already being committed to an obligation due in a few days — knowing the difference prevents treating committed money as spendable.",
  businessContext:
    "This is the same idea as “current liabilities” on a company's balance sheet — the portion of what a business owes that comes due within the next operating period, tracked separately from longer-term debt because it demands cash sooner.",
  commonMisunderstanding:
    "Money sitting in an account is not automatically available. If a chunk of that balance is already committed to a bill or payment due before the next paycheck, it isn't really free to spend or save elsewhere, even though the account balance looks unchanged until the payment goes out.",
  relatedConceptIds: ["liquidity", "available-capital", "debt-pressure"],
  prerequisiteConceptIds: [],
  dataMetricKey: "snapshot:nearTermObligations",
  status: "published",
};
