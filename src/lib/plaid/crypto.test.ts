import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, keyRing } from "./crypto";

const k1 = new Uint8Array(32).fill(1);
const k2 = new Uint8Array(32).fill(2);

describe("token crypto", () => {
  it("round-trips a token", async () => {
    const enc = await encryptToken("access-sandbox-abc", k1, 1);
    expect(enc.keyVersion).toBe(1);
    expect(enc.ciphertext).not.toContain("access-sandbox");
    expect(await decryptToken(enc, keyRing(k1, 1, null))).toBe("access-sandbox-abc");
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const a = await encryptToken("same", k1, 1);
    const b = await encryptToken("same", k1, 1);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails with the wrong key", async () => {
    const enc = await encryptToken("secret", k1, 1);
    await expect(decryptToken(enc, keyRing(k2, 1, null))).rejects.toThrow(/decryption failed/);
  });

  it("detects tampering", async () => {
    const enc = await encryptToken("secret", k1, 1);
    const bytes = Buffer.from(enc.ciphertext, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptToken({ ...enc, ciphertext: bytes.toString("base64") }, keyRing(k1, 1, null))).rejects.toThrow(
      /decryption failed/,
    );
  });

  it("routes by key version during rotation", async () => {
    const old = await encryptToken("secret", k1, 1);
    const ring = keyRing(k2, 2, k1); // rotated: v2 current, v1 previous
    expect(await decryptToken(old, ring)).toBe("secret");
    const fresh = await encryptToken("secret", k2, 2);
    expect(await decryptToken(fresh, ring)).toBe("secret");
  });

  it("rejects an unknown key version", async () => {
    const enc = await encryptToken("secret", k1, 1);
    await expect(decryptToken(enc, keyRing(k2, 3, null))).rejects.toThrow(/key_version 1/);
  });

  it("enforces the key length and non-empty plaintext", async () => {
    await expect(encryptToken("x", new Uint8Array(16), 1)).rejects.toThrow(/32 bytes/);
    await expect(encryptToken("", k1, 1)).rejects.toThrow(/empty/);
    await expect(decryptToken({ ciphertext: "AAAA", keyVersion: 1 }, keyRing(k1, 1, null))).rejects.toThrow(/too short/);
  });
});
