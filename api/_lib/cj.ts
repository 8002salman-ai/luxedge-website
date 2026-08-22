// ============================================================================
// LUXEDGE V2 — SERVER-SIDE CJ DROPSHIPPING CLIENT (Phase 4C + final pre-key)
//
// Runs ONLY inside /api serverless functions — never in the browser.
// The CJ API Key is read from the environment (CJ_API_KEY); the access and
// refresh tokens are held server-side and refreshed server-side. No CJ
// credential is ever logged, echoed in errors, or returned to the client.
//
// Official CJ API V2 endpoints (developers.cjdropshipping.cn):
//   POST /api2.0/v1/authentication/getAccessToken      {apiKey}
//   POST /api2.0/v1/authentication/refreshAccessToken  {refreshToken}
//   GET  /api2.0/v1/product/listV2   (keyword/country/price filters)
//   GET  /api2.0/v1/product/query    (details + variants + inventory)
//   GET  /api2.0/v1/product/globalWarehouseList
//   POST /api2.0/v1/logistic/freightCalculate  {startCountryCode,endCountryCode,products:[{vid,quantity}]}
//
// AUTHORITATIVE POINT BUDGET (Phase 4C final pre-key audit → live-readiness):
//   The authoritative hard cap is a DURABLE ledger in Supabase
//   (supplier_api_runs + reserve_supplier_api_points — migration 0008), NOT
//   process memory. The server reserves the endpoint point cost BEFORE every
//   actual paid outbound request — including every paid retry — via the
//   atomic RPC. If remaining budget is insufficient the HTTP request is NOT
//   issued and CJ_POINT_BUDGET_EXHAUSTED is returned. The ledger is
//   cross-instance, cold-start and concurrency safe. CjServerRunBudget below
//   remains only as a local forecast/fallback; it is never the authority.
// ============================================================================

import { CJ_POINT_COST, CJ_POINTS_HARD_MAX, type CjPointAction } from '../../src/features/suppliers/cj/points.js';

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // access token ~15 days (safe margin)
const FETCH_TIMEOUT_MS = 15_000;

/** Returned when a paid call cannot be afforded — NO HTTP request was made. */
export const CJ_POINT_BUDGET_EXHAUSTED = 'CJ_POINT_BUDGET_EXHAUSTED';

/**
 * Returned when the DURABLE supplier run ledger cannot be created/read/
 * reserved (unconfigured env, DB unreachable, permission denied, or no run id
 * provided). The run FAILS CLOSED: NO paid CJ HTTP request may be issued when
 * the durable ledger is unavailable. The client-side budget forecast can
 * never authorize a live paid request.
 */
export const CJ_DURABLE_LEDGER_UNAVAILABLE = 'CJ_DURABLE_LEDGER_UNAVAILABLE';

function ledgerUnavailable(detail: string): Error {
  return new Error(`${CJ_DURABLE_LEDGER_UNAVAILABLE}: ${detail}`);
}

// Endpoint-aware retry caps (Phase 4C hardening): auth/network-transient
// endpoints may retry more; PAID data endpoints (listV2/query/freight) are
// tightly capped so a run never pays 3× for one result. Hard 4xx, validation
// and auth-configuration errors are NEVER retried. Paid retries reserve their
// own points (durable ledger).
const MAX_RETRIES_AUTH = 2;   // getAccessToken / refreshAccessToken
const MAX_RETRIES_PAID = 1;   // product/listV2, product/query, freightCalculate

interface CjTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiryMs: number;
}

// In-memory token cache (per warm serverless instance — honest limitation:
// serverless instances are ephemeral, so this is a best-effort cache).
let tokenCache: CjTokenBundle | null = null;

// ---------------------------------------------------------------------------
// Run-scoped authoritative point budget (server side)
// ---------------------------------------------------------------------------

export interface CjServerPointUsage {
  /** Hard-clamped run budget (max CJ_POINTS_HARD_MAX). */
  budget: number;
  /** Points reserved for actual outbound paid requests (incl. retries). */
  reserved: number;
  remaining: number;
  listAttempts: number;
  detailAttempts: number;
  freightAttempts: number;
  paidRetries: number;
  denied: number;
}

/**
 * A run context for paid CJ calls. `reserve` is called BEFORE every actual
 * outbound paid request (initial attempt AND every paid retry); when it
 * returns false the HTTP request MUST NOT be issued. Implementations:
 *   - CjServerRunBudget  — local forecast/fallback (NOT authoritative).
 *   - CjDurableRunContext — durable Supabase ledger (authoritative).
 */
