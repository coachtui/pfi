/**
 * Server-only env. Validated lazily (at first use, not import) so client
 * bundles and builds without the key still succeed — only the auth actions
 * that need service-role access fail loudly if it's absent.
 */
export function serviceRoleKey(source: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for auth actions. Set it in .env.local (dev) and the Vercel project env (production).",
    );
  }
  return key;
}

export type PlaidEnvironment = "sandbox" | "production";

export interface PlaidServerConfig {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
  /** AES-256-GCM key for `plaid_item_secrets`; raw 32 bytes. */
  tokenKey: Uint8Array;
  /** Prior key during rotation (see SECURITY_MODEL.md), or null. */
  previousTokenKey: Uint8Array | null;
}

const PLAID_ENVIRONMENTS: ReadonlySet<string> = new Set(["sandbox", "production"]);
const KEY_BYTES = 32;

function decodeKey(name: string, value: string): Uint8Array {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw new Error(`${name} must be base64.`);
  }
  if (bytes.length !== KEY_BYTES || bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(`${name} must be exactly ${KEY_BYTES} bytes, base64-encoded (generate with: openssl rand -base64 32).`);
  }
  return new Uint8Array(bytes);
}

/**
 * Plaid configuration (ROADMAP Phase 7, DECISIONS #43). Returns null when the
 * feature is not configured — `PLAID_CLIENT_ID` and `PLAID_SECRET` both absent
 * or empty — so the Connected-institutions surface degrades to a
 * "not configured" state the way a missing `AI_GATEWAY_API_KEY` disables AI
 * narration. A partial configuration is a deployment mistake and throws.
 *
 * Never imported from `env.ts`: these values must never reach a client bundle.
 */
export function plaidConfig(source: Partial<NodeJS.ProcessEnv> = process.env): PlaidServerConfig | null {
  const clientId = source.PLAID_CLIENT_ID || undefined;
  const secret = source.PLAID_SECRET || undefined;
  if (!clientId && !secret) return null;

  const missing: string[] = [];
  if (!clientId) missing.push("PLAID_CLIENT_ID");
  if (!secret) missing.push("PLAID_SECRET");
  if (!source.PLAID_TOKEN_ENCRYPTION_KEY) missing.push("PLAID_TOKEN_ENCRYPTION_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Plaid is partially configured — missing ${missing.join(", ")}. Set all of PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_TOKEN_ENCRYPTION_KEY, or unset them all to disable bank connections.`,
    );
  }

  const environment = source.PLAID_ENV || "sandbox";
  if (!PLAID_ENVIRONMENTS.has(environment)) {
    throw new Error(`PLAID_ENV must be "sandbox" or "production" (got "${environment}").`);
  }

  return {
    clientId: clientId!,
    secret: secret!,
    environment: environment as PlaidEnvironment,
    tokenKey: decodeKey("PLAID_TOKEN_ENCRYPTION_KEY", source.PLAID_TOKEN_ENCRYPTION_KEY!),
    previousTokenKey: source.PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS
      ? decodeKey("PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS", source.PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS)
      : null,
  };
}
