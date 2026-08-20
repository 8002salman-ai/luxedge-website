// ============================================================================
// LUXEDGE V2 — MARKET DEMAND ADAPTER (Phase 4D §9-§10 + Phase 4G §D + 4G.1)
//
// Provider-neutral interface for official/permitted demand-data sources.
// The Google Ads path is SERVER-BACKED: the browser NEVER holds Google
// credentials and NEVER inspects process.env — the server route
// (/api/market-demand/google-ads, admin JWT) is the ONLY authority for
// configured / not_configured / online / offline.
//
// Phase 4G.1: structured facts are PRIMARY. The adapter/server return
// requestedKeywords + returnedResults (official v25 row shape) and
// MarketSignals are generated FROM those facts — never reverse-parsed from
// human summary strings.
//
// HONESTY RULES:
//   * Google Ads "competition" means ADVERTISER/ad-slot competition — never
//     total ecommerce product competition.
//   * Search-volume evidence does NOT prove purchases, conversion rate,
//     marketplace sales, or Luxedge profitability.
//   * CJ `listedNum` / supplier listing count is NEVER routed through this
//     interface and is NEVER treated as consumer demand.
//   * A configured-but-failed demand source must NOT silently look identical
//     to "no demand provider configured" — status: not_configured / success /
//     error, with a safe (credential-scrubbed) error.
// ============================================================================

import type { MarketSignal } from './types';

export interface MarketDemandQuery {
  /** Market/category hypothesis, e.g. "dog travel accessories". */
  query: string;
  /** Target market (ISO-ish), e.g. "US". */
  market?: string;
}

export interface DemandSignalInput extends MarketDemandQuery {
  /** Geo target (USA only for Phase 4G.1). */
  geo?: string;
  /** Explicit keywords (max GOOGLE_MAX_KEYWORDS). Defaults to [query]. */
  keywords?: string[];
  /** Language code (English only for Phase 4G.1). */
  language?: string;
}

/** Server-derived demand-source health. */
export interface DemandSourceStatus {
  health: 'not_configured' | 'configured' | 'online' | 'offline';
}

/** A provider-neutral demand-data source (server-backed). */
export interface MarketDemandAdapter {
  readonly provider: string;
  /** Server-derived status — the browser never inspects process.env. */
  getStatus(): Promise<DemandSourceStatus>;
  /** Collect structured demand evidence — never invented. */
  collect(query: DemandSignalInput): Promise<DemandCollectionResult>;
}

/** Default adapter when no demand-data provider is configured. */
export class NoopMarketDemandAdapter implements MarketDemandAdapter {
  readonly provider = 'none';
  async getStatus(): Promise<DemandSourceStatus> {
    return { health: 'not_configured' };
  }
  async collect(_query: DemandSignalInput): Promise<DemandCollectionResult> {
    return notConfiguredResult('none');
  }
}

// ---------------------------------------------------------------------------
// Structured demand-collection result (Phase 4G §11 + 4G.1 §E)
// ---------------------------------------------------------------------------

export type DemandStatus = 'not_configured' | 'success' | 'error';

/**
 * One returned Google Ads historical-metrics row — STRUCTURED FACTS (the
 * source of truth). Generated from the official v25 result shape:
 *   results[] { text, closeVariants, keywordMetrics { ... } }
 * monthlySearchVolumes keeps { year, month, monthlySearches } — month is the
 * MonthOfYear enum name, NOT a YYYY-MM string (display is derived).
 */
export interface GoogleAdsReturnedResult {
  text: string;
  closeVariants: string[];
  avgMonthlySearches: number | null;
  monthlySearchVolumes: { year: number | null; month: string | null; monthlySearches: number | null }[];
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  competitionIndex: number | null;
  lowTopOfPageBidUsd: number | null;
  highTopOfPageBidUsd: number | null;
}

export interface DemandCollectionResult {
  status: DemandStatus;
  provider: string | null;
  /** Actual normalized request keywords (authoritative count). */
  requestedKeywords: string[];
  /** Actual Google results (close-variant dedupe may make this < requested). */
  returnedResults: GoogleAdsReturnedResult[];
  keywordsRequested: number;
  keywordsReturned: number;
  /** MarketSignals GENERATED from the structured facts above. */
  signals: MarketSignal[];
  errorSafe: string | null;
  errorCode: string | null;
  /** Google request-id when returned (debug aid; never auth headers). */
  requestId: string | null;
  observedAt: string | null;
  /** Derived display aggregates — computed FROM returnedResults, never from summaries. */
  avgMonthlySearches: number[] | null;
  monthlyHistory: { keyword: string; month: string; searches: number }[] | null;
  competition: string[] | null;
  competitionIndex: number[] | null;
  bidRangeUsd: { keyword: string; low: number; high: number }[] | null;
}

