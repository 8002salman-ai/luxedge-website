// ============================================================================
// LUXEDGE V2 — MARKET DEMAND ADAPTER (Phase 4D §9-§10 + Phase 4G §D)
//
// Provider-neutral interface for official/permitted demand-data sources.
// Phase 4G adds the Google Ads Keyword Planner adapter architecture
// (KeywordPlanIdeaService / GenerateKeywordHistoricalMetrics) — BUILT but NOT
// configured and NEVER called live in Phase 4G (no credentials are supplied;
// tests use fixtures only).
//
// HONESTY RULES:
//   * Google Ads "competition" means ADVERTISER/ad-slot competition — never
//     total ecommerce product competition.
//   * Search-volume evidence does NOT prove purchases, conversion rate,
//     marketplace sales, or Luxedge profitability.
//   * CJ `listedNum` / supplier listing count is NEVER routed through this
//     interface and is NEVER treated as consumer demand.
//   * A configured-but-failed demand source must NOT silently look identical
//     to "no demand provider configured" — collectDemandSignals returns a
//     structured result (status: not_configured / success / error).
// ============================================================================

import type { MarketSignal } from './types';

export interface MarketDemandQuery {
  /** Market/category hypothesis, e.g. "dog travel accessories". */
  query: string;
  /** Target market (ISO-ish), e.g. "US". */
  market?: string;
}

export interface DemandSignalInput extends MarketDemandQuery {
  /** For future geo = USA / language filters. */
  geo?: string;
  /** Optional explicit keywords (max GOOGLE_MAX_KEYWORDS). Defaults to [query]. */
  keywords?: string[];
  /** Language code (default en). */
  language?: string;
}

/** A provider-neutral demand-data source. */
export interface MarketDemandAdapter {
  readonly provider: string;
  /** True when the adapter has valid server-side credentials configured. */
  readonly configured: boolean;
  /** Fetch demand evidence — never invented. */
  getDemandSignals(query: DemandSignalInput): Promise<MarketSignal[]>;
}

