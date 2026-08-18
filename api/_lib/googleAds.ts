// ============================================================================
// LUXEDGE V2 — GOOGLE ADS SERVER LIB (Phase 4G.1 — LIVE-PATH CORRECT)
//
// SERVER-SIDE ONLY. This module implements the REAL-CAPABLE Google Ads API
// v25 path:
//
//   1. OAuth refresh — exchanges GOOGLE_ADS_REFRESH_TOKEN for a short-lived
//      access token (cached in memory only until shortly before expiry).
//   2. KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics (official REST):
//        POST https://googleads.googleapis.com/v25/customers/{customerId}/
//            keywordPlanIdeas:generateKeywordHistoricalMetrics
//      geo = geoTargetConstants/2840 (USA)
//      language = languageConstants/1000 (English)
//      network = GOOGLE_SEARCH
//
// Phase 4G.1 performs NO live Google calls (no credentials supplied). The
// whole path is exercised against MOCKED official-shape responses in tests so
// the owner can add credentials later and run ONE controlled proof without an
// architecture rewrite.
//
// SECURITY: secrets stay server-side. We never log/return the access token,
// refresh token, client secret, or developer token; we never persist them to
// the DB or browser. The access token is held in process memory only.
//
// CACHING: identical (normalized keywords + geo + language + calendar month)
// requests are served from an in-memory SERVER INSTANCE CACHE — this is a
// warm-instance cache, NOT a durable monthly cache. Labeled honestly.
// ============================================================================

/** Current official Google Ads API version (Phase 4G.1 §H). */
export const GOOGLE_ADS_API_VERSION = 'v25';

const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Official geo target constant for USA (verified v25 docs). */
export const GOOGLE_ADS_GEO_USA = 'geoTargetConstants/2840';
/** Official language constant for English (verified v25 docs). */
export const GOOGLE_ADS_LANG_ENGLISH = 'languageConstants/1000';
/** Official KeywordPlanNetwork for search-volume metrics. */
export const GOOGLE_ADS_NETWORK = 'GOOGLE_SEARCH';

export const GOOGLE_ADS_ENV_NAMES = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
] as const;

const REQUIRED_ENV: readonly string[] = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
];

function env(name: string): string | undefined {
  try {
    return typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  } catch {
    return undefined;
  }
}

/** Presence snapshot — never values. */
export function googleAdsEnvStatus(): { configured: boolean; missing: string[] } {
  const missing = REQUIRED_ENV.filter((n) => !env(n));
  return { configured: missing.length === 0, missing };
}

/** True when the minimum credential set is present (presence only — never values). */
export function googleAdsConfiguredServer(): boolean {
  return googleAdsEnvStatus().configured;
}

/**
 * Customer IDs must be normalized without hyphens (official API expects a
 * plain numeric string). Returns null for anything non-numeric.
 */
export function normalizeGoogleAdsCustomerId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits || digits.length < 10) return null;
  return digits;
}

// ---------------------------------------------------------------------------
// OAuth refresh (runtime only; scope/refresh-token creation is owner setup)
// ---------------------------------------------------------------------------

interface AccessTokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

let accessTokenCache: AccessTokenCacheEntry | null = null;

/** Clear the in-memory OAuth token cache (tests / forced refresh). */
export function clearGoogleAdsTokenCache(): void {
  accessTokenCache = null;
}

/** Safe (scrubbed) error message. */
export function googleAdsSafeError(e: unknown): string {
  const msg = String((e instanceof Error ? e.message : e) || 'unknown error');
  return msg
    .replace(/(GOOGLE_ADS_[A-Z_]+|Bearer [A-Za-z0-9._-]+|Authorization[^\s,;]{0,80}|refresh_token[^\s,;]{0,80})/gi, '***')
    .slice(0, 300);
}

/**
 * Exchange the stored refresh token for a short-lived access token.
 *
 * The result is cached in process memory only until shortly before expiry
 * (60s safety margin). Never returned to the browser; never logged.
 */