export interface CjRunContext {
  readonly runId: string;
  readonly budget: number;
  reserve(action: CjPointAction, isRetry?: boolean): boolean | Promise<boolean>;
  /** Record an attempt counter (durable ledger already counts atomically). */
  markAttempt(action: CjPointAction): void;
  usage(): CjServerPointUsage | null;
}

/**
 * Local per-run budget forecast. The DURABLE ledger is the authority (migration
 * 0008); this class mirrors the same clamping rules for UX/fallback and is
 * never trusted across instances. The requested budget is clamped to
 * [listV2 cost, CJ_POINTS_HARD_MAX] — callers/AI cannot raise it.
 */
export class CjServerRunBudget implements CjRunContext {
  readonly runId = '';
  readonly budget: number;
  reserved = 0;
  listAttempts = 0;
  detailAttempts = 0;
  freightAttempts = 0;
  paidRetries = 0;
  denied = 0;

  constructor(requestedBudget: number) {
    const req = Number.isFinite(requestedBudget) ? Math.floor(requestedBudget) : CJ_POINTS_HARD_MAX;
    this.budget = Math.min(Math.max(req, CJ_POINT_COST.listV2), CJ_POINTS_HARD_MAX);
  }

  /** Reserve before an actual outbound request. Returns false → do NOT call. */
  reserve(action: CjPointAction, isRetry = false): boolean {
    const cost = CJ_POINT_COST[action];
    if (this.reserved + cost > this.budget) {
      this.denied++;
      return false;
    }
    this.reserved += cost;
    if (isRetry) this.paidRetries++;
    return true;
  }

  markAttempt(action: CjPointAction): void {
    if (action === 'listV2') this.listAttempts++;
    else if (action === 'productQuery') this.detailAttempts++;
    else this.freightAttempts++;
  }

  usage(): CjServerPointUsage {
    return {
      budget: this.budget,
      reserved: this.reserved,
      remaining: this.budget - this.reserved,
      listAttempts: this.listAttempts,
      detailAttempts: this.detailAttempts,
      freightAttempts: this.freightAttempts,
      paidRetries: this.paidRetries,
      denied: this.denied,
    };
  }
}

// ---------------------------------------------------------------------------
// DURABLE LEDGER — Supabase-backed (migration 0008). Cross-instance, atomic,
// cold-start safe. The proxy forwards the ADMIN JWT so the RPC's admin check
// (and RLS) apply; a non-admin caller is rejected by the database itself.
// ---------------------------------------------------------------------------

interface SupplierApiRunRow {
  /** RPC/table PK column is `id`; the start RPC returns it as `run_id`. */
  id?: string;
  run_id?: string;
  provider: string;
  status: string;
  requested_budget: number;
  hard_budget: number;
  reserved_points: number;
  list_attempts: number;
  detail_attempts: number;
  freight_attempts: number;
  paid_retries: number;
  denied_attempts: number;
  [k: string]: unknown;
}

function usageFromRow(r: SupplierApiRunRow): CjServerPointUsage {
  const budget = Number(r.hard_budget ?? 250);
  const reserved = Number(r.reserved_points ?? 0);
  return {
    budget,
    reserved,
    remaining: budget - reserved,
    listAttempts: Number(r.list_attempts ?? 0),
    detailAttempts: Number(r.detail_attempts ?? 0),
    freightAttempts: Number(r.freight_attempts ?? 0),
    paidRetries: Number(r.paid_retries ?? 0),
    denied: Number(r.denied_attempts ?? 0),
  };
}

/**
 * Talks to the durable Supabase ledger (supplier_api_runs +
 * reserve_supplier_api_points) using the admin JWT from the CJ proxy request.
 * The server never holds a service key for this path — the migration's RPC
 * and RLS both verify the admin claim from the forwarded JWT.
 */
export class CjDurableRunLedger {
  constructor(private readonly adminToken: string) {}