/** Default adapter when no demand-data provider is configured. */
export class NoopMarketDemandAdapter implements MarketDemandAdapter {
  readonly provider = 'none';
  readonly configured = false;
  async getDemandSignals(): Promise<MarketSignal[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Structured demand-collection result (Phase 4G §11)
// ---------------------------------------------------------------------------

export type DemandStatus = 'not_configured' | 'success' | 'error';

export interface DemandCollectionResult {
  status: DemandStatus;
  signals: MarketSignal[];
  provider: string | null;
  /** Safe (credential-scrubbed) error when a configured provider failed. */
  errorSafe: string | null;
  observedAt: string | null;
  keywordsRequested: number;
  keywordsReturned: number;
  /** Official avg monthly searches per returned keyword (12-month). */
  avgMonthlySearches: number[] | null;
  /** Official monthly search history (keyword, month, searches). */
  monthlyHistory: { keyword: string; month: string; searches: number }[] | null;
  /** Advertiser competition levels (LOW/MEDIUM/HIGH) per keyword. */
  competition: string[] | null;
  /** Advertiser competition index (0-100) per keyword. */
  competitionIndex: number[] | null;
  /** Top-of-page bid range (USD) per keyword. */
  bidRangeUsd: { keyword: string; low: number; high: number }[] | null;
}

/**
 * Collect demand-adapter signals with a STRUCTURED result. A configured-but-
 * failed provider reports status 'error' (with a safe error) — it must NOT
 * look identical to 'not_configured'.
 */
export async function collectDemandSignals(
  adapter: MarketDemandAdapter | undefined | null,
  query: MarketDemandQuery
): Promise<DemandCollectionResult> {
  const empty = (status: DemandStatus, errorSafe: string | null = null): DemandCollectionResult => ({
    status,
    signals: [],
    provider: adapter?.provider ?? null,
    errorSafe,
    observedAt: null,
    keywordsRequested: 0,
    keywordsReturned: 0,
    avgMonthlySearches: null,
    monthlyHistory: null,
    competition: null,
    competitionIndex: null,
    bidRangeUsd: null,
  });
  if (!adapter || !adapter.configured) return empty('not_configured');
  const at = new Date().toISOString();
  try {
    const signals = await adapter.getDemandSignals({ ...query, geo: query.market === 'US' || query.market === 'USA' ? 'US' : undefined });
    const list = Array.isArray(signals) ? signals : [];
    const metrics = demandMetricsFromSignals(list);
    return {
      status: 'success',
      signals: list,
      provider: adapter.provider,
      errorSafe: null,
      observedAt: at,
      ...metrics,
    };
  } catch (e) {
    // Safe error only — never credentials.
    const msg = String((e as Error).message || e).replace(/(GOOGLE_ADS_[A-Z_]+|Bearer [A-Za-z0-9._-]+)/gi, '***');
    return empty('error', msg.slice(0, 200));
  }
}

/** Reverse-derive factual demand metrics from the collected signals (no invention). */
export function demandMetricsFromSignals(signals: MarketSignal[]): Pick<
  DemandCollectionResult,
  'keywordsRequested' | 'keywordsReturned' | 'avgMonthlySearches' | 'monthlyHistory' | 'competition' | 'competitionIndex' | 'bidRangeUsd'
> {
  const keywords = new Set<string>();
  const avg: number[] = [];
  const monthly: { keyword: string; month: string; searches: number }[] = [];
  const comp: string[] = [];
  const compIdx: number[] = [];
  const bids: { keyword: string; low: number; high: number }[] = [];

  for (const s of signals) {
    const kw = /keyword "([^"]+)"/.exec(s.summary)?.[1] ?? null;
    if (kw) keywords.add(kw);
    if (s.signalType === 'search_demand') {
      const m = /avg monthly searches ~([\d,]+)/.exec(s.summary);
      if (m) avg.push(parseInt(m[1].replace(/,/g, ''), 10));
    } else if (s.signalType === 'search_demand_history') {
      const rows = s.summary.matchAll(/([0-9]{4}-[0-9]{2}):\s*([\d,]+)/g);
      for (const row of rows) {
        if (row[1] && row[2]) monthly.push({ keyword: kw ?? '?', month: row[1], searches: parseInt(row[2].replace(/,/g, ''), 10) });
      }
    } else if (s.signalType === 'keyword_ad_competition') {
      const lvl = /competition (LOW|MEDIUM|HIGH)/.exec(s.summary)?.[1] ?? null;
      const idx = /index ([\d.]+)/.exec(s.summary)?.[1] ?? null;
      if (lvl) comp.push(lvl);
      if (idx) compIdx.push(parseFloat(idx));
    } else if (s.signalType === 'keyword_bid_range') {
      const lo = /low \$([\d.]+)/.exec(s.summary)?.[1] ?? null;
      const hi = /high \$([\d.]+)/.exec(s.summary)?.[1] ?? null;
      if (lo && hi && kw) bids.push({ keyword: kw, low: parseFloat(lo), high: parseFloat(hi) });
    }
  }
  return {
    keywordsRequested: keywords.size,
    keywordsReturned: keywords.size,
    avgMonthlySearches: avg.length ? avg : null,
    monthlyHistory: monthly.length ? monthly : null,
    competition: comp.length ? comp : null,
    competitionIndex: compIdx.length ? compIdx : null,
    bidRangeUsd: bids.length ? bids : null,
  };
}

// ---------------------------------------------------------------------------
// GOOGLE ADS KEYWORD PLANNER ADAPTER (Phase 4G §D — built, not live)
// ---------------------------------------------------------------------------

/** Official env var names (server-side only; values NEVER in this module). */
export const GOOGLE_ADS_ENV = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
] as const;

/** Hard cap on keywords per Google demand request (Phase 4G §E §10). */
export const GOOGLE_MAX_KEYWORDS = 5;

/** Read an env var ONLY when running in Node (never in the browser bundle). */
function env(name: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  } catch {
    return undefined;
  }
}

/** True when the full server-side Google Ads credential set is present. */
export function googleAdsConfigured(): boolean {
  return Boolean(env('GOOGLE_ADS_DEVELOPER_TOKEN') && env('GOOGLE_ADS_CLIENT_ID') && env('GOOGLE_ADS_REFRESH_TOKEN') && env('GOOGLE_ADS_CUSTOMER_ID'));
}