export function notConfiguredResult(provider: string | null): DemandCollectionResult {
  return {
    status: 'not_configured',
    provider,
    requestedKeywords: [],
    returnedResults: [],
    keywordsRequested: 0,
    keywordsReturned: 0,
    signals: [],
    errorSafe: null,
    errorCode: null,
    requestId: null,
    observedAt: null,
    avgMonthlySearches: null,
    monthlyHistory: null,
    competition: null,
    competitionIndex: null,
    bidRangeUsd: null,
  };
}

/**
 * Collect demand-adapter signals with a STRUCTURED result. A configured-but-
 * failed provider reports status 'error' (with a safe error) — it must NOT
 * look identical to 'not_configured'. The adapter is the server-backed path;
 * this wrapper only normalizes thrown errors into a structured result.
 */
export async function collectDemandSignals(
  adapter: MarketDemandAdapter | undefined | null,
  query: MarketDemandQuery & { keywords?: string[] }
): Promise<DemandCollectionResult> {
  if (!adapter) return notConfiguredResult(null);
  try {
    const result = await adapter.collect({ ...query, geo: query.market === 'US' || query.market === 'USA' ? 'US' : undefined });
    return result ?? notConfiguredResult(adapter.provider);
  } catch (e) {
    // Safe error only — never credentials.
    const msg = String((e as Error).message || e).replace(/(GOOGLE_ADS_[A-Z_]+|Bearer [A-Za-z0-9._-]+)/gi, '***');
    return { ...notConfiguredResult(adapter.provider), status: 'error', errorSafe: msg.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Official v25 response parsing (Phase 4G.1 §B)
// ---------------------------------------------------------------------------

/** Hard cap on keywords per Google demand request (client-side proactive cap). */
export const GOOGLE_MAX_KEYWORDS = 5;

/** MonthOfYear enum → month number (1-12) for YYYY-MM display. */
export const MONTH_OF_YEAR: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

/** Derive a YYYY-MM display string from year + MonthOfYear enum name. */
export function monthOfYearDisplay(year: number | null, month: string | null): string | null {
  if (year === null || month === null) return null;
  const m = MONTH_OF_YEAR[month.toUpperCase()];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}`;
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
 * Parse ONE official v25 GenerateKeywordHistoricalMetrics result row.
 * Primary contract: { text, closeVariants, keywordMetrics }.
 * Compatibility shapes (keyword ideas / snake_case) are accepted SECONDARY —
 * never the primary expectation (Phase 4G.1 §B3).
 */
export function parseGoogleAdsMetrics(raw: Record<string, unknown>): GoogleAdsReturnedResult {
  const kw = (raw.keyword_metrics ?? raw.keywordMetrics ?? raw.keyword_idea_metrics ?? raw.keywordIdeaMetrics ?? raw.keyword_historical_metrics ?? raw.keywordHistoricalMetrics ?? {}) as Record<string, unknown>;
  const closeRaw = Array.isArray(raw.closeVariants) ? raw.closeVariants : Array.isArray(raw.close_variants) ? raw.close_variants : [];
  const monthlyRaw = Array.isArray(kw.monthly_search_volumes) ? kw.monthly_search_volumes : Array.isArray(kw.monthlySearchVolumes) ? kw.monthlySearchVolumes : [];
  const monthlySearchVolumes: GoogleAdsReturnedResult['monthlySearchVolumes'] = monthlyRaw
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
    avgMonthlySearches: num(kw.avg_monthly_searches ?? kw.avgMonthlySearches),
    monthlySearchVolumes,
    competition: competitionOf(kw.competition),
    competitionIndex: num(kw.competition_index ?? kw.competitionIndex),
    lowTopOfPageBidUsd: microsToUsd(kw.low_top_of_page_bid_micros ?? kw.lowTopOfPageBidMicros),
    highTopOfPageBidUsd: microsToUsd(kw.high_top_of_page_bid_micros ?? kw.highTopOfPageBidMicros),
  };
}

/** Parse an array of official result rows (or a single row). */
export function parseGoogleAdsResults(raw: unknown): GoogleAdsReturnedResult[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => parseGoogleAdsMetrics((r ?? {}) as Record<string, unknown>)).filter((r) => r.text);
  }
  if (raw && typeof raw === 'object') {
    const row = parseGoogleAdsMetrics(raw as Record<string, unknown>);
    return row.text ? [row] : [];
  }
  return [];
}

const LIMITATION = 'Search-volume evidence from Google Search; it does not prove purchases, conversion rate, marketplace sales, or Luxedge profitability.';

/**
 * Generate MarketSignal[] FROM structured facts (Phase 4G.1 §E). Human
 * summaries are display/audit output only — never parsed back into data.
 */
export function googleResultsToSignals(
  results: GoogleAdsReturnedResult[],
  observedAt: string,
  opts: { geo?: string; language?: string } = {}
): MarketSignal[] {
  const geo = opts.geo || 'US';
  const lang = opts.language || 'en';
  const signals: MarketSignal[] = [];
  for (const r of results) {
    const kw = r.text || '?';
    if (r.avgMonthlySearches !== null) {
      signals.push({
        id: `demand-${kw}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        signalType: 'search_demand',
        source: `Google Ads Keyword Planner (${geo}, ${lang})`,
        sourceUrl: '',
        observedAt,
        summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" avg monthly searches ~${r.avgMonthlySearches.toLocaleString('en-US')} (12-month official estimate). Advertiser-facing data, not purchases.`,
        confidence: 'verified',
        limitations: LIMITATION,
      });
    }
    if (r.monthlySearchVolumes.length) {
      const display = r.monthlySearchVolumes
        .slice(0, 12)
        .map((m) => `${monthOfYearDisplay(m.year, m.month) ?? `${m.month ?? '?'}/${m.year ?? '?'}`}: ${m.monthlySearches !== null ? m.monthlySearches.toLocaleString('en-US') : 'unknown'}`)
        .join(', ');
      signals.push({
        id: `demand-hist-${kw}-${Date.now()}`,
        signalType: 'search_demand_history',
        source: `Google Ads Keyword Planner (${geo}, ${lang})`,
        sourceUrl: '',
        observedAt,
        summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" monthly history — ${display}. Official historical estimates only.`,
        confidence: 'verified',
        limitations: LIMITATION,
      });
    }
    if (r.competition) {
      signals.push({
        id: `demand-comp-${kw}-${Date.now()}`,
        signalType: 'keyword_ad_competition',
        source: `Google Ads Keyword Planner (${geo}, ${lang})`,
        sourceUrl: '',
        observedAt,
        summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" advertiser competition ${r.competition}${r.competitionIndex !== null ? ` (index ${r.competitionIndex})` : ''} — AD-SLOT competition, NOT total product competition.`,
        confidence: 'verified',
        limitations: 'Google Ads "competition" measures advertiser bidding on the ad slot — it is not marketplace/ecommerce product competition and not demand for a specific product.',
      });
    }
    if (r.lowTopOfPageBidUsd !== null || r.highTopOfPageBidUsd !== null) {
      signals.push({
        id: `demand-bid-${kw}-${Date.now()}`,
        signalType: 'keyword_bid_range',
        source: `Google Ads Keyword Planner (${geo}, ${lang})`,
        sourceUrl: '',
        observedAt,
        summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" typical top-of-page bid ${r.lowTopOfPageBidUsd !== null ? `low $${r.lowTopOfPageBidUsd.toFixed(2)}` : 'low n/a'} / ${r.highTopOfPageBidUsd !== null ? `high $${r.highTopOfPageBidUsd.toFixed(2)}` : 'high n/a'} (advertiser cost signal, not product price).`,
        confidence: 'verified',
        limitations: 'Top-of-page bids are advertiser cost signals, not consumer price or product margin evidence.',
      });
    }
  }
  return signals;
}

