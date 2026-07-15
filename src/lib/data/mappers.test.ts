import { describe, expect, it } from "vitest";
import { rowToSnapshot, snapshotToRow, eventToRow, rowToEvent } from "./mappers";
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