/** One official KeywordPlanIdea / historical-metrics record (parsed). */
export interface GoogleAdsKeywordMetrics {
  keyword: string;
  /** avg_monthly_searches (12-month) — null when not returned. */
  avgMonthlySearches: number | null;
  /** month → searches (official monthly history). */
  monthlySearchVolumes: { month: string; searches: number }[];
  /** Advertiser competition level — LOW/MEDIUM/HIGH — NOT ecommerce competition. */
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** Advertiser competition index (0-100). */
  competitionIndex: number | null;
  lowTopOfPageBidUsd: number | null;
  highTopOfPageBidUsd: number | null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse an official Google Ads KeywordPlanIdeaService /
 * GenerateKeywordHistoricalMetrics response fragment into factual metrics.
 * Accepts snake_case (official) or camelCase shapes; unknown fields stay null.
 */
export function parseGoogleAdsMetrics(raw: Record<string, unknown>): GoogleAdsKeywordMetrics {
  const kwi = (raw.keyword_idea_metrics ?? raw.keywordIdeaMetrics ?? {}) as Record<string, unknown>;
  const khm = (raw.keyword_historical_metrics ?? raw.keywordHistoricalMetrics ?? {}) as Record<string, unknown>;
  const monthlyRaw = (khm.monthly_search_volumes ?? khm.monthlySearchVolumes) as unknown;
  const monthlySearchVolumes: { month: string; searches: number }[] = [];
  if (Array.isArray(monthlyRaw)) {
    for (const row of monthlyRaw) {
      const r = (row ?? {}) as Record<string, unknown>;
      const month = String(r.month ?? r.yearMonth ?? '');
      const searches = num(r.searches ?? r.searchesCount ?? r.avgMonthlySearches);
      if (month && searches !== null) monthlySearchVolumes.push({ month, searches });
    }
  }
  const lowBidMicros = num(kwi.low_top_of_page_bid_micros ?? kwi.lowTopOfPageBidMicros);
  const highBidMicros = num(kwi.high_top_of_page_bid_micros ?? kwi.highTopOfPageBidMicros);
  return {
    keyword: String(raw.keyword ?? raw.keywordText ?? ''),
    avgMonthlySearches: num(kwi.avg_monthly_searches ?? khm.avg_monthly_searches ?? kwi.avgMonthlySearches ?? khm.avgMonthlySearches),
    monthlySearchVolumes,
    competition: (['LOW', 'MEDIUM', 'HIGH'] as readonly string[]).includes(String(kwi.competition ?? '').toUpperCase())
      ? (String(kwi.competition).toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH')
      : null,
    competitionIndex: num(kwi.competition_index ?? kwi.competitionIndex),
    lowTopOfPageBidUsd: lowBidMicros !== null ? lowBidMicros / 1_000_000 : null,
    highTopOfPageBidUsd: highBidMicros !== null ? highBidMicros / 1_000_000 : null,
  };
}

/** Normalized cache key: sorted keywords + geo + language + calendar month. */
export function googleDemandCacheKey(keywords: string[], geo: string, language: string): string {
  const norm = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).sort().join('|');
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${geo}:${language}:${month}:${norm}`;
}

const LIMITATION = 'Search-volume evidence from Google Search; it does not prove purchases, conversion rate, marketplace sales, or Luxedge profitability.';

/** Convert parsed official metrics into MarketSignal records (provider-neutral). */
export function googleMetricsToSignals(
  m: GoogleAdsKeywordMetrics,
  observedAt: string,
  opts: { geo?: string; language?: string } = {}
): MarketSignal[] {
  const geo = opts.geo || 'US';
  const lang = opts.language || 'en';
  const kw = m.keyword || '?';
  const signals: MarketSignal[] = [];
  if (m.avgMonthlySearches !== null) {
    signals.push({
      id: `demand-${kw}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      signalType: 'search_demand',
      source: `Google Ads Keyword Planner (${geo}, ${lang})`,
      sourceUrl: '',
      observedAt,
      summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" avg monthly searches ~${m.avgMonthlySearches.toLocaleString('en-US')} (12-month official estimate). Advertiser-facing data, not purchases.`,
      confidence: 'verified',
      limitations: LIMITATION,
    });
  }
  if (m.monthlySearchVolumes.length) {
    signals.push({
      id: `demand-hist-${kw}-${Date.now()}`,
      signalType: 'search_demand_history',
      source: `Google Ads Keyword Planner (${geo}, ${lang})`,
      sourceUrl: '',
      observedAt,
      summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" monthly history — ${m.monthlySearchVolumes.slice(0, 12).map((r) => `${r.month}: ${r.searches.toLocaleString('en-US')}`).join(', ')}. Official historical estimates only.`,
      confidence: 'verified',
      limitations: LIMITATION,
    });
  }
  if (m.competition) {
    signals.push({
      id: `demand-comp-${kw}-${Date.now()}`,
      signalType: 'keyword_ad_competition',
      source: `Google Ads Keyword Planner (${geo}, ${lang})`,
      sourceUrl: '',
      observedAt,
      summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" advertiser competition ${m.competition}${m.competitionIndex !== null ? ` (index ${m.competitionIndex})` : ''} — AD-SLOT competition, NOT total product competition.`,
      confidence: 'verified',
      limitations: 'Google Ads "competition" measures advertiser bidding on the ad slot — it is not marketplace/ecommerce product competition and not demand for a specific product.',
    });
  }
  if (m.lowTopOfPageBidUsd !== null || m.highTopOfPageBidUsd !== null) {
    signals.push({
      id: `demand-bid-${kw}-${Date.now()}`,
      signalType: 'keyword_bid_range',
      source: `Google Ads Keyword Planner (${geo}, ${lang})`,
      sourceUrl: '',
      observedAt,
      summary: `Google Ads (${geo}, ${lang}): keyword "${kw}" typical top-of-page bid ${m.lowTopOfPageBidUsd !== null ? `low $${m.lowTopOfPageBidUsd.toFixed(2)}` : 'low n/a'} / ${m.highTopOfPageBidUsd !== null ? `high $${m.highTopOfPageBidUsd.toFixed(2)}` : 'high n/a'} (advertiser cost signal, not product price).`,
      confidence: 'verified',
      limitations: 'Top-of-page bids are advertiser cost signals, not consumer price or product margin evidence.',
    });
  }
  return signals;
}

