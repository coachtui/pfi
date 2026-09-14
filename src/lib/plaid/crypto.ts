/**
 * Application-layer encryption for Plaid access tokens (spec §1/§11,
 * DECISIONS #43). AES-256-GCM via Node's webcrypto; the ciphertext row in
 * `plaid_item_secrets` stores base64(iv || ciphertext || tag) plus a
 * `key_version` so rotation can decrypt old rows with the previous key.
 *
 * Pure: keys are parameters, no env access, no logging. Never log the inputs
 * or outputs of these functions.
 */
import { webcrypto } from "node:crypto";

const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedToken {
  ciphertext: string;
  keyVersion: number;
}

export type KeyRing = ReadonlyMap<number, Uint8Array>;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new Error(`token key must be ${KEY_BYTES} bytes`);
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  assertKey(raw);
  return webcrypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plaintext: string, key: Uint8Array, keyVersion: number): Promise<EncryptedToken> {
  if (!plaintext) throw new Error("cannot encrypt an empty token");
  const cryptoKey = await importKey(key);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(IV_BYTES + encrypted.length);
  out.set(iv, 0);
  out.set(encrypted, IV_BYTES);
  return { ciphertext: Buffer.from(out).toString("base64"), keyVersion };
}

/**
 * Decrypts with the key registered for `token.keyVersion`. A missing version
 * or a wrong/tampered key surfaces as a generic error — callers must not
 * distinguish the two to the user.
 */
export async function decryptToken(token: EncryptedToken, keys: KeyRing): Promise<string> {
  const raw = keys.get(token.keyVersion);
  if (!raw) throw new Error(`no key registered for key_version ${token.keyVersion}`);
  const cryptoKey = await importKey(raw);
  const bytes = new Uint8Array(Buffer.from(token.ciphertext, "base64"));
  if (bytes.length <= IV_BYTES) throw new Error("ciphertext too short");
  const iv = bytes.subarray(0, IV_BYTES);
  const body = bytes.subarray(IV_BYTES);
  let decrypted: ArrayBuffer;
  try {
    decrypted = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, body);
  } catch {
    throw new Error("token decryption failed");
  }
  return new TextDecoder().decode(decrypted);
}

/** Build the ring from config: current key is version `current`, previous (if any) is `current - 1`. */
export function keyRing(current: Uint8Array, currentVersion: number, previous: Uint8Array | null): KeyRing {
  const ring = new Map<number, Uint8Array>([[currentVersion, current]]);
  if (previous) ring.set(currentVersion - 1, previous);
  return ring;
}