  private rest(): { url: string; headers: Record<string, string> } {
    const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    if (!url || !anonKey) {
      throw new Error('CJ point ledger: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not configured on the server');
    }
    if (!this.adminToken) {
      throw new Error('CJ point ledger: no admin session token to authorize the reservation');
    }
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${this.adminToken}`,
        Prefer: 'return=representation',
      },
    };
  }

  private async read(res: Response): Promise<SupplierApiRunRow[]> {
    const rows = (await res.json().catch(() => null)) as SupplierApiRunRow[] | null;
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * POST /rest/v1/rpc/start_supplier_api_run — create the durable run. The
   * DATABASE (not the caller) derives and stores the hard budget
   * (LEAST(GREATEST(requested,50),250)) — the browser can request less than
   * 250 but NEVER more; there is no client "owner" flag that raises the cap.
   */
  async start(provider: string, requestedBudget: number): Promise<{ runId: string; usage: CjServerPointUsage }> {
    const { url, headers } = this.rest();
    const res = await fetch(`${url}/rest/v1/rpc/start_supplier_api_run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_provider: provider, p_requested_budget: requestedBudget }),
      signal: AbortSignal.timeout(10_000),
    });
    const rows = await this.read(res);
    // The start RPC returns the PK as `run_id` (snake_case per the migration's
    // returns table(...)); direct table reads use `id`. Accept both.
    const runId = rows[0]?.run_id ?? rows[0]?.id;
    if (!res.ok || !runId) throw ledgerUnavailable(`start RPC failed (HTTP ${res.status})`);
    return { runId: String(runId), usage: usageFromRow(rows[0]) };
  }

  /**
   * POST /rest/v1/rpc/reserve_supplier_api_points — ATOMIC reservation for
   * one actual paid outbound request (initial or retry). The DATABASE derives
   * the point cost from the action (list=50 / detail=10 / freight=10) — the
   * caller can NEVER supply a custom cost (cost=0/-10/1 cannot bypass the
   * budget). Denied ⇒ the CJ HTTP request must not occur.
   */
  async reserve(runId: string, action: CjPointAction, isRetry: boolean): Promise<{ approved: boolean; usage: CjServerPointUsage | null }> {
    const { url, headers } = this.rest();
    const rpcAction = action === 'listV2' ? 'list' : action === 'productQuery' ? 'detail' : 'freight';
    const res = await fetch(`${url}/rest/v1/rpc/reserve_supplier_api_points`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_run_id: runId,
        p_provider: 'cj',
        p_action: rpcAction,
        p_is_retry: isRetry,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const rows = await this.read(res);
    if (!res.ok) throw ledgerUnavailable(`reserve RPC failed (HTTP ${res.status})`);
    if (!rows[0]) return { approved: false, usage: null };
    return { approved: !!rows[0].approved, usage: usageFromRow(rows[0]) };
  }

  /** Read the current durable usage for a run (no points consumed). */
  async usage(runId: string): Promise<CjServerPointUsage | null> {
    const { url, headers } = this.rest();
    const res = await fetch(`${url}/rest/v1/supplier_api_runs?id=eq.${encodeURIComponent(runId)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const rows = await this.read(res);
    if (!res.ok) throw ledgerUnavailable(`usage read failed (HTTP ${res.status})`);
    return rows[0] ? usageFromRow(rows[0]) : null;
  }

  /**
   * POST /rest/v1/rpc/finish_supplier_api_run — mark the run finished.
   * Only a currently-running row may finish, and only with an allowed final
   * status (completed / failed / exhausted). There is NO direct PATCH path —
   * authenticated clients cannot rewrite a completed run back to running.
   */
  async finish(runId: string, status: 'completed' | 'failed' | 'exhausted'): Promise<void> {
    const { url, headers } = this.rest();
    const res = await fetch(`${url}/rest/v1/rpc/finish_supplier_api_run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_run_id: runId, p_status: status }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw ledgerUnavailable(`finish RPC failed (HTTP ${res.status})`);
  }
}

/**
 * Run context backed by the durable ledger. Each `reserve` hits the atomic
 * RPC; every paid attempt (incl. retries) is durably represented. `markAttempt`
 * is a no-op — the RPC increments the counters atomically with the reservation.
 */
export class CjDurableRunContext implements CjRunContext {
  readonly runId: string;
  readonly budget: number;
  private last: CjServerPointUsage | null = null;

  constructor(private readonly ledger: CjDurableRunLedger, runId: string, hardBudget: number) {
    this.runId = runId;
    this.budget = hardBudget;
  }

  async reserve(action: CjPointAction, isRetry = false): Promise<boolean> {
    const r = await this.ledger.reserve(this.runId, action, isRetry);
    if (r.usage) this.last = r.usage;
    return r.approved;
  }

  markAttempt(): void {
    /* counters are incremented atomically by the RPC */
  }

  usage(): CjServerPointUsage | null {
    return this.last;
  }
}

