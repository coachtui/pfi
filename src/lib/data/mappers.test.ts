import { describe, expect, it } from "vitest";
import { rowToSnapshot, snapshotToRow, eventToRow, rowToEvent, rowToTransactionInput, type TransactionRow } from "./mappers";
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
