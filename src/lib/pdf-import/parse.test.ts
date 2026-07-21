import { describe, expect, it } from "vitest";
import { classifyStatement, parseGenericStatement, reconcileStatement } from "./parse";
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