export async function refreshGoogleAdsAccessToken(
  opts: { fetchImpl?: typeof fetch; nowMs?: () => number } = {}
): Promise<string> {
  const nowMs = opts.nowMs ?? Date.now;
  const cached = accessTokenCache;
  if (cached && cached.expiresAtMs - 60_000 > nowMs()) return cached.token;

  const clientId = env('GOOGLE_ADS_CLIENT_ID');
  const clientSecret = env('GOOGLE_ADS_CLIENT_SECRET');
  const refreshToken = env('GOOGLE_ADS_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new GoogleAdsRequestError('OAUTH_NOT_CONFIGURED', 'Google Ads OAuth credentials are not fully configured on the server', null);
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GoogleAdsRequestError('OAUTH_NETWORK', `Google OAuth endpoint unreachable: ${googleAdsSafeError(e)}`, null);
  }
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new GoogleAdsRequestError(
      'OAUTH_REFRESH_FAILED',
      `Google OAuth refresh failed (HTTP ${res.status})${body?.error ? `: ${body.error}` : ''} — check GOOGLE_ADS_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN`,
      null
    );
  }
  const expiresIn = Number(body.expires_in ?? 3600);
  const entry: AccessTokenCacheEntry = { token: body.access_token, expiresAtMs: nowMs() + expiresIn * 1000 };
  accessTokenCache = entry;
  return entry.token;
}

// ---------------------------------------------------------------------------
// Official v25 historical-metrics request + response parsing
// ---------------------------------------------------------------------------

/** One MonthlySearchVolume (official shape: year + MonthOfYear enum + monthlySearches). */
export interface GoogleMonthlySearchVolume {
  year: number | null;
  /** MonthOfYear enum name, e.g. 'AUGUST' — NOT a YYYY-MM string. */
  month: string | null;
  /** Null = unknown (Google did not return it). Zero only when Google returned zero. */
  monthlySearches: number | null;
}

/** KeywordPlanHistoricalMetrics — official result keywordMetrics object. */
export interface GoogleKeywordMetrics {
  avgMonthlySearches: number | null;
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  competitionIndex: number | null;
  lowTopOfPageBidUsd: number | null;
  highTopOfPageBidUsd: number | null;
  monthlySearchVolumes: GoogleMonthlySearchVolume[];
}

/** One GenerateKeywordHistoricalMetricsResult row. */
export interface GoogleHistoricalMetricsResult {
  text: string;
  closeVariants: string[];
  keywordMetrics: GoogleKeywordMetrics;
}

/** Structured server outcome — the source of truth for the client. */
export interface GoogleHistoricalMetricsOutcome {
  status: 'success' | 'error';
  /** Requested (normalized, ≤5) keywords — actual request count. */
  requestedKeywords: string[];
  /** Actual Google results (close-variant dedupe may make this < requested). */
  results: GoogleHistoricalMetricsResult[];
  errorCode: string | null;
  errorSafe: string | null;
  /** Google request-id when returned (debug aid; never auth headers). */
  requestId: string | null;
  /** True when served from the server instance cache. */
  cacheHit: boolean;
}