/**
 * Derive display aggregates DIRECTLY from structured facts (never from
 * summary strings). Keywords may differ between requested and returned
 * (close-variant dedupe) — counts are separate and honest.
 */
export function aggregatesFromResults(results: GoogleAdsReturnedResult[]): Pick<
  DemandCollectionResult,
  'avgMonthlySearches' | 'monthlyHistory' | 'competition' | 'competitionIndex' | 'bidRangeUsd'
> {
  const avg: number[] = [];
  const monthly: { keyword: string; month: string; searches: number }[] = [];
  const comp: string[] = [];
  const compIdx: number[] = [];
  const bids: { keyword: string; low: number; high: number }[] = [];
  for (const r of results) {
    const kw = r.text;
    if (r.avgMonthlySearches !== null) avg.push(r.avgMonthlySearches);
    for (const m of r.monthlySearchVolumes) {
      const display = monthOfYearDisplay(m.year, m.month);
      if (display && m.monthlySearches !== null) monthly.push({ keyword: kw, month: display, searches: m.monthlySearches });
    }
    if (r.competition) comp.push(r.competition);
    if (r.competitionIndex !== null) compIdx.push(r.competitionIndex);
    if (r.lowTopOfPageBidUsd !== null || r.highTopOfPageBidUsd !== null) {
      bids.push({ keyword: kw, low: r.lowTopOfPageBidUsd ?? 0, high: r.highTopOfPageBidUsd ?? 0 });
    }
  }
  return {
    avgMonthlySearches: avg.length ? avg : null,
    monthlyHistory: monthly.length ? monthly : null,
    competition: comp.length ? comp : null,
    competitionIndex: compIdx.length ? compIdx : null,
    bidRangeUsd: bids.length ? bids : null,
  };
}

