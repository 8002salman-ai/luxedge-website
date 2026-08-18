// ============================================================================
// LUXEDGE V2 — PHASE 4G.1 SERVER LIB TESTS: GOOGLE ADS LIVE-PATH CORRECTNESS
//
// MOCKED official Google Ads API v25 responses ONLY — NO live Google calls.
//
// A) official GenerateKeywordHistoricalMetrics result parses correctly
// B) avgMonthlySearches string/int64 parses correctly
// C) monthlySearchVolumes {year, month, monthlySearches} parses correctly
// D) low/high bid micros convert to USD correctly
// E) close variants retained
// H) GOOGLE_ADS_CLIENT_SECRET is part of REQUIRED server config
// K) configured mocked server: OAuth refresh called, then ONE v25 request
// L) manager mode: login-customer-id included when configured
// M) direct-client mode: login-customer-id omitted when absent
// N) customer IDs have hyphens stripped before request
// O) USA: geoTargetConstants/2840
// P) English: languageConstants/1000
// Q) network: GOOGLE_SEARCH
// U) Google failure: status error, safe code/message, no token leakage
// V) API version constant = v25
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GOOGLE_ADS_API_VERSION,
  parseGoogleHistoricalMetricsResult,
  generateKeywordHistoricalMetrics,
  normalizeGoogleAdsCustomerId,
  googleAdsEnvStatus,
  googleAdsServerCacheKey,
  clearGoogleAdsServerCache,
  clearGoogleAdsTokenCache,
  classifyGoogleAdsError,
  type GoogleHistoricalMetricsResult,
} from '../googleAds.js';

// ---------------------------------------------------------------------------
// Env helpers (no real credentials — fixture values only)
// ---------------------------------------------------------------------------

const FIXTURE_ENV: Record<string, string | undefined> = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-fixture',
  GOOGLE_ADS_CLIENT_ID: 'client-id-fixture.apps.googleusercontent.com',
  GOOGLE_ADS_CLIENT_SECRET: 'client-secret-fixture',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token-fixture',
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined,
};

let savedEnv: Record<string, string | undefined> = {};

function setFixtureEnv(over: Record<string, string | undefined> = {}): void {
  for (const k of Object.keys(FIXTURE_ENV)) delete process.env[k];
  process.env = { ...process.env, ...FIXTURE_ENV, ...over };
}

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const k of Object.keys(FIXTURE_ENV)) delete process.env[k];
  setFixtureEnv();
  clearGoogleAdsServerCache();
  clearGoogleAdsTokenCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  clearGoogleAdsServerCache();
  clearGoogleAdsTokenCache();
});

/** Official-shape v25 result row (snake_case + camelCase both accepted). */
const OFFICIAL_RESULT = {
  text: 'dog travel accessories',
  closeVariants: ['dog travel gear', 'dog travel supplies'],
  keywordMetrics: {
    avgMonthlySearches: '5400',
    competition: 'HIGH',
    competitionIndex: 84,
    lowTopOfPageBidMicros: 1500000,
    highTopOfPageBidMicros: 4200000,
    monthlySearchVolumes: [
      { year: 2026, month: 'AUGUST', monthlySearches: 5600 },
      { year: 2026, month: 'JULY', monthlySearches: 5100 },
    ],
  },
};

