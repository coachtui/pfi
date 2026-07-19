import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const STATE_PATH = path.resolve(__dirname, ".state.json");
const BASE_URL = "http://localhost:3100";

export interface E2eState {
  email: string;
  userId: string;
  loginUrl: string;
}

export function readState(): E2eState {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as E2eState;
}

/**
 * Mints a real Supabase session for a throwaway user and writes the
 * implicit-flow login URL (/login#access_token=...) the product consumes.
 * We exchange the magic link's token server-side instead of visiting
 * GoTrue's action link because its redirect allowlist is pinned to
 * localhost:3000 in supabase/config.toml — the hash-processing flow under
 * test is identical either way.
 */
export default async function globalSetup(): Promise<void> {
  try {
    process.loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
  } catch {
    // fall through to the explicit check below
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    throw new Error(
      "e2e needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }

  const email = `e2e-${Date.now()}@example.com`;
  const admin = createClient(url, service);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw new Error(`e2e setup: createUser failed: ${createErr.message}`);

  const { error: consentErr } = await admin.from("user_agreements").insert([
    { user_id: created.user.id, document: "terms", version: "2026-07-19" },
    { user_id: created.user.id, document: "privacy", version: "2026-07-19" },
  ]);
  if (consentErr) throw new Error(`e2e setup: consent insert failed: ${consentErr.message}`);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr) throw new Error(`e2e setup: generateLink failed: ${linkErr.message}`);

  const verifyRes = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: link.properties.hashed_token }),
  });
  if (!verifyRes.ok) {
    throw new Error(`e2e setup: token verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
  }
  const session = (await verifyRes.json()) as { access_token: string; refresh_token: string };

  const loginUrl = `${BASE_URL}/login#access_token=${session.access_token}&refresh_token=${session.refresh_token}`;
  fs.writeFileSync(STATE_PATH, JSON.stringify({ email, userId: created.user.id, loginUrl }, null, 2));
}
