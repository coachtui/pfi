import { describe, expect, it } from "vitest";
import type { BalanceAnchor } from "@/lib/financial-engine";
import { anchorDateFor, buildSyncPlan, deriveItemStatus, type SyncPlanInput } from "./sync-plan";
import type { ExistingTxn, PfiAccount, PlaidAccountShape, PlaidTransactionShape, SyncPages } from "./types";

const TODAY = "2026-09-14";
const NOW = "2026-09-14T15:00:00.000Z";
const ITEM = "item-1";

const acct = (id: string, over: Partial<PlaidAccountShape> = {}): PlaidAccountShape => ({
  accountId: id, name: `Acct ${id}`, officialName: null, mask: "1111", type: "depository", subtype: "checking",
  balances: { current: 1000, available: 900, limit: null, lastUpdatedDatetime: null }, ...over,
});
const txn = (id: string, over: Partial<PlaidTransactionShape> = {}): PlaidTransactionShape => ({
  transactionId: id, accountId: "chk", amount: 25, date: "2026-09-10", authorizedDate: null, name: `Txn ${id}`, merchantName: null,
  pending: false, personalFinanceCategory: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", confidenceLevel: "HIGH" },
  taxonomyVersion: "v2", ...over,
});
const pages = (over: Partial<SyncPages> = {}): SyncPages => ({
  added: [], modified: [], removed: [], nextCursor: "cur-2", updateStatus: "HISTORICAL_UPDATE_COMPLETE", requestIds: ["req-1"], ...over,
});
const pfi = (id: string, over: Partial<PfiAccount> = {}): PfiAccount => ({
  id: `pfi-${id}`, type: "checking", provider: "plaid", plaidItemId: ITEM, externalAccountId: id, archivedAt: null, rosterStatus: "shared", ...over,
});
const existing = (id: string, over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id: `row-${id}`, accountId: "pfi-chk", externalId: id, postedDate: "2026-09-10", amount: 25, direction: "outflow", description: `Txn ${id}`,
  isTransfer: false, transferPairId: null, provider: "plaid", pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: "FOOD_AND_DRINK_COFFEE", ...over,
});
const base = (over: Partial<SyncPlanInput> = {}): SyncPlanInput => ({
  pages: pages(), accountsGet: [acct("chk")], institutionName: "Bank", existingTxns: [], pfiAccounts: [], priorAnchors: [],
  item: { id: ITEM, status: "initializing", historyCompleteAt: null, cursor: null }, today: TODAY, now: NOW, ...over,
});

describe("buildSyncPlan — first sync", () => {
  it("creates accounts from /accounts/get, inserts posted rows by external account id, anchors cached balances, advances the cursor", () => {
    const plan = buildSyncPlan(base({
      accountsGet: [acct("chk"), acct("inv", { type: "investment", subtype: "brokerage", balances: { current: 5000, available: null, limit: null, lastUpdatedDatetime: null } })],
      pages: pages({ added: [txn("t1"), txn("t2", { pending: true })] }),
    }));
    expect(plan.accounts.map((a) => [a.op, a.external_account_id, a.type])).toEqual([["create", "chk", "checking"], ["create", "inv", "brokerage"]]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ external_account_id: "chk", external_id: "t1", amount: 25, direction: "outflow", category: "dining", pair_key: null });
    // The zero-transaction investment account is still anchored (§13.1).
    expect(plan.anchors.map((a) => [a.external_account_id, a.balance, a.freshness, a.discrepancy])).toEqual([["chk", 1000, "cached", null], ["inv", 5000, "cached", null]]);
    expect(plan.anchors[0].anchor_date).toBe(TODAY);
    expect(plan.item).toEqual({ cursor: "cur-2", update_status: "HISTORICAL_UPDATE_COMPLETE", status: "connected", history_complete: true, error_code: null });
    expect(plan.sync_metadata).toMatchObject({ request_ids: ["req-1"], cursor_before: null, cursor_after: "cur-2", pending_skipped: 1 });
    expect(plan.reconciliation_results.roster).toHaveLength(2);
  });

  it("never reads accounts from the sync pages: a transaction for an account absent from /accounts/get is skipped and counted", () => {
    const plan = buildSyncPlan(base({ pages: pages({ added: [txn("t1", { accountId: "ghost" })] }) }));
    expect(plan.inserts).toEqual([]);
    expect(plan.sync_metadata).toMatchObject({ unknown_account_transactions: 1 });
  });
});

