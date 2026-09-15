import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_KEY, LINK_RESULT_KEY, LINK_SESSION_KEY, LINK_SESSION_TTL_MS, clearLinkSession, hasSeenDisclosure, markDisclosureSeen,
  clearLinkState, linkStorage, readLinkSession, saveLinkResult, saveLinkSession, takeLinkResult, type StorageLike,
} from "./link-session";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const throwingStorage: StorageLike = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

describe("link session", () => {
  it("round-trips a connect session and an update session", () => {
    const s = memoryStorage();
    saveLinkSession(s, { linkToken: "link-sandbox-abc", mode: { kind: "connect" }, userId: "u1" }, 1000);
    expect(readLinkSession(s, "u1", 2000)).toEqual({ linkToken: "link-sandbox-abc", mode: { kind: "connect" }, userId: "u1", createdAt: 1000 });
    saveLinkSession(s, { linkToken: "link-sandbox-upd", mode: { kind: "update", itemId: "item-1" }, userId: "u1" }, 1000);
    expect(readLinkSession(s, "u1", 2000)?.mode).toEqual({ kind: "update", itemId: "item-1" });
  });

  it("expires after 30 minutes and removes the stale entry", () => {
    const s = memoryStorage();
    saveLinkSession(s, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" }, 0);
    expect(readLinkSession(s, "u1", LINK_SESSION_TTL_MS)).not.toBeNull();
    expect(readLinkSession(s, "u1", LINK_SESSION_TTL_MS + 1)).toBeNull();
    expect(s.map.has(LINK_SESSION_KEY)).toBe(false);
  });

  it("rejects a session from the future, malformed JSON, and shapes that are not a session", () => {
    const s = memoryStorage();
    saveLinkSession(s, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" }, 5000);
    expect(readLinkSession(s, "u1", 4000)).toBeNull();
    s.setItem(LINK_SESSION_KEY, "{not json");
    expect(readLinkSession(s, "u1")).toBeNull();
    s.setItem(LINK_SESSION_KEY, JSON.stringify({ linkToken: "", mode: { kind: "connect" }, userId: "u1", createdAt: 1 }));
    expect(readLinkSession(s, "u1", 2)).toBeNull();
    s.setItem(LINK_SESSION_KEY, JSON.stringify({ linkToken: "t", mode: { kind: "update" }, userId: "u1", createdAt: 1 }));
    expect(readLinkSession(s, "u1", 2)).toBeNull();
    s.setItem(LINK_SESSION_KEY, JSON.stringify({ linkToken: "t", mode: { kind: "connect" }, createdAt: 1 }));
    expect(readLinkSession(s, "u1", 2)).toBeNull(); // no user bound
  });

  it("clearLinkSession removes the entry", () => {
    const s = memoryStorage();
    saveLinkSession(s, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" });
    clearLinkSession(s);
    expect(readLinkSession(s, "u1")).toBeNull();
  });

  it("a session minted for one user is refused (and dropped) for another; clearLinkState wipes session + result", () => {
    const s = memoryStorage();
    saveLinkSession(s, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" }, 0);
    expect(readLinkSession(s, "u2", 1)).toBeNull();
    expect(s.map.has(LINK_SESSION_KEY)).toBe(false);
    saveLinkSession(s, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" });
    saveLinkResult(s, { ok: true, message: "x" });
    clearLinkState(s);
    expect(s.map.size).toBe(0);
  });

  it("results are handed over once", () => {
    const s = memoryStorage();
    saveLinkResult(s, { ok: true, message: "Connected — 2 accounts.", warning: true });
    expect(takeLinkResult(s)).toEqual({ ok: true, message: "Connected — 2 accounts.", warning: true });
    expect(takeLinkResult(s)).toBeNull();
    s.setItem(LINK_RESULT_KEY, JSON.stringify({ ok: "yes" }));
    expect(takeLinkResult(s)).toBeNull();
  });

  it("disclosure flag is per device and survives a failed read as 'not seen'", () => {
    const s = memoryStorage();
    expect(hasSeenDisclosure(s)).toBe(false);
    markDisclosureSeen(s);
    expect(hasSeenDisclosure(s)).toBe(true);
    expect(s.map.get(DISCLOSURE_KEY)).toBe("1");
  });

  it("never throws when storage is unavailable", () => {
    expect(() => saveLinkSession(throwingStorage, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" })).not.toThrow();
    expect(readLinkSession(throwingStorage, "u1")).toBeNull();
    expect(() => clearLinkSession(throwingStorage)).not.toThrow();
    expect(takeLinkResult(throwingStorage)).toBeNull();
    expect(hasSeenDisclosure(throwingStorage)).toBe(false);
    expect(() => markDisclosureSeen(throwingStorage)).not.toThrow();
  });

  it("linkStorage returns an inert store when window/localStorage is unavailable", () => {
    // Node test environment: no window at all → must not throw and must behave as empty.
    const store = linkStorage();
    expect(readLinkSession(store, "u1")).toBeNull();
    expect(() => saveLinkSession(store, { linkToken: "t", mode: { kind: "connect" }, userId: "u1" })).not.toThrow();
  });
});