/** Read CJ API key from env or Supabase app_settings (async, cached 60s). */
let _cachedKey: string | null = null;
let _cacheTs = 0;
const CACHE_TTL = 60_000;

async function readCjKeyFromDb(): Promise<string | null> {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.CJ_API_KEY&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ value: string }>;
    return rows[0]?.value?.trim() || null;
  } catch { return null; }
}

export async function getCjApiKey(): Promise<string> {
  const now = Date.now();
  if (_cachedKey && now - _cacheTs < CACHE_TTL) return _cachedKey;
  const envKey = (process.env.CJ_API_KEY || '').trim();
  if (envKey) { _cachedKey = envKey; _cacheTs = now; return envKey; }
  const dbKey = await readCjKeyFromDb();
  if (dbKey) { _cachedKey = dbKey; _cacheTs = now; return dbKey; }
  return '';
}

/** CJ API Key configured on the server? (sync check — env only) */
export function cjConfigured(): boolean {
  return !!(process.env.CJ_API_KEY || '').trim();
}

/**
 * Fetch with endpoint-aware retry policy.
 *   paid:true → paid data endpoint: 5xx retried at most once; 429 respects
 *              backoff but is capped so the run budget is not burned.
 *   paid:false → auth/network-transient: slightly more headroom.
 * Hard 4xx (400/401/403/404/422) and missing config are never retried.
 *
 * AUTHORITATIVE BUDGET: when `run` is present and the call is paid, the
 * endpoint point cost is RESERVED via the durable ledger BEFORE every outbound
 * request — including every paid retry. If the budget cannot afford the
 * attempt the HTTP request is NOT issued and CJ_POINT_BUDGET_EXHAUSTED is
 * thrown.
 */
async function cjFetch(
  path: string,
  init: RequestInit = {},
  opts: { paid?: boolean; run?: CjRunContext; action?: CjPointAction } = {}
): Promise<Response> {
  const url = `${CJ_API_BASE}${path}`;
  const retries = opts.paid ? MAX_RETRIES_PAID : MAX_RETRIES_AUTH;
  let lastErr: Error | null = null;
  let lastRetryReason = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Reserve BEFORE the outbound request (initial attempt AND paid retries).
    if (opts.paid && opts.run && opts.action) {
      const ok = await opts.run.reserve(opts.action, attempt > 0);
      if (!ok) throw new Error(CJ_POINT_BUDGET_EXHAUSTED);
    }
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // Hard 4xx (validation / auth config / not found) — never retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`CJ API error ${res.status}`);
      }
      if (res.status === 429) {
        // Respect rate limiting with backoff, but stay capped.
        lastErr = new Error('CJ rate limited (429)');
        lastRetryReason = 'rate-limited';
        if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`CJ server error ${res.status}`);
        lastRetryReason = 'server-5xx';
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e as Error;
      // Budget exhaustion — never retried, surface immediately.
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) break;
      // Hard 4xx (thrown inside try) — never retried, stop immediately.
      if (e instanceof Error && /^CJ API error [45]/.test(e.message)) break;
      // Network/transient — retry only within the endpoint cap.
      if (attempt < retries) {
        lastRetryReason = 'network-transient';
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      } else {
        break;
      }
    }
  }
  const err = lastErr || new Error('CJ request failed');
  throw Object.assign(err, { retryReason: lastRetryReason } as { retryReason: string });
}

async function rawAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
  const key = await getCjApiKey();
  if (!key) throw new Error('CJ_API_KEY not configured on the server — add it in Admin → CJ Supplier Setup');
  const res = await cjFetch('/authentication/getAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key }),
  }, { paid: false });
  const body = await res.json().catch(() => null);
  const data = body && body.data;
  if (!res.ok || !data || !data.accessToken) {
    throw new Error(`CJ authentication failed (${res.status})`);
  }
  return { accessToken: String(data.accessToken), refreshToken: String(data.refreshToken || '') };
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await cjFetch('/authentication/refreshAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }, { paid: false });
  const body = await res.json().catch(() => null);
  const data = body && body.data;
  if (!res.ok || !data || !data.accessToken) {
    throw new Error(`CJ token refresh failed (${res.status})`);
  }
  return {
    accessToken: String(data.accessToken),
    refreshToken: String(data.refreshToken || refreshToken),
  };
}

