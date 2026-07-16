import { describe, expect, it } from "vitest";
import {
  rowToSnapshot,
  snapshotToRow,
  eventToRow,
  rowToEvent,
  rowToTransactionInput,
  type TransactionRow,
  rowToAccountSummary,
  rowToTransactionListItem,
  type AccountRow,
  type TransactionListRow,
} from "./mappers";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import { ENGINE_VERSION } from "@/lib/financial-engine";

const snapshot: DailySnapshot = {
  date: "2026-07-15", liquidAssets: 17015, revolvingBalances: 2100,
  nearTermObligations: 4040, essentialObligations: 3200, safetyBuffer: 2500, netWorth: 320000,
};

const event: FinancialEvent = {
  id: "e1", date: "2026-07-15", type: "paycheck", label: "Paycheck", amount: 3450, direction: "inflow",
};

describe("mappers", () => {
  it("snapshot round-trips through its row shape", () => {
    const row = snapshotToRow("user-1", snapshot);
    expect(row.user_id).toBe("user-1");
    expect(row.engine_version).toBe(ENGINE_VERSION);
    expect(rowToSnapshot(row)).toEqual(snapshot);
  });

  it("event round-trips through its row shape", () => {
    const row = eventToRow("user-1", event);
    expect(row.user_id).toBe("user-1");
    expect(rowToEvent({ ...row, id: "e1" })).toEqual(event);
  });
});

describe("rowToTransactionInput", () => {
  it("maps a transaction row to the engine TransactionInput shape", () => {
    const row: TransactionRow = {
      id: "t1", account_id: "acc1", posted_date: "2026-06-15", amount: 3450,
      direction: "inflow", category: "income", essential: null,
      is_transfer: false, transfer_pair_id: null,
    };
    expect(rowToTransactionInput(row)).toEqual({
      id: "t1", accountId: "acc1", postedDate: "2026-06-15", amount: 3450,
      direction: "inflow", category: "income", essential: null,
      isTransfer: false, transferPairId: null,
    });
  });

  it("coerces a numeric-string amount and preserves nulls", () => {
    const row: TransactionRow = {
      id: "t2", account_id: "acc1", posted_date: "2026-06-12", amount: "500" as unknown as number,
      direction: "outflow", category: null, essential: false,
      is_transfer: true, transfer_pair_id: "t3",
    };
    const out = rowToTransactionInput(row);
    expect(out.amount).toBe(500);
    expect(out.category).toBeNull();
    expect(out.isTransfer).toBe(true);
    expect(out.transferPairId).toBe("t3");
  });
});

describe("rowToTransactionListItem", () => {
  const row: TransactionListRow = {
    id: "t1", account_id: "a1", posted_date: "2026-06-01", amount: "120.50" as unknown as number,
    direction: "outflow", description: "Card purchases", category: "discretionary",
    essential: false, is_transfer: false, transfer_pair_id: null, notes: "june trip",
    user_override: { category: "dining", amount: 9999 },
    financial_accounts: { display_name: "Rewards Card", provider: "demo" },
  };

  it("coerces numerics, applies overrides, and carries account context", () => {
    const item = rowToTransactionListItem(row);
    expect(item.amount).toBe(120.5);
    expect(item.category).toBe("dining");
    expect(item.corrected).toBe(true);
    expect(item.original?.category).toBe("discretionary");
    expect(item.accountName).toBe("Rewards Card");
    expect(item.accountProvider).toBe("demo");
    expect(item.notes).toBe("june trip");
  });

  it("treats malformed user_override as no correction", () => {
    const item = rowToTransactionListItem({ ...row, user_override: "junk" });
    expect(item.corrected).toBe(false);
    expect(item.category).toBe("discretionary");
  });
});

describe("rowToAccountSummary", () => {
  const row: AccountRow = {
    id: "a1", provider: "manual", institution: "Pacific Bank", type: "credit_card",
    display_name: "Rewards Card", mask: "7710", current_balance: "412.00" as unknown as number,
    credit_limit: 5000, interest_rate: "21.99" as unknown as number,
    include_in_calculations: true, archived_at: null,
  };

  it("maps and coerces account fields", () => {
    const s = rowToAccountSummary(row);
    expect(s.currentBalance).toBe(412);
    expect(s.creditLimit).toBe(5000);
    expect(s.interestRate).toBe(21.99);
    expect(s.type).toBe("credit_card");
    expect(s.archivedAt).toBeNull();
  });

  it("keeps null balances null", () => {
    expect(rowToAccountSummary({ ...row, current_balance: null }).currentBalance).toBeNull();
  });
});