/** Classified Google Ads API error (safe message only). */
export class GoogleAdsRequestError extends Error {
  readonly errorCode: string;
  readonly errorSafe: string;
  readonly requestId: string | null;
  constructor(errorCode: string, errorSafe: string, requestId: string | null) {
    super(errorSafe);
    this.name = 'GoogleAdsRequestError';
    this.errorCode = errorCode;
    this.errorSafe = errorSafe;
    this.requestId = requestId;
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const COMPETITION_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
function competitionOf(v: unknown): 'LOW' | 'MEDIUM' | 'HIGH' | null {
  const s = String(v ?? '').toUpperCase();
  return (COMPETITION_LEVELS as readonly string[]).includes(s) ? (s as 'LOW' | 'MEDIUM' | 'HIGH') : null;
}

function microsToUsd(v: unknown): number | null {
  const m = num(v);
  return m !== null ? m / 1_000_000 : null;
}

/**
 * Parse ONE official GenerateKeywordHistoricalMetricsResult row.
 * Primary contract (v25 REST): { text, closeVariants, keywordMetrics }.
 * Compatibility shapes (keyword ideas / snake_case) are accepted SECONDARY.
 */
export function parseGoogleHistoricalMetricsResult(raw: Record<string, unknown>): GoogleHistoricalMetricsResult {
  const kw = (raw.keyword_metrics ?? raw.keywordMetrics ?? raw.keyword_historical_metrics ?? raw.keywordHistoricalMetrics ?? {}) as Record<string, unknown>;
  const closeRaw = Array.isArray(raw.closeVariants) ? raw.closeVariants : Array.isArray(raw.close_variants) ? raw.close_variants : [];
  const monthlyRaw = Array.isArray(kw.monthly_search_volumes) ? kw.monthly_search_volumes : Array.isArray(kw.monthlySearchVolumes) ? kw.monthlySearchVolumes : [];
  const monthlySearchVolumes: GoogleMonthlySearchVolume[] = monthlyRaw
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        year: num(r.year),
        month: r.month ? String(r.month) : null,
        monthlySearches: num(r.monthly_searches ?? r.monthlySearches),
      };
    })
    .filter((m) => m.year !== null || m.month !== null);
  return {
    text: String(raw.text ?? raw.keyword ?? raw.keywordText ?? ''),
    closeVariants: closeRaw.map(String),
    keywordMetrics: {
      avgMonthlySearches: num(kw.avg_monthly_searches ?? kw.avgMonthlySearches),
      competition: competitionOf(kw.competition),
      competitionIndex: num(kw.competition_index ?? kw.competitionIndex),
      lowTopOfPageBidUsd: microsToUsd(kw.low_top_of_page_bid_micros ?? kw.lowTopOfPageBidMicros),
      highTopOfPageBidUsd: microsToUsd(kw.high_top_of_page_bid_micros ?? kw.highTopOfPageBidMicros),
      monthlySearchVolumes,
    },
  };
}

