import { describe, expect, it } from "vitest";
import { classifyStatement, parseGenericStatement, reconcileStatement, scopeStatementToAccount } from "./parse";
import type { ExtractedTransaction, StatementMetadata } from "./types";

const checking = `
Institution: Pacific Test Bank
Everyday Checking Statement
Account number ending in 1234
Statement Period: 07/01/2026 - 07/31/2026
Beginning Balance: $100.00
Ending Balance: $140.00
07/02 Grocery Market 10.00 debit
07/03 Payroll Deposit 50.00 credit
`;

const card = `
Island Card Services Credit Card Statement
Card number XXXX-9999
Statement Period: 07/01/2026 - 07/31/2026
Previous Balance: $200.00
New Balance: $260.00
Credit Limit: $1000.00
Minimum Payment: $25.00
Payment Due Date: 08/20/2026
07/04 Coffee Shop 10.00 purchase
07/10 Online Payment 50.00 payment
07/11 Hotel 100.00 purchase
`;

const combinedCreditUnion = `
Fictional Community Credit Union
Member No. Statement Period Page
000001 06/01/26 Thru 06/30/26 1
Regular Share Account Number: 11111111
Beginning Balance Deposits Withdrawals Ending Balance YTD Dividends
100.00 5.00 0.00 105.00 5.00
TRANSACTION ACTIVITY
Date Date Transaction Description Deposit Withdrawal Balance
06/01 06/01 Beginning Balance 100.00
06/15 06/15 Monthly Dividend 5.00 105.00
Checking Account Number: 22222222
Beginning Balance Deposits Withdrawals Checks Cleared Ending Balance YTD Dividends
1,000.00 500.00 100.00 1,400.00 0.00
TRANSACTION ACTIVITY
Date Date Transaction Description Deposit Withdrawal Balance
06/01 06/01 Beginning Balance 1,000.00
06/02 06/02 Fictional Payroll Deposit 500.00 1,500.00
06/03 06/03 Fictional Grocery Store 25.00 1,475.00
--- Page 2 ---
Checking Account Number: 22222222 Continued
TRANSACTION ACTIVITY
Date Date Transaction Description Deposit Withdrawal Balance
06/04 06/04 Check 1001 75.00 1,400.00
`;

describe("classifyStatement", () => {
  it("supports deposit and credit-card statements and rejects brokerage", () => {
    expect(classifyStatement(checking).accountType).toBe("checking");
    expect(classifyStatement(card).accountType).toBe("credit_card");
    expect(classifyStatement("Brokerage statement holdings tax lot options").unsupportedReason).toMatch(/Brokerage/);
  });
});

describe("parseGenericStatement", () => {
  it("parses deposit-account metadata, transactions, directions, and reconciliation", () => {
    const parsed = parseGenericStatement(checking);
    expect(parsed.metadata.institution).toBe("Pacific Test Bank");
    expect(parsed.metadata.accountType).toBe("checking");
    expect(parsed.metadata.maskedAccountNumber).toBe("1234");
    expect(parsed.transactions.map((t) => [t.postedDate, t.direction, t.amount])).toEqual([
      ["2026-07-02", "outflow", 10],
      ["2026-07-03", "inflow", 50],
    ]);
    expect(parsed.reconciliation.status).toBe("reconciled");
    expect(parsed.confidence).toBe("high");
  });

  it("parses credit-card metadata and uses card reconciliation convention", () => {
    const parsed = parseGenericStatement(card);
    expect(parsed.metadata.accountType).toBe("credit_card");
    expect(parsed.metadata.creditLimit).toBe(1000);
    expect(parsed.metadata.minimumPayment).toBe(25);
    expect(parsed.metadata.paymentDueDate).toBe("2026-08-20");
    expect(parsed.transactions.map((t) => t.direction)).toEqual(["outflow", "inflow", "outflow"]);
    expect(parsed.reconciliation.status).toBe("reconciled");
  });

  it("reports statements that do not reconcile", () => {
    const parsed = parseGenericStatement(checking.replace("Ending Balance: $140.00", "Ending Balance: $141.00"));
    expect(parsed.reconciliation.status).toBe("does_not_reconcile");
    expect(parsed.confidence).toBe("medium");
  });

  it("scopes a combined statement to the selected checking account and parses running-balance rows", () => {
    const scoped = scopeStatementToAccount(combinedCreditUnion, { accountType: "checking", mask: "2222" });
    const parsed = parseGenericStatement(scoped.text);

    expect(scoped.unsupportedReason).toBeNull();
    expect(scoped.issues).toHaveLength(1);
    expect(scoped.text).not.toContain("Regular Share Account Number");
    expect(parsed.metadata.accountType).toBe("checking");
    expect(parsed.metadata.statementStartDate).toBe("2026-06-01");
    expect(parsed.metadata.statementEndDate).toBe("2026-06-30");
    expect(parsed.metadata.beginningBalance).toBe(1000);
    expect(parsed.metadata.endingBalance).toBe(1400);
    expect(parsed.transactions.map((transaction) => [transaction.amount, transaction.direction])).toEqual([
      [500, "inflow"],
      [25, "outflow"],
      [75, "outflow"],
    ]);
    expect(parsed.reconciliation.status).toBe("reconciled");
    expect(parsed.confidence).toBe("high");
  });

  it("keeps an unscoped combined statement out of the single-account pipeline", () => {
    expect(parseGenericStatement(combinedCreditUnion).unsupportedReason).toMatch(/multiple accounts/i);
  });
});

describe("reconcileStatement", () => {
  const meta: StatementMetadata = {
    institution: null, accountName: null, accountType: "savings", maskedAccountNumber: null,
    statementStartDate: null, statementEndDate: null, beginningBalance: 1,
    endingBalance: 1.03, availableBalance: null, creditLimit: null, minimumPayment: null,
    paymentDueDate: null,
  };
  const txn = (amount: number): ExtractedTransaction => ({
    line: 2, postedDate: "2026-07-01", transactionDate: null, amount, direction: "inflow",
    description: "Interest", category: "income", referenceNumber: null, sourcePage: null,
    confidence: "high", fieldConfidence: {}, issues: [],
  });

  it("uses cent-safe reconciliation arithmetic", () => {
    expect(reconcileStatement(meta, [txn(0.01), txn(0.02)]).status).toBe("reconciled");
  });
});