// ---------------------------------------------------------------------------
// SERVER-BACKED GOOGLE ADS ADAPTER (Phase 4G.1 §C6)
//
// Real path: ProductScout → /api/market-demand/google-ads (admin JWT) →
// server OAuth → Google Ads v25. The browser sends only keywords/market/
// language and receives structured metric facts. No Google secret ever
// enters client code. configured/online status comes from the SERVER.
//
// CALL CONTROL: after the first successful collection this adapter instance
// serves the cached result — one collect() per MI job execution means at
// most ONE outbound historical-metrics request per job. Identical requests
// across instances are additionally deduped by the server instance cache.
// ============================================================================

/** Normalize + proactively cap keywords (max GOOGLE_MAX_KEYWORDS). */
export function normalizeDemandKeywords(input: string[]): string[] {
  const uniq = [...new Set(input.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  return uniq.slice(0, GOOGLE_MAX_KEYWORDS);
}

export class GoogleAdsServerDemandAdapter implements MarketDemandAdapter {
  readonly provider = 'google-ads';
  private apiBase: string;
  private fetchImpl: typeof fetch;
  private getToken: () => string | null;
  private cache: { result: DemandCollectionResult } | null = null;

  constructor(opts: {
    apiBase?: string;
    fetchImpl?: typeof fetch;
    getToken?: () => string | null;
  } = {}) {
    this.apiBase = opts.apiBase ?? '/api';
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.getToken = opts.getToken ?? (() => null);
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Server-derived status — the browser never inspects process.env. */
  async getStatus(): Promise<DemandSourceStatus> {
    try {
      const res = await this.fetchImpl(`${this.apiBase}/market-demand/google-ads?action=health`, {
        headers: { ...this.authHeaders() },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { health: 'offline' };
      const data = (await res.json().catch(() => null)) as { health?: string } | null;
      const health = data?.health;
      return health === 'configured' || health === 'not_configured' ? { health } : { health: 'offline' };
    } catch {
      return { health: 'offline' };
    }
  }

  /** Collect structured demand facts through the server. */
  async collect(query: DemandSignalInput): Promise<DemandCollectionResult> {
    // One collect() per adapter instance → max one outbound request per MI job.
    if (this.cache) return this.cache.result;

    const keywords = normalizeDemandKeywords(
      query.keywords && query.keywords.length ? query.keywords : [query.query]
    );
    if (keywords.length === 0) return notConfiguredResult(this.provider);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/market-demand/google-ads?action=historical-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ keywords, market: query.market || 'US', language: query.language || 'en' }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      const err: DemandCollectionResult = {
        ...notConfiguredResult(this.provider),
        status: 'error',
        errorSafe: `Demand server unreachable: ${String((e as Error).message || e).slice(0, 200)}`,
      };
      this.cache = { result: err };
      return err;
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data) {
      const err: DemandCollectionResult = {
        ...notConfiguredResult(this.provider),
        status: 'error',
        errorSafe: data && typeof data.error === 'string' ? data.error : `Demand server error (HTTP ${res.status})`,
      };
      this.cache = { result: err };
      return err;
    }
    const serverStatus = String(data.status ?? '');
    if (serverStatus === 'not_configured') {
      const result = notConfiguredResult(this.provider);
      this.cache = { result };
      return result;
    }
    if (serverStatus === 'error') {
      const result: DemandCollectionResult = {
        ...notConfiguredResult(this.provider),
        status: 'error',
        errorSafe: data.errorSafe ? String(data.errorSafe) : 'Google Ads demand provider failed.',
        errorCode: data.errorCode ? String(data.errorCode) : null,
        requestId: data.requestId ? String(data.requestId) : null,
        keywordsRequested: keywords.length,
        keywordsReturned: 0,
      };
      this.cache = { result };
      return result;
    }
    // success — structured facts first, signals generated from them.
    const results = parseGoogleAdsResults(data.results);
    const observedAt = data.observedAt ? String(data.observedAt) : new Date().toISOString();
    const result: DemandCollectionResult = {
      status: 'success',
      provider: this.provider,
      requestedKeywords: Array.isArray(data.requestedKeywords) ? data.requestedKeywords.map(String) : keywords,
      returnedResults: results,
      keywordsRequested: typeof data.keywordsRequested === 'number' ? data.keywordsRequested : keywords.length,
      keywordsReturned: results.length,
      signals: googleResultsToSignals(results, observedAt, { geo: query.geo || 'US', language: query.language || 'en' }),
      errorSafe: null,
      errorCode: null,
      requestId: data.requestId ? String(data.requestId) : null,
      observedAt,
      ...aggregatesFromResults(results),
    };
    this.cache = { result };
    return result;
  }
}
