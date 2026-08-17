// ============================================================================
// LUXEDGE V2 — SERVER-SIDE CJ DROPSHIPPING CLIENT (Phase 4C)
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
// ============================================================================

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // access token ~15 days (safe margin)
const FETCH_TIMEOUT_MS = 15_000;

// Endpoint-aware retry caps (Phase 4C hardening): auth/network-transient
// endpoints may retry more; PAID data endpoints (listV2/query/freight) are
// tightly capped so a run never pays 3× for one result. Hard 4xx, validation
// and auth-configuration errors are NEVER retried.
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

/** CJ API Key configured on the server? */
export function cjConfigured(): boolean {
  return !!(process.env.CJ_API_KEY || '').trim();
}

/**
 * Fetch with endpoint-aware retry policy.
 *   paid:true → paid data endpoint: 5xx retried at most once; 429 respects
 *              backoff but is capped so the run budget is not burned.
 *   paid:false → auth/network-transient: slightly more headroom.
 * Hard 4xx (400/401/403/404/422) and missing config are never retried.
 */
async function cjFetch(path: string, init: RequestInit = {}, opts: { paid?: boolean } = {}): Promise<Response> {
  const url = `${CJ_API_BASE}${path}`;
  const retries = opts.paid ? MAX_RETRIES_PAID : MAX_RETRIES_AUTH;
  let lastErr: Error | null = null;
  let lastRetryReason = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
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
  const key = (process.env.CJ_API_KEY || '').trim();
  if (!key) throw new Error('CJ_API_KEY not configured on the server');
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

async function cjGet(path: string, paid = true): Promise<unknown> {
  const token = await cjAccessToken();
  const res = await cjFetch(path, {
    headers: { 'CJ-Access-Token': token },
  }, { paid });
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
export async function cjSearchProducts(p: CjSearchParams): Promise<{ products: unknown[]; total: number }> {
  const params = new URLSearchParams();
  if (p.keyWord) params.set('keyWord', p.keyWord);
  params.set('page', String(p.page ?? 1));
  params.set('size', String(p.size ?? 20));
  if (p.countryCode) params.set('countryCode', p.countryCode);
  if (p.startSellPrice !== undefined) params.set('startSellPrice', String(p.startSellPrice));
  if (p.endSellPrice !== undefined) params.set('endSellPrice', String(p.endSellPrice));
  if (p.verifiedWarehouse !== undefined) params.set('verifiedWarehouse', String(p.verifiedWarehouse));
  params.set('features', 'enable_category,enable_description');
  const body = (await cjGet(`/product/listV2?${params.toString()}`, true)) as {
    data?: { content?: { productList?: unknown[] }[]; totalRecords?: number };
  };
  const content = body?.data?.content?.[0];
  const products = Array.isArray(content?.productList) ? content.productList : [];
  return { products, total: body?.data?.totalRecords ?? products.length };
}

/** CJ product/query — details, variants, per-country inventory. */
export async function cjProductQuery(pid: string, countryCode?: string): Promise<unknown> {
  const params = new URLSearchParams({ pid });
  if (countryCode) params.set('countryCode', countryCode);
  params.set('features', 'enable_video');
  const body = (await cjGet(`/product/query?${params.toString()}`, true)) as { data?: unknown };
  return body?.data;
}

/** CJ globalWarehouseList — warehouse country evidence. */
export async function cjGlobalWarehouses(): Promise<unknown[]> {
  const body = (await cjGet('/product/globalWarehouseList', false)) as { data?: unknown[] };
  return Array.isArray(body?.data) ? body.data : [];
}

/** CJ logistic/freightCalculate — real USA freight (cost + arrival days). */
export async function cjFreightCalculate(opts: {
  startCountryCode: string;
  endCountryCode: string;
  vid: string;
  quantity?: number;
}): Promise<unknown[]> {
  const token = await cjAccessToken();
  const res = await cjFetch('/logistic/freightCalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
    body: JSON.stringify({
      startCountryCode: opts.startCountryCode,
      endCountryCode: opts.endCountryCode,
      products: [{ vid: opts.vid, quantity: opts.quantity ?? 1 }],
    }),
  }, { paid: true });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('CJ freight calculation failed');
  return Array.isArray(body?.data) ? body.data : [];
}