function mockFetchChain(
  handlers: ((url: string, init?: RequestInit) => { status: number; json: unknown; headers?: Record<string, string> })[]
): { fetchImpl: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    const out = handler(url, init);
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: new Headers(out.headers ?? {}),
      json: async () => out.json,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('Phase 4G.1 — official v25 response parser (server)', () => {
  it('A+E) official result {text, closeVariants, keywordMetrics} parses; close variants retained', () => {
    const r = parseGoogleHistoricalMetricsResult(OFFICIAL_RESULT);
    expect(r.text).toBe('dog travel accessories');
    expect(r.closeVariants).toEqual(['dog travel gear', 'dog travel supplies']);
    expect(r.keywordMetrics.competition).toBe('HIGH');
  });

  it('B) avgMonthlySearches int64 string parses correctly', () => {
    const r = parseGoogleHistoricalMetricsResult(OFFICIAL_RESULT);
    expect(r.keywordMetrics.avgMonthlySearches).toBe(5400);
  });

  it('C) monthlySearchVolumes {year, month, monthlySearches} preserved (month is enum, not YYYY-MM)', () => {
    const r = parseGoogleHistoricalMetricsResult(OFFICIAL_RESULT);
    expect(r.keywordMetrics.monthlySearchVolumes).toEqual([
      { year: 2026, month: 'AUGUST', monthlySearches: 5600 },
      { year: 2026, month: 'JULY', monthlySearches: 5100 },
    ]);
    // Month is the MonthOfYear enum name — NOT a pre-formatted YYYY-MM string.
    expect(r.keywordMetrics.monthlySearchVolumes[0].month).not.toMatch(/^\d{4}-\d{2}$/);
  });

  it('D) bid micros convert to USD correctly', () => {
    const r = parseGoogleHistoricalMetricsResult(OFFICIAL_RESULT);
    expect(r.keywordMetrics.lowTopOfPageBidUsd).toBeCloseTo(1.5);
    expect(r.keywordMetrics.highTopOfPageBidUsd).toBeCloseTo(4.2);
  });

  it('snake_case shape also parses (secondary compat, not primary)', () => {
    const r = parseGoogleHistoricalMetricsResult({
      text: 'dog ramp',
      close_variants: ['dog ramps'],
      keyword_metrics: {
        avg_monthly_searches: 1200,
        competition: 'LOW',
        competition_index: 12,
        low_top_of_page_bid_micros: 300000,
        high_top_of_page_bid_micros: 2100000,
        monthly_search_volumes: [{ year: 2026, month: 'MAY', monthly_searches: 1100 }],
      },
    });
    expect(r.text).toBe('dog ramp');
    expect(r.closeVariants).toEqual(['dog ramps']);
    expect(r.keywordMetrics.avgMonthlySearches).toBe(1200);
    expect(r.keywordMetrics.competition).toBe('LOW');
  });

  it('null monthly_searches stays unknown (not zero); missing fields stay null', () => {
    const r = parseGoogleHistoricalMetricsResult({
      text: 'dog bowl',
      closeVariants: [],
      keywordMetrics: {
        avgMonthlySearches: null,
        competition: 'UNSPECIFIED',
        competitionIndex: null,
        lowTopOfPageBidMicros: null,
        highTopOfPageBidMicros: null,
        monthlySearchVolumes: [{ year: 2026, month: 'JUNE', monthlySearches: null }],
      },
    });
    expect(r.keywordMetrics.avgMonthlySearches).toBeNull();
    expect(r.keywordMetrics.competition).toBeNull(); // UNSPECIFIED → null, never LOW
    expect(r.keywordMetrics.monthlySearchVolumes[0].monthlySearches).toBeNull();
  });
});

describe('Phase 4G.1 — customer id + required config (N, H, V)', () => {
  it('N) customer IDs have hyphens stripped before request', () => {
    expect(normalizeGoogleAdsCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeGoogleAdsCustomerId('1234567890')).toBe('1234567890');
    expect(normalizeGoogleAdsCustomerId('')).toBeNull();
    expect(normalizeGoogleAdsCustomerId(undefined)).toBeNull();
  });

  it('E) invalid customer ids are REJECTED — never silently coerced', () => {
    // Letters/symbols + digits must NOT become a plausible-looking id.
    expect(normalizeGoogleAdsCustomerId('abc-1234567890')).toBeNull();
    expect(normalizeGoogleAdsCustomerId('12X-456-7890')).toBeNull();
    expect(normalizeGoogleAdsCustomerId('123.456.7890')).toBeNull();
    expect(normalizeGoogleAdsCustomerId('123-456')).toBeNull();
    expect(normalizeGoogleAdsCustomerId('123456789')).toBeNull(); // 9 digits
    expect(normalizeGoogleAdsCustomerId('12345678901')).toBeNull(); // 11 digits
  });

  it('F) valid hyphenated customer normalizes to digits', () => {
    expect(normalizeGoogleAdsCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeGoogleAdsCustomerId(' 123-456-7890 ')).toBe('1234567890');
  });

  it('H) GOOGLE_ADS_CLIENT_SECRET is part of the REQUIRED server config', () => {
    // Full set → configured.
    expect(googleAdsEnvStatus().configured).toBe(true);
    // Remove CLIENT_SECRET → NOT configured.
    setFixtureEnv({ GOOGLE_ADS_CLIENT_SECRET: undefined });
    const status = googleAdsEnvStatus();
    expect(status.configured).toBe(false);
    expect(status.missing).toContain('GOOGLE_ADS_CLIENT_SECRET');
  });

  it('V) API version constant is v25 (centralized for upgrades)', () => {
    expect(GOOGLE_ADS_API_VERSION).toBe('v25');
  });
});

describe('Phase 4G.1 — OAuth + official v25 request (K, L, M, O, P, Q)', () => {
  it('K) configured mocked server: OAuth refresh called, then ONE v25 historical-metrics request', async () => {
    const oauthBody = { access_token: 'at-fixture', expires_in: 3600 };
    const metricsBody = { results: [OFFICIAL_RESULT] };
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: oauthBody }),
      () => ({ status: 200, json: metricsBody, headers: { 'request-id': 'req-123' } }),
    ]);
    const out = await generateKeywordHistoricalMetrics(['dog travel accessories'], { fetchImpl });
    expect(out.status).toBe('success');
    expect(out.requestId).toBe('req-123');
    expect(calls.length).toBe(2); // OAuth + ONE v25 call
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    // Phase 4G.1A §1: exact official custom-method HTTP binding — method bound
    // directly to the customer resource, NOT to a /keywordPlanIdeas/ sub-path.
    expect(calls[1].url).toBe('https://googleads.googleapis.com/v25/customers/1234567890:generateKeywordHistoricalMetrics');
  });

  it('A+B) exact URL: customers/{id}:generateKeywordHistoricalMetrics, never /keywordPlanIdeas:', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const metricsUrl = calls[1].url;
    expect(metricsUrl).toBe('https://googleads.googleapis.com/v25/customers/1234567890:generateKeywordHistoricalMetrics');
    expect(metricsUrl).not.toContain('/keywordPlanIdeas:');
  });

  it('C+D) request body uses lower-camel names; NO customer_id/customerId in the JSON body', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const body = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    expect(body.keywords).toEqual(['dog ramp']);
    expect(body.geoTargetConstants).toEqual(['geoTargetConstants/2840']);
    expect(body.keywordPlanNetwork).toBe('GOOGLE_SEARCH');
    expect(body.language).toBe('languageConstants/1000');
    // Customer ID belongs in the URL path only.
    expect(body).not.toHaveProperty('customer_id');
    expect(body).not.toHaveProperty('customerId');
  });

  it('O+P+Q) constants: geoTargetConstants/2840, languageConstants/1000, GOOGLE_SEARCH (in body)', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const body = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    expect(body.geoTargetConstants).toEqual(['geoTargetConstants/2840']);
    expect(body.language).toBe('languageConstants/1000');
    expect(body.keywordPlanNetwork).toBe('GOOGLE_SEARCH');
  });

  it('L) manager mode: login-customer-id header included when configured', async () => {
    setFixtureEnv({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: '999-888-7777' });
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers['login-customer-id']).toBe('9998887777');
  });

  it('M) direct-client mode: login-customer-id omitted when absent', async () => {
    setFixtureEnv({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined });
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers['login-customer-id']).toBeUndefined();
  });

  it('G) mocked official v25 response still parses through the full call path', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [OFFICIAL_RESULT] }, headers: { 'request-id': 'req-g' } }),
    ]);
    const out = await generateKeywordHistoricalMetrics(['dog travel accessories'], { fetchImpl });
    expect(out.status).toBe('success');
    expect(out.requestId).toBe('req-g');
    expect(out.results).toHaveLength(1);
    const r = out.results[0];
    expect(r.text).toBe('dog travel accessories');
    expect(r.closeVariants).toEqual(['dog travel gear', 'dog travel supplies']);
    expect(r.keywordMetrics.avgMonthlySearches).toBe(5400);
    expect(r.keywordMetrics.competition).toBe('HIGH');
    expect(r.keywordMetrics.lowTopOfPageBidUsd).toBeCloseTo(1.5);
    expect(r.keywordMetrics.monthlySearchVolumes[0]).toEqual({ year: 2026, month: 'AUGUST', monthlySearches: 5600 });
    void calls;
  });

  it('K2) access token is cached in memory — a second metrics call reuses OAuth, no second token refresh', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({ status: 200, json: { results: [] } }),
    ]);
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl, forceFresh: true });
    await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl, forceFresh: true });
    const oauthCalls = calls.filter((c) => c.url.includes('oauth2')).length;
    expect(oauthCalls).toBe(1); // token cached — no duplicate OAuth refresh
  });

  it('U) Google failure → status error, safe code/message, requestId preserved, no token leakage', async () => {
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({
        status: 403,
        headers: { 'request-id': 'req-fail' },
        json: {
          error: {
            code: 403,
            message: 'Customer is not enabled for API access: CUSTOMER_NOT_ENABLED',
            status: 'PERMISSION_DENIED',
          },
        },
      }),
    ]);
    const out = await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    expect(out.status).toBe('error');
    expect(out.errorCode).toBe('CUSTOMER_NOT_ENABLED');
    expect(out.requestId).toBe('req-fail');
    // No raw Google error body, no tokens.
    expect(out.errorSafe).not.toContain('Bearer');
    expect(out.errorSafe).not.toContain('at-fixture');
    expect(out.errorSafe).toContain('CUSTOMER_NOT_ENABLED');
    expect(calls.length).toBe(2); // OAuth + the ONE failed v25 call
  });

  it('U2) rate limit classified safely', () => {
    const c = classifyGoogleAdsError(429, { error: { message: 'Quota exceeded' } }, 'req-rl');
    expect(c.errorCode).toBe('RATE_LIMITED');
    expect(c.requestId).toBe('req-rl');
  });
});

