import "server-only";
/**
 * The only module that touches the `plaid` SDK (spec §3). Narrows SDK
 * responses into the plain shapes in ./types, captures `request_id` on every
 * call, and turns SDK/axios failures into `PlaidCallError` carrying ONLY
 * `error_type`, `error_code`, `request_id` — never tokens, account ids,
 * amounts, or descriptions (spec §11 logging rule).
 */
import {
  Configuration, CountryCode, PersonalFinanceCategoryVersion, PlaidApi, PlaidEnvironments, Products,
  type AccountBase, type Transaction, type TransactionsSyncResponse,
} from "plaid";
import { plaidConfig, type PlaidServerConfig } from "@/lib/config/env.server";
import type { PlaidAccountShape, PlaidTransactionShape, SyncPages, UpdateStatus } from "./types";

export class PlaidCallError extends Error {
  constructor(
    public readonly call: string,
    public readonly errorType: string,
    public readonly errorCode: string,
    public readonly requestId: string | null,
    public readonly httpStatus: number | null,
  ) {
    super(`plaid ${call}: ${errorType}/${errorCode}${requestId ? ` (request ${requestId})` : ""}`);
    this.name = "PlaidCallError";
  }
}

/** Plaid error codes that mean "the user must re-authenticate through Link update mode". */
export const LOGIN_REQUIRED_CODES: ReadonlySet<string> = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "USER_PERMISSION_REVOKED"]);

let cached: { cfg: PlaidServerConfig; api: PlaidApi } | null = null;

/** Configured SDK client, or null when Plaid is not configured (feature disabled). */
export function getPlaidClient(): { cfg: PlaidServerConfig; api: PlaidApi } | null {
  const cfg = plaidConfig();
  if (!cfg) return null;
  if (cached && cached.cfg.clientId === cfg.clientId && cached.cfg.environment === cfg.environment) return cached;
  const api = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[cfg.environment],
    baseOptions: { headers: { "PLAID-CLIENT-ID": cfg.clientId, "PLAID-SECRET": cfg.secret, "Plaid-Version": "2020-09-14" } },
  }));
  cached = { cfg, api };
  return cached;
}

interface AxiosLikeError {
  response?: { status?: number; data?: { error_type?: string; error_code?: string; request_id?: string } };
  message?: string;
}

/** Minimal response shape (the SDK returns axios responses; we only read `data`). */
interface SdkResponse<T> { data: T }

/** Run one SDK call; return data + request id; normalize failures. Never logs payloads. */
export async function plaidCall<T extends { request_id: string }>(name: string, fn: () => Promise<SdkResponse<T>>): Promise<{ data: T; requestId: string }> {
  try {
    const res = await fn();
    return { data: res.data, requestId: res.data.request_id };
  } catch (e) {
    const err = e as AxiosLikeError;
    const data = err.response?.data;
    const errorType = data?.error_type ?? "API_ERROR";
    const errorCode = data?.error_code ?? "UNKNOWN";
    const requestId = data?.request_id ?? null;
    console.error(`[plaid] ${name} failed: ${errorType}/${errorCode} request_id=${requestId ?? "n/a"}`);
    throw new PlaidCallError(name, errorType, errorCode, requestId, err.response?.status ?? null);
  }
}

// ---- Narrowing ----

export function toAccountShape(a: AccountBase): PlaidAccountShape {
  return {
    accountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: String(a.type),
    subtype: a.subtype ? String(a.subtype) : null,
    balances: {
      current: a.balances.current ?? null,
      available: a.balances.available ?? null,
      limit: a.balances.limit ?? null,
      lastUpdatedDatetime: a.balances.last_updated_datetime ?? null,
    },
  };
}

