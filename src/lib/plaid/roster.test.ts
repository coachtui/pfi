import { describe, expect, it } from "vitest";
import type { MappedAccount } from "./map-account";
import { reconcileRoster } from "./roster";
import type { PfiAccount } from "./types";

const NOW = "2026-09-14T12:00:00.000Z";

const plaid = (id: string, over: Partial<MappedAccount> = {}): MappedAccount => ({
  externalAccountId: id, type: "checking", displayName: `Acct ${id}`, institution: "Bank", mask: "1234", creditLimit: null, ...over,
});
const pfi = (id: string, over: Partial<PfiAccount> = {}): PfiAccount => ({
  id: `pfi-${id}`, type: "checking", provider: "plaid", plaidItemId: "item", externalAccountId: id, archivedAt: null, rosterStatus: "shared", ...over,
});

describe("reconcileRoster", () => {
  it("creates newly discovered accounts, including a zero-transaction investment account (§13.1)", () => {
    const r = reconcileRoster([plaid("chk"), plaid("inv", { type: "brokerage", displayName: "Brokerage" })], [], NOW);
    expect(r.ops.map((o) => [o.op, o.external_account_id, o.type])).toEqual([
      ["create", "chk", "checking"], ["create", "inv", "brokerage"],
    ]);
    expect(r.audit).toEqual([
      { external_account_id: "chk", change: "created", at: NOW },
      { external_account_id: "inv", change: "created", at: NOW },
    ]);
  });

  it("keeps active accounts (refreshing display fields) and is idempotent on an unchanged roster", () => {
    const r = reconcileRoster([plaid("chk", { displayName: "Renamed", mask: "9999" })], [pfi("chk")], NOW);
    expect(r.ops).toEqual([{ op: "keep", external_account_id: "chk", type: "checking", display_name: "Renamed", institution: "Bank", mask: "9999", credit_limit: null }]);
    expect(r.audit).toEqual([]);
  });

  it("archives accounts Plaid no longer shares, preserving history, and audits it", () => {
    const r = reconcileRoster([plaid("chk")], [pfi("chk"), pfi("sav")], NOW);
    expect(r.ops).toContainEqual({ op: "archive", external_account_id: "sav", roster_status: "unshared" });
    expect(r.audit).toEqual([{ external_account_id: "sav", change: "unshared", at: NOW }]);
  });

  it("does not re-archive an already archived account", () => {
    const r = reconcileRoster([], [pfi("sav", { archivedAt: "2026-08-01T00:00:00Z", rosterStatus: "unshared" })], NOW);
    expect(r.ops).toEqual([]);
    expect(r.audit).toEqual([]);
  });

  it("un-archives a roster-archived account that reappears", () => {
    const r = reconcileRoster([plaid("sav")], [pfi("sav", { archivedAt: "2026-08-01T00:00:00Z", rosterStatus: "unshared" })], NOW);
    expect(r.ops[0]).toMatchObject({ op: "unarchive", external_account_id: "sav", roster_status: "shared" });
    expect(r.audit).toEqual([{ external_account_id: "sav", change: "reappeared", at: NOW }]);
  });

  it("respects a user's own archive: a user-archived account that is still shared is kept archived", () => {
    const r = reconcileRoster([plaid("sav")], [pfi("sav", { archivedAt: "2026-08-01T00:00:00Z", rosterStatus: "shared" })], NOW);
    expect(r.ops[0]?.op).toBe("keep");
    expect(r.audit).toEqual([]);
  });

  it("ignores PFI accounts without an external id (never touches manual/csv rows)", () => {
    const r = reconcileRoster([], [pfi("x", { provider: "manual", externalAccountId: null, plaidItemId: null })], NOW);
    expect(r.ops).toEqual([]);
  });
});