describe('Phase 4G.1 — server instance cache honesty (F + cache)', () => {
  it('cache is a SERVER INSTANCE cache (in-memory), labeled honestly; forceFresh bypasses', async () => {
    let googleCalls = 0;
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => {
        googleCalls++;
        return { status: 200, json: { results: [{ text: 'dog ramp', closeVariants: [], keywordMetrics: {} }] } };
      },
    ]);
    const a = await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    const b = await generateKeywordHistoricalMetrics(['dog ramp'], { fetchImpl });
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(true);
    expect(googleCalls).toBe(1); // second request served from the instance cache
    const key = googleAdsServerCacheKey(['dog ramp'], 'US', 'en');
    expect(key).toMatch(/^US:en:\d{4}-\d{2}:dog ramp$/);
    // Not a durable monthly cache — warm instance only.
    expect(typeof clearGoogleAdsServerCache).toBe('function');
    void calls;
  });

  it('F) close-variant dedupe: 2 requested keywords can legitimately return 1 result', async () => {
    // Google dedupes close variants — one canonical row for "dog ramps" and
    // "dog ramp". The server reports requestedKeywords=2 and results.length=1.
    const { fetchImpl, calls } = mockFetchChain([
      () => ({ status: 200, json: { access_token: 'at', expires_in: 3600 } }),
      () => ({
        status: 200,
        json: {
          results: [{ text: 'dog ramp', closeVariants: ['dog ramps'], keywordMetrics: { avgMonthlySearches: 1200 } }],
        },
      }),
    ]);
    const out = await generateKeywordHistoricalMetrics(['dog ramps', 'dog ramp'], { fetchImpl });
    expect(out.status).toBe('success');
    expect(out.requestedKeywords).toHaveLength(2);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].closeVariants).toContain('dog ramps');
    void calls;
  });
});

// Type-level guard so the fixtures stay aligned with the official contract.
const _shapeCheck: GoogleHistoricalMetricsResult = {
  text: 'x',
  closeVariants: [],
  keywordMetrics: {
    avgMonthlySearches: null,
    competition: null,
    competitionIndex: null,
    lowTopOfPageBidUsd: null,
    highTopOfPageBidUsd: null,
    monthlySearchVolumes: [],
  },
};
void _shapeCheck;