/**
 * Google Ads Keyword Planner demand adapter — BUILT in Phase 4G, NOT live.
 *
 * configured = the full server-side credential set exists. When configured,
 * getDemandSignals proxies through the Luxedge server route
 * (/api/market-demand/google-ads — admin JWT, never browser-held secrets).
 * Phase 4G performs NO live Google calls: without credentials the route
 * reports not_configured and this adapter returns [].
 *
 * CACHING: identical (keywords + geo + language + calendar month) requests are
 * served from the in-memory cache — never duplicate Google requests in the
 * same month. No secrets in the cache.
 */
export class GoogleAdsKeywordPlannerDemandAdapter implements MarketDemandAdapter {
  readonly provider = 'google-ads';
  readonly configured = googleAdsConfigured();
  private cache = new Map<string, MarketSignal[]>();
  /** Injectable fetcher for tests/fixtures (Phase 4G: never live). */
  fetchMetrics: (input: { keywords: string[]; market: string; language: string; geo: string }) => Promise<unknown[]>;
  constructor(opts: { fetchMetrics?: GoogleAdsKeywordPlannerDemandAdapter['fetchMetrics'] } = {}) {
    this.fetchMetrics = opts.fetchMetrics ?? (async () => {
      // Real path: Luxedge server proxy (admin JWT). Phase 4G has no Google
      // credentials, so the server route returns not_configured → [] here.
      return [];
    });
  }

  /** Normalize + cap keywords (max GOOGLE_MAX_KEYWORDS). */
  static normalizeKeywords(input: string[]): string[] {
    const uniq = [...new Set(input.map((k) => k.trim().toLowerCase()).filter(Boolean))];
    return uniq.slice(0, GOOGLE_MAX_KEYWORDS);
  }

  async getDemandSignals(query: DemandSignalInput): Promise<MarketSignal[]> {
    if (!this.configured) return [];
    const keywords = GoogleAdsKeywordPlannerDemandAdapter.normalizeKeywords(
      (query.keywords && query.keywords.length ? query.keywords : [query.query])
    );
    if (keywords.length === 0) return [];
    const geo = query.geo || 'US';
    const language = query.language || 'en';
    const key = googleDemandCacheKey(keywords, geo, language);
    const cached = this.cache.get(key);
    if (cached) return cached; // same month + same keywords → no duplicate Google request

    const raw = await this.fetchMetrics({ keywords, market: query.market || 'US', language, geo });
    const at = new Date().toISOString();
    const signals: MarketSignal[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const m = parseGoogleAdsMetrics(item as Record<string, unknown>);
      signals.push(...googleMetricsToSignals(m, at, { geo, language }));
    }
    this.cache.set(key, signals);
    return signals;
  }
}