/** Normalized cache key: sorted keywords + geo + language + calendar month. */
export function googleAdsServerCacheKey(keywords: string[], geo: string, language: string): string {
  const norm = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].sort().join('|');
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${geo}:${language}:${month}:${norm}`;
}

/** Warm-instance in-memory cache — SERVER INSTANCE CACHE, not durable. */
const serverInstanceCache = new Map<string, { results: GoogleHistoricalMetricsResult[]; requestId: string | null }>();

/** Clear the server instance cache (tests / forced fresh call). */
export function clearGoogleAdsServerCache(): void {
  serverInstanceCache.clear();
}

/**
 * Official v25 GenerateKeywordHistoricalMetrics call.
 *
 * - Customer ID normalized without hyphens.
 * - Headers: Authorization Bearer <access token>, developer-token, and
 *   login-customer-id ONLY when GOOGLE_ADS_LOGIN_CUSTOMER_ID is configured.
 * - Geo USA / language English / GOOGLE_SEARCH (verified v25 docs).
 *
 * Throws GoogleAdsRequestError with a classified errorCode on failure.
 */
export async function generateKeywordHistoricalMetrics(
  keywords: string[],
  opts: { fetchImpl?: typeof fetch; nowMs?: () => number; forceFresh?: boolean } = {}
): Promise<GoogleHistoricalMetricsOutcome> {
  const normalized = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  if (normalized.length === 0) {
    return { status: 'error', requestedKeywords: [], results: [], errorCode: 'EMPTY_KEYWORDS', errorSafe: 'At least one keyword is required.', requestId: null, cacheHit: false };
  }
  const status = googleAdsEnvStatus();
  if (!status.configured) {
    return {
      status: 'error', requestedKeywords: normalized, results: [],
      errorCode: 'NOT_CONFIGURED', errorSafe: 'Google Ads credentials are not configured on the server.',
      requestId: null, cacheHit: false,
    };
  }

  const geo = GOOGLE_ADS_GEO_USA;
  const language = GOOGLE_ADS_LANG_ENGLISH;
  const cacheKey = googleAdsServerCacheKey(normalized, 'US', 'en');
  if (!opts.forceFresh) {
    const cached = serverInstanceCache.get(cacheKey);
    if (cached) {
      return { status: 'success', requestedKeywords: normalized, results: cached.results, errorCode: null, errorSafe: null, requestId: cached.requestId, cacheHit: true };
    }
  }

  const customerIdRaw = env('GOOGLE_ADS_CUSTOMER_ID');
  const customerId = normalizeGoogleAdsCustomerId(customerIdRaw);
  if (!customerId) {
    return { status: 'error', requestedKeywords: normalized, results: [], errorCode: 'INVALID_CUSTOMER_ID', errorSafe: 'GOOGLE_ADS_CUSTOMER_ID is missing or not a valid numeric customer id.', requestId: null, cacheHit: false };
  }

  let accessToken: string;
  try {
    accessToken = await refreshGoogleAdsAccessToken(opts);
  } catch (e) {
    const err = e as GoogleAdsRequestError;
    return { status: 'error', requestedKeywords: normalized, results: [], errorCode: err.errorCode, errorSafe: err.errorSafe, requestId: err.requestId, cacheHit: false };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '',
  };
  const loginCustomerId = normalizeGoogleAdsCustomerId(env('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const url = `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/keywordPlanIdeas:generateKeywordHistoricalMetrics`;
  const payload = {
    customer_id: customerId,
    keywords: normalized,
    geo_target_constants: [geo],
    keyword_plan_network: GOOGLE_ADS_NETWORK,
    language,
  };

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { status: 'error', requestedKeywords: normalized, results: [], errorCode: 'GOOGLE_NETWORK', errorSafe: `Google Ads API unreachable: ${googleAdsSafeError(e)}`, requestId: null, cacheHit: false };
  }

  const requestId = res.headers.get('request-id');
  const body = (await res.json().catch(() => null)) as { results?: unknown[] } | null;
  if (!res.ok) {
    return {
      status: 'error', requestedKeywords: normalized, results: [],
      ...classifyGoogleAdsError(res.status, body, requestId),
      cacheHit: false,
    };
  }
  const results = (Array.isArray(body?.results) ? body.results : [])
    .map((r) => parseGoogleHistoricalMetricsResult((r ?? {}) as Record<string, unknown>))
    .filter((r) => r.text);
  serverInstanceCache.set(cacheKey, { results, requestId });
  return { status: 'success', requestedKeywords: normalized, results, errorCode: null, errorSafe: null, requestId, cacheHit: false };
}

/**
 * Classify a Google Ads API error into a safe { errorCode, errorSafe }.
 * Never returns the raw body verbatim — it may contain sensitive request
 * context. requestId is preserved for debugging.
 */
export function classifyGoogleAdsError(status: number, body: unknown, requestId: string | null): { errorCode: string; errorSafe: string; requestId: string | null } {
  const err = (body as { error?: { message?: string; status?: string; code?: number } } | null)?.error;
  const message = err?.message ?? `Google Ads API error (HTTP ${status})`;
  const safe = googleAdsSafeError(message);

  if (status === 429) return { errorCode: 'RATE_LIMITED', errorSafe: `Google Ads quota/rate limit: ${safe}`, requestId };
  if (status === 401) return { errorCode: 'AUTH_FAILED', errorSafe: `Google Ads authorization failed: ${safe}`, requestId };
  if (status === 403) {
    const lc = safe.toLowerCase();
    if (lc.includes('customer_not_enabled') || lc.includes('not enabled')) return { errorCode: 'CUSTOMER_NOT_ENABLED', errorSafe: safe, requestId };
    if (lc.includes('invalid_customer_id') || lc.includes('invalid customer')) return { errorCode: 'INVALID_CUSTOMER_ID', errorSafe: safe, requestId };
    if (lc.includes('developer_token') || lc.includes('developer token')) return { errorCode: 'DEVELOPER_TOKEN', errorSafe: safe, requestId };
    return { errorCode: 'PERMISSION_DENIED', errorSafe: safe, requestId };
  }
  if (status === 400) return { errorCode: 'VALIDATION', errorSafe: safe, requestId };
  if (status >= 500) return { errorCode: 'GOOGLE_SERVER_ERROR', errorSafe: safe, requestId };
  return { errorCode: 'GOOGLE_ADS_API_ERROR', errorSafe: safe, requestId };
}