export function toTransactionShape(t: Transaction): PlaidTransactionShape {
  const pfc = t.personal_finance_category ?? null;
  return {
    transactionId: t.transaction_id,
    accountId: t.account_id,
    amount: t.amount,
    date: t.date,
    authorizedDate: t.authorized_date ?? null,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    pending: t.pending,
    personalFinanceCategory: pfc ? { primary: pfc.primary, detailed: pfc.detailed, confidenceLevel: pfc.confidence_level ?? null } : null,
    taxonomyVersion: pfc?.version === PersonalFinanceCategoryVersion.V1 ? "v1" : "v2",
  };
}

// ---- Calls ----

export async function fetchAccounts(api: PlaidApi, accessToken: string): Promise<{ accounts: PlaidAccountShape[]; institutionId: string | null; requestId: string }> {
  const { data, requestId } = await plaidCall("accounts/get", () => api.accountsGet({ access_token: accessToken }));
  return { accounts: data.accounts.map(toAccountShape), institutionId: data.item.institution_id ?? null, requestId };
}

export const SYNC_PAGE_COUNT = 500;
const MUTATION_ERROR = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

/**
 * Page `/transactions/sync` from `cursor` (null = first sync) until
 * `has_more` is false, requesting PFCv2 (spec §13.2). On a mutation during
 * pagination, restart once from the same saved cursor. Nothing is written
 * here; the caller commits the whole page set atomically.
 */
export async function fetchSyncPages(api: PlaidApi, accessToken: string, cursor: string | null): Promise<SyncPages> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await pageOnce(api, accessToken, cursor);
    } catch (e) {
      if (e instanceof PlaidCallError && e.errorCode === MUTATION_ERROR && attempt < 2) continue;
      throw e;
    }
  }
}

async function pageOnce(api: PlaidApi, accessToken: string, startCursor: string | null): Promise<SyncPages> {
  const pages: SyncPages = { added: [], modified: [], removed: [], nextCursor: startCursor ?? "", updateStatus: "TRANSACTIONS_UPDATE_STATUS_UNKNOWN", requestIds: [] };
  let cursor = startCursor ?? undefined;
  let hasMore = true;
  while (hasMore) {
    const { data, requestId } = await plaidCall<TransactionsSyncResponse>("transactions/sync", () =>
      api.transactionsSync({
        access_token: accessToken,
        cursor,
        count: SYNC_PAGE_COUNT,
        options: { include_personal_finance_category: true, personal_finance_category_version: PersonalFinanceCategoryVersion.V2 },
      }),
    );
    pages.requestIds.push(requestId);
    pages.added.push(...data.added.map(toTransactionShape));
    pages.modified.push(...data.modified.map(toTransactionShape));
    pages.removed.push(...data.removed.map((r) => ({ transactionId: r.transaction_id, accountId: r.account_id ?? null })));
    pages.updateStatus = String(data.transactions_update_status) as UpdateStatus;
    hasMore = data.has_more;
    cursor = data.next_cursor;
    pages.nextCursor = data.next_cursor || pages.nextCursor;
  }
  return pages;
}

export async function createLinkToken(api: PlaidApi, userId: string, opts: { accessToken?: string; clientName: string }): Promise<{ linkToken: string; requestId: string }> {
  const { data, requestId } = await plaidCall("link/token/create", () =>
    api.linkTokenCreate({
      client_name: opts.clientName,
      language: "en",
      country_codes: [CountryCode.Us],
      user: { client_user_id: userId },
      ...(opts.accessToken
        ? { access_token: opts.accessToken }
        : { products: [Products.Transactions], transactions: { days_requested: 730 } }),
    }),
  );
  return { linkToken: data.link_token, requestId };
}

export async function exchangePublicToken(api: PlaidApi, publicToken: string): Promise<{ accessToken: string; itemId: string; requestId: string }> {
  const { data, requestId } = await plaidCall("item/public_token/exchange", () => api.itemPublicTokenExchange({ public_token: publicToken }));
  return { accessToken: data.access_token, itemId: data.item_id, requestId };
}

export async function removeItem(api: PlaidApi, accessToken: string): Promise<{ requestId: string }> {
  const { requestId } = await plaidCall("item/remove", () => api.itemRemove({ access_token: accessToken }));
  return { requestId };
}