describe("buildSyncPlan — steady state", () => {
  const steady = (over: Partial<SyncPlanInput> = {}) => base({
    pfiAccounts: [pfi("chk"), pfi("sav", { type: "savings" })],
    accountsGet: [acct("chk"), acct("sav", { subtype: "savings" })],
    existingTxns: [existing("t1")],
    item: { id: ITEM, status: "connected", historyCompleteAt: "2026-09-01T00:00:00Z", cursor: "cur-1" },
    ...over,
  });

  it("is idempotent: re-running the same added rows inserts nothing", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ added: [txn("t1")] }) }));
    expect(plan.inserts).toEqual([]);
    expect(plan.accounts.every((a) => a.op === "keep")).toBe(true);
  });

  it("modified with only a name/category change updates provider columns in place and does not unpair or audit", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ modified: [txn("t1", { merchantName: "Renamed" })] }) }));
    expect(plan.updates).toEqual([expect.objectContaining({ id: "row-t1", description: "Renamed", unpair: false })]);
    expect(Object.keys(plan.updates[0]).sort()).toEqual(["amount", "authorized_date", "category", "category_confidence", "category_taxonomy_version", "description", "direction", "id", "pfc_detailed", "pfc_primary", "posted_date", "unpair"]);
    expect(plan.reconciliation_results.retractions).toEqual([]);
    expect(plan.unpair_ids).toEqual([]);
  });

  it("modified with an amount change on a paired row unpairs both sides and records an audit entry", () => {
    const plan = buildSyncPlan(steady({
      existingTxns: [existing("t1", { isTransfer: true, transferPairId: "row-t9" }), existing("t9", { accountId: "pfi-sav", direction: "inflow", isTransfer: true, transferPairId: "row-t1", pfcPrimary: "TRANSFER_IN" })],
      pages: pages({ modified: [txn("t1", { amount: 30 })] }),
    }));
    expect(plan.updates[0]).toMatchObject({ id: "row-t1", amount: 30, unpair: true });
    expect(plan.unpair_ids).toEqual(["row-t9"]);
    expect(plan.reconciliation_results.retractions[0]).toMatchObject({ external_id: "t1", action: "modified", prior: { amount: 25, posted_date: "2026-09-10" } });
  });

  it("modified for a row PFI has never seen (pending→posted with a new id) becomes an insert", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ modified: [txn("t-new")] }) }));
    expect(plan.inserts.map((i) => i.external_id)).toEqual(["t-new"]);
    expect(plan.updates).toEqual([]);
  });

  it("removed deletes the row with a full audit record; unknown removals are ignored", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ removed: [{ transactionId: "t1", accountId: "chk" }, { transactionId: "nope", accountId: "chk" }] }) }));
    expect(plan.deletes).toEqual([{ id: "row-t1" }]);
    expect(plan.reconciliation_results.retractions).toEqual([{
      external_id: "t1", action: "removed", reason: "Plaid removed the transaction",
      prior: { posted_date: "2026-09-10", amount: 25, direction: "outflow", description: "Txn t1" }, at: NOW,
    }]);
  });

  it("pairs a new transfer-out with a new transfer-in across accounts via a shared pair_key", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ added: [
      txn("out", { accountId: "chk", amount: 500, personalFinanceCategory: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } }),
      txn("in", { accountId: "sav", amount: -500, date: "2026-09-11", personalFinanceCategory: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } }),
    ] }) }));
    const keys = plan.inserts.map((i) => i.pair_key);
    expect(keys).toEqual(["pair-1", "pair-1"]);
    expect(plan.pair_existing).toEqual([]);
    expect(plan.reconciliation_results.ambiguous_transfers).toEqual([]);
  });

  it("pairs a new inflow with an existing unpaired outflow through pair_existing", () => {
    const plan = buildSyncPlan(steady({
      existingTxns: [existing("out", { amount: 500, pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" })],
      pages: pages({ added: [txn("in", { accountId: "sav", amount: -500, personalFinanceCategory: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } })] }),
    }));
    expect(plan.inserts[0].pair_key).toBe("pair-1");
    expect(plan.pair_existing).toEqual([{ id: "row-out", pair_key: "pair-1" }]);
  });

  it("reports ambiguous transfers instead of guessing", () => {
    const plan = buildSyncPlan(steady({ pages: pages({ added: [
      txn("out", { amount: 500, personalFinanceCategory: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } }),
      txn("in1", { accountId: "sav", amount: -500, personalFinanceCategory: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } }),
      txn("in2", { accountId: "sav", amount: -500, date: "2026-09-12", personalFinanceCategory: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER", confidenceLevel: "HIGH" } }),
    ] }) }));
    expect(plan.inserts.every((i) => i.pair_key === null)).toBe(true);
    expect(plan.reconciliation_results.ambiguous_transfers).toEqual(["ext:in1", "ext:in2", "ext:out"]);
  });

  it("archives an account Plaid no longer shares and stops anchoring it", () => {
    const plan = buildSyncPlan(steady({ accountsGet: [acct("chk")] }));
    expect(plan.accounts).toContainEqual({ op: "archive", external_account_id: "sav", roster_status: "unshared" });
    expect(plan.anchors.map((a) => a.external_account_id)).toEqual(["chk"]);
    expect(plan.reconciliation_results.roster).toEqual([{ external_account_id: "sav", change: "unshared", at: NOW }]);
  });
});