/** Get a valid CJ access token, refreshing server-side when expired. */
export async function cjAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiryMs > Date.now()) return tokenCache.accessToken;
  // Prefer the refresh token when we have one (avoids full re-auth);
  // fall back to a fresh API-key authentication if refresh fails.
  if (tokenCache?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(tokenCache.refreshToken);
      tokenCache = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiryMs: Date.now() + TOKEN_TTL_MS,
      };
      return refreshed.accessToken;
    } catch {
      // fall through to full authentication
    }
  }
  const fresh = await rawAccessToken();
  tokenCache = {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    expiryMs: Date.now() + TOKEN_TTL_MS,
  };
  return fresh.accessToken;
}

async function cjGet(path: string, opts: { paid?: boolean; run?: CjRunContext; action?: CjPointAction } = {}): Promise<unknown> {
  const token = await cjAccessToken();
  const res = await cjFetch(path, {
    headers: { 'CJ-Access-Token': token },
  }, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body && body.message ? String(body.message) : `CJ API error ${res.status}`;
    if (res.status === 429) throw new Error('CJ rate limited (429)');
    throw new Error(`CJ API error: ${msg}`);
  }
  return body;
}

/** Sanitize an error for the client — never includes keys or tokens. */
export function cjSafeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Scrub anything that looks like a token/key (never leak secrets).
  return msg.replace(/CJ-Access-Token[:\s]*[\w-]+/gi, 'CJ-Access-Token:***')
    .replace(/(apiKey|token|secret)[":\s]*[A-Za-z0-9@._-]{12,}/gi, '$1:***')
    .slice(0, 300);
}

export interface CjSearchParams {
  keyWord: string;
  page?: number;
  size?: number;
  countryCode?: string;
  startSellPrice?: number;
  endSellPrice?: number;
  verifiedWarehouse?: number; // 1 = verified inventory
}

/** CJ product/listV2 — the official keyword search with filters. */
export async function cjSearchProducts(p: CjSearchParams, run?: CjRunContext): Promise<{ products: unknown[]; total: number }> {
  const params = new URLSearchParams();
  if (p.keyWord) params.set('keyWord', p.keyWord);
  params.set('page', String(p.page ?? 1));
  params.set('size', String(p.size ?? 20));
  if (p.countryCode) params.set('countryCode', p.countryCode);
  if (p.startSellPrice !== undefined) params.set('startSellPrice', String(p.startSellPrice));
  if (p.endSellPrice !== undefined) params.set('endSellPrice', String(p.endSellPrice));
  if (p.verifiedWarehouse !== undefined) params.set('verifiedWarehouse', String(p.verifiedWarehouse));
  params.set('features', 'enable_category,enable_description');
  run?.markAttempt('listV2');
  const body = (await cjGet(`/product/listV2?${params.toString()}`, { paid: true, run, action: 'listV2' })) as {
    data?: { content?: { productList?: unknown[] }[]; totalRecords?: number };
  };
  const content = body?.data?.content?.[0];
  const products = Array.isArray(content?.productList) ? content.productList : [];
  return { products, total: body?.data?.totalRecords ?? products.length };
}

/** CJ product/query — details, variants, per-country inventory. */
export async function cjProductQuery(pid: string, countryCode?: string, run?: CjRunContext): Promise<unknown> {
  const params = new URLSearchParams({ pid });
  if (countryCode) params.set('countryCode', countryCode);
  params.set('features', 'enable_video');
  run?.markAttempt('productQuery');
  const body = (await cjGet(`/product/query?${params.toString()}`, { paid: true, run, action: 'productQuery' })) as { data?: unknown };
  return body?.data;
}

/** CJ globalWarehouseList — warehouse country evidence. */
export async function cjGlobalWarehouses(): Promise<unknown[]> {
  const body = (await cjGet('/product/globalWarehouseList', { paid: false })) as { data?: unknown[] };
  return Array.isArray(body?.data) ? body.data : [];
}

/** CJ logistic/freightCalculate — real USA freight (cost + arrival days). */
export async function cjFreightCalculate(opts: {
  startCountryCode: string;
  endCountryCode: string;
  vid: string;
  quantity?: number;
}, run?: CjRunContext): Promise<unknown[]> {
  const token = await cjAccessToken();
  run?.markAttempt('freightCalculate');
  const res = await cjFetch('/logistic/freightCalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
    body: JSON.stringify({
      startCountryCode: opts.startCountryCode,
      endCountryCode: opts.endCountryCode,
      products: [{ vid: opts.vid, quantity: opts.quantity ?? 1 }],
    }),
  }, { paid: true, run, action: 'freightCalculate' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('CJ freight calculation failed');
  return Array.isArray(body?.data) ? body.data : [];
}
