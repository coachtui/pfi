/**
 * Rotate the Plaid access-token encryption key (docs/SECURITY_MODEL.md).
 *
 * Procedure:
 *   1. Generate a new key: `openssl rand -base64 32`.
 *   2. Move the current PLAID_TOKEN_ENCRYPTION_KEY to PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS
 *      and set the new key as PLAID_TOKEN_ENCRYPTION_KEY (in .env.local and the Vercel
 *      project env; redeploy so running code can read rows under either key).
 *   3. `pnpm tsx --env-file=.env.local scripts/rotate-plaid-key.mts --dry-run`, then without.
 *   4. Unset PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS and redeploy.
 *
 * Re-encrypts every plaid_item_secrets row not already under the current key.
 * Uses the service role (the only reader of that table). Never prints tokens.
 */
import { createClient } from "@supabase/supabase-js";
import { plaidConfig } from "../src/lib/config/env.server";
import { decryptToken, encryptToken, keyRingFor, keyVersionOf } from "../src/lib/plaid/crypto";

const dryRun = process.argv.includes("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const cfg = plaidConfig();
if (!cfg) throw new Error("Plaid is not configured (PLAID_* unset)");
const currentVersion = keyVersionOf(cfg.tokenKey);
const ring = keyRingFor(cfg.tokenKey, cfg.previousTokenKey);

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.from("plaid_item_secrets").select("plaid_item_id, access_token_ciphertext, key_version");
if (error) throw new Error(error.message);

let rotated = 0;
let skipped = 0;
let failed = 0;
for (const row of data ?? []) {
  const version = Number(row.key_version);
  if (version === currentVersion) { skipped++; continue; }
  try {
    const plaintext = await decryptToken({ ciphertext: row.access_token_ciphertext as string, keyVersion: version }, ring);
    const enc = await encryptToken(plaintext, cfg.tokenKey, currentVersion);
    if (!dryRun) {
      const { error: upErr } = await admin.from("plaid_item_secrets")
        .update({ access_token_ciphertext: enc.ciphertext, key_version: enc.keyVersion, rotated_at: new Date().toISOString() })
        .eq("plaid_item_id", row.plaid_item_id);
      if (upErr) throw new Error(upErr.message);
    }
    rotated++;
  } catch (e) {
    failed++;
    console.error(`item ${row.plaid_item_id}: ${e instanceof Error ? e.message : "rotation failed"} (key_version ${version})`);
  }
}
console.log(`${dryRun ? "[dry-run] " : ""}rotated ${rotated}, already current ${skipped}, failed ${failed} (current key_version ${currentVersion})`);
process.exit(failed === 0 ? 0 : 1);