describe("buildSyncPlan — anchors", () => {
  const prior: BalanceAnchor[] = [{ accountId: "pfi-chk", anchorDate: "2026-09-10", balance: 1025, createdAt: "2026-09-10T00:00:00Z" }];
  const withAnchor = (over: Partial<SyncPlanInput> = {}) => base({
    pfiAccounts: [pfi("chk")], accountsGet: [acct("chk")], priorAnchors: prior, existingTxns: [existing("t1")],
    item: { id: ITEM, status: "connected", historyCompleteAt: "2026-09-01T00:00:00Z", cursor: "cur-1" }, ...over,
  });

  it("reconciles against the effective prior anchor rolled forward through new transactions (zero discrepancy)", () => {
    // anchor 1025 on 09-10; a new 25 outflow on 09-12; today's balance 1000 → clean.
    const plan = buildSyncPlan(withAnchor({ pages: pages({ added: [txn("t2", { date: "2026-09-12" })] }) }));
    expect(plan.anchors[0]).toMatchObject({ balance: 1000, discrepancy: 0, anchor_date: TODAY, observed_at: NOW, source_updated_at: null });
    expect(plan.reconciliation_results.discrepancies).toEqual([]);
  });

  it("records a non-zero discrepancy as a completeness signal", () => {
    const plan = buildSyncPlan(withAnchor({ accountsGet: [acct("chk", { balances: { current: 900, available: null, limit: null, lastUpdatedDatetime: null } })] }));
    expect(plan.anchors[0].discrepancy).toBe(-125);
    expect(plan.reconciliation_results.discrepancies).toEqual([{ external_account_id: "chk", discrepancy: -125 }]);
  });

  it("uses the institution timestamp's date when Plaid provides one, and skips an identical anchor already recorded", () => {
    const plan = buildSyncPlan(withAnchor({ accountsGet: [acct("chk", { balances: { current: 1025, available: null, limit: null, lastUpdatedDatetime: "2026-09-10T08:00:00Z" } })] }));
    expect(plan.anchors).toEqual([]); // same (account, date, balance) as the prior anchor
    const plan2 = buildSyncPlan(withAnchor({ accountsGet: [acct("chk", { balances: { current: 990, available: null, limit: null, lastUpdatedDatetime: "2026-09-13T08:00:00Z" } })] }));
    expect(plan2.anchors[0]).toMatchObject({ anchor_date: "2026-09-13", source_updated_at: "2026-09-13T08:00:00Z" });
  });

  it("skips accounts with no current balance", () => {
    const plan = buildSyncPlan(withAnchor({ accountsGet: [acct("chk", { balances: { current: null, available: null, limit: null, lastUpdatedDatetime: null } })] }));
    expect(plan.anchors).toEqual([]);
  });
});

describe("deriveItemStatus / anchorDateFor", () => {
  it("maps Plaid readiness onto Item status", () => {
    expect(deriveItemStatus("NOT_READY", "initializing", null)).toBe("history_loading");
    expect(deriveItemStatus("INITIAL_UPDATE_COMPLETE", "history_loading", null)).toBe("history_loading");
    expect(deriveItemStatus("HISTORICAL_UPDATE_COMPLETE", "history_loading", null)).toBe("connected");
    expect(deriveItemStatus("INITIAL_UPDATE_COMPLETE", "connected", "2026-09-01T00:00:00Z")).toBe("connected");
    expect(deriveItemStatus("TRANSACTIONS_UPDATE_STATUS_UNKNOWN", "connected", "2026-09-01T00:00:00Z")).toBe("connected");
    expect(deriveItemStatus("TRANSACTIONS_UPDATE_STATUS_UNKNOWN", "history_loading", null)).toBe("history_loading");
    expect(deriveItemStatus("TRANSACTIONS_UPDATE_STATUS_UNKNOWN", "login_required", "2026-09-01T00:00:00Z")).toBe("connected");
    expect(deriveItemStatus("TRANSACTIONS_UPDATE_STATUS_UNKNOWN", "error", null)).toBe("history_loading");
  });

  it("history_complete is set only from HISTORICAL_UPDATE_COMPLETE (the RPC sets history_complete_at once)", () => {
    expect(buildSyncPlan(base({ pages: pages({ updateStatus: "NOT_READY" }) })).item).toMatchObject({ status: "history_loading", history_complete: false });
    expect(buildSyncPlan(base()).item.history_complete).toBe(true);
  });

  it("anchorDateFor prefers the institution date", () => {
    expect(anchorDateFor("2026-09-13T08:00:00Z", TODAY)).toBe("2026-09-13");
    expect(anchorDateFor(null, TODAY)).toBe(TODAY);
    expect(anchorDateFor("garbage", TODAY)).toBe(TODAY);
  });
});
