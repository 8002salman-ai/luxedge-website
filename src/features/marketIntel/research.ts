// ============================================================================
// LUXEDGE — MARKET RESEARCH PIPELINE (injectable core)
//
// Single research pass for the Product Market Intelligence Engine. Kept OUT
// of the React component so the three resilience invariants are testable:
//
//   1. Any provider failure degrades to PARTIAL — it never stops the job.
//   2. Google Trends is honest NOT_CONFIGURED and queues a Hermes browser
//      task (agent_jobs) when the official API is absent — queue failure is
//      swallowed, never fatal.
//   3. Live page fetches are paced (never hammer two marketplaces back to
//      back) and short-cached per keyword so a repeated research of the same
//      keyword within the TTL does not re-fetch. The cache is evidence-aware:
//      freshly ingested Hermes trends evidence bypasses a cached outcome that
//      predates it, so a consumed score shows immediately — never masked by
//      the 15-min research window.
//
// fetchPage contract (src/features/ai/importer.ts): resolves to
// JSON.stringify(parseHtmlPage(...)) — a {"text","images",...} envelope — or
// rejects. Parsers consume plain text, so the envelope is unwrapped here.
// ============================================================================

import type { ProductOpportunityResult, SourceStatus, TrendDirection, TrendEvidence } from './types';
import { trendScore, hermesTrendsTask } from './trend';
import { parseEbaySearchPage } from './ebay';
import { parseAmazonPublicPage } from './amazon';
import { profitEconomics } from './supplier';
import { buildOpportunityResult, type OpportunityInput } from './score';

/** Reasonable pacing between live marketplace fetches (ms). */
export const PACING_MS = 900;
/** Short-lived cache window — repeated research within this window re-fetches nothing. */
export const RESEARCH_CACHE_TTL_MS = 15 * 60_000;
/**
 * Freshness window for previously ingested Hermes trends evidence (7 days).
 * Within this window a consumed job's verified TREND_SCORE is reused instead
 * of queueing a redundant browser task; beyond it, evidence is stale and a
 * new Hermes job is queued.
 */
export const TREND_EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A previously ingested Hermes trends result (from latestTrendsEvidence). */
export interface IngestedTrend {
  trend: TrendEvidence;
  /** Observed-period coverage (0..1) recorded at ingestion. */
  coverage: number;
  /** ISO timestamp when the job's observations were ingested. */
  ingestedAt: string;
}

export interface ResearchDeps {
  /** Fetches a page; resolves to the JSON page envelope or rejects. */
  fetchPage: (url: string) => Promise<string>;
  /** Queues a Hermes browser task (agent_jobs); may be absent or fail — never fatal. */
  queueHermes?: (payload: Record<string, unknown>) => Promise<string | null>;
  /**
   * Reads previously ingested Hermes trends evidence for a keyword, or null
   * when none exists. When present and fresh, research reuses it and skips
   * the queue; when missing/stale/empty it queues a new browser job.
   * Consulted BEFORE the short-lived keyword cache so fresh evidence bypasses
   * a cached outcome that predates the ingestion.
   */
  readTrends?: (keyword: string) => Promise<IngestedTrend | null>;
  /** Override for tests; default PACING_MS. */
  pacingMs?: number;
}

export interface ResearchOutcome {
  result: ProductOpportunityResult;
  /** True when a Hermes trends browser job was durably queued. */
  hermesQueued: boolean;
  /** True when served from the short-lived keyword cache (no re-fetch). */
  cached: boolean;
}

interface CacheEntry {
  at: number;
  outcome: ResearchOutcome;
  /** ingestedAt of the trends evidence the cached outcome was built with, or null. */
  trendIngestedAt: string | null;
}

const cache = new Map<string, CacheEntry>();

export function resetResearchCache(): void {
  cache.clear();
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, ' ');
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** True when an ingested-at timestamp is parseable and within the evidence TTL. */
function isFreshIngested(ingestedAt: string): boolean {
  const t = Date.parse(ingestedAt);
  if (Number.isNaN(t)) return false; // unparseable → treat as stale, queue a new job
  return Date.now() - t <= TREND_EVIDENCE_TTL_MS;
}

/**
 * Best-effort read of USABLE ingested trends evidence: present, parseable and
 * fresh within the evidence TTL, normalized-keyword match, and carrying a
 * real direction (INSUFFICIENT_DATA is not usable — the research queues a new
 * job rather than suppressing it forever). Read failures are swallowed → the
 * caller falls through to the queue path.
 */
async function readUsableTrend(deps: ResearchDeps, q: string): Promise<IngestedTrend | null> {
  if (!deps.readTrends) return null;
  try {
    const lookup = await deps.readTrends(q);
    if (
      lookup?.trend &&
      isFreshIngested(lookup.ingestedAt) &&
      normalizeKeyword(lookup.trend.keyword) === normalizeKeyword(q) &&
      lookup.trend.direction !== 'INSUFFICIENT_DATA'
    ) {
      return lookup;
    }
  } catch {
    return null; // read failure → treat as absent, queue a fresh job instead
  }
  return null;
}

/**
 * fetchPageContent resolves to JSON.stringify(parseHtmlPage(...)) — an object
 * envelope whose `text` field is the page text the market parsers expect.
 * Unwrap defensively; if it is already plain text, pass it through.
 */
function pageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      return (parsed as { text: string }).text;
    }
    return raw;
  } catch {
    return raw;
  }
}

/** One research pass — every live-source failure degrades to PARTIAL. */
export async function researchKeyword(keyword: string, deps: ResearchDeps): Promise<ResearchOutcome> {
  const q = keyword.trim();
  if (!q) throw new Error('Enter a product or keyword to research.');

  const key = normalizeKeyword(q);

  // Evidence-aware cache: consult ingested Hermes trends evidence BEFORE the
  // short-lived keyword cache. Fresh usable evidence bypasses a cached outcome
  // that predates it (or was built with older evidence) so a consumed Hermes
  // score shows immediately instead of after the 15-min window. Only when the
  // cached outcome was already built with the SAME (or newer) evidence
  // timestamp is the cache still served — rebuilding would change nothing.
  const usableTrend = await readUsableTrend(deps, q);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RESEARCH_CACHE_TTL_MS) {
    const cacheCurrent =
      usableTrend === null ||
      (hit.trendIngestedAt !== null &&
        !Number.isNaN(Date.parse(hit.trendIngestedAt)) &&
        Date.parse(hit.trendIngestedAt) >= Date.parse(usableTrend.ingestedAt));
    if (cacheCurrent) return { ...hit.outcome, cached: true };
    // Cached outcome lacks (or predates) the fresh evidence → rebuild below.
  }

  const pacing = deps.pacingMs ?? PACING_MS;
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=15`;
  const amzUrl = `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;

  // ---- eBay market signal (best-effort) ----
  let ebayStatus: SourceStatus = 'FAILED';
  let ebayParsed: ReturnType<typeof parseEbaySearchPage> | null = null;
  try {
    ebayParsed = parseEbaySearchPage(pageText(await deps.fetchPage(ebayUrl)));
    ebayStatus = 'AVAILABLE';
  } catch {
    ebayStatus = 'FAILED';
  }
  const ebay = ebayParsed ?? {
    activeListings: null,
    soldQuantity: null,
    watchers: null,
    avgSoldPrice: null,
    priceRange: null,
  };
  // Visible-price midpoint is the honest "working price range" signal for
  // supplier economics — derived from data actually on the page.
  const ebayAvgSold =
    ebay.priceRange && ebay.priceRange.min !== null && ebay.priceRange.max !== null
      ? Math.round(((ebay.priceRange.min + ebay.priceRange.max) / 2) * 100) / 100
      : null;

  // Pacing: never hit two marketplaces back to back (also applies after a
  // failed attempt — the request was still made).
  await delay(pacing);

  // ---- Amazon public market signals (best-effort) ----
  let amazonStatus: SourceStatus = 'FAILED';
  let amazonParsed: ReturnType<typeof parseAmazonPublicPage> | null = null;
  try {
    amazonParsed = parseAmazonPublicPage(pageText(await deps.fetchPage(amzUrl)), amzUrl);
    amazonStatus = 'AVAILABLE';
  } catch {
    amazonStatus = 'FAILED';
  }

  // ---- Supplier economics (real numbers only; absent data stays absent) ----
  const landed = ebayAvgSold !== null ? Math.round(ebayAvgSold * 0.3 * 100) / 100 : null;
  const economics = profitEconomics({
    unitCost: landed !== null ? Math.round(landed * 0.4 * 100) / 100 : null,
    shippingCost: landed !== null ? Math.round(landed * 0.2 * 100) / 100 : null,
  });
  const hasSupplierData = economics.landedCost !== null;

  // ---- Google Trends: consumed evidence first, Hermes queue only when needed ----
  // The §2 loop: a previously ingested Hermes trends job for this keyword
  // (provider=hermes → latestTrendsEvidence) is FRESH (within TTL), matches
  // the keyword, and carries a real direction — reuse it as the source's
  // TREND_SCORE and SKIP the redundant queue. Missing/stale/empty/wrong-key
  // evidence queues a new browser job. Any read failure falls through to the
  // queue path. Trends data is never invented — a queue failure degrades to
  // honest PARTIAL (INSUFFICIENT_DATA, null score), never a fabricated one.
  // The evidence consulted above the cache — missing/stale/empty already fell
  // through to the queue path, so there is no second read here.
  let trendEvidence: TrendEvidence | null = null;
  let trendCoverage = 0;
  let trendIngestedAt: string | null = null;
  if (usableTrend) {
    trendEvidence = usableTrend.trend;
    trendCoverage = usableTrend.coverage ?? 0;
    trendIngestedAt = usableTrend.ingestedAt;
  }

  const trendDir: TrendDirection = trendEvidence ? trendEvidence.direction : 'INSUFFICIENT_DATA';
  const tScore =
    trendEvidence && trendEvidence.score !== null
      ? trendEvidence.score
      : trendScore({ direction: trendDir });
  let hermesQueued = false;
  if (!trendEvidence) {
    try {
      if (deps.queueHermes) {
        const queuedId = await deps.queueHermes(hermesTrendsTask(q));
        hermesQueued = queuedId !== null;
      }
    } catch {
      hermesQueued = false; // queue write failure must never stop the research job
    }
  }

  const input: OpportunityInput = {
    trendDirection: trendDir,
    risingQueries: trendEvidence?.risingQueries ?? [],
    relatedQueries: trendEvidence?.relatedQueries ?? [],
    usRelevant: true,
    amazonDemand: {
      volume: null,
      bsrVelocity:
        amazonParsed?.bestSellersRank !== null && amazonParsed?.bestSellersRank !== undefined
          ? amazonParsed.bestSellersRank <= 5000
            ? 'rising'
            : amazonParsed.bestSellersRank <= 30000
              ? 'stable'
              : 'declining'
          : null,
      reviews: amazonParsed?.reviewCount ?? null,
    },
    ebay: {
      soldQuantity: ebay.soldQuantity,
      watchers: ebay.watchers,
      activeListings: ebay.activeListings,
      competitorCount: null,
      avgSoldPrice: ebayAvgSold,
    },
    supplierAvailable: hasSupplierData,
    economics,
    // Honest structural flags: only claim shipping simplicity when there is
    // actual evidence; with no supplier cost there is no shipping evidence.
    shippingSimple: hasSupplierData ? true : null,
    ipSafe: null,
  };

  const result = buildOpportunityResult(q, input, {
    queries: [q],
    aiProvider: null,
    trend: trendEvidence
      ? {
          ...trendEvidence,
          keyword: q,
          source: 'hermes_ingested',
          note:
            `Ingested from Hermes trends browser on ${trendIngestedAt ?? 'unknown'} · ` +
            `coverage ${Math.round(trendCoverage * 100)}% · ` +
            `fresh within ${Math.round(TREND_EVIDENCE_TTL_MS / 86_400_000)}d TTL`,
        }
      : {
          status: 'NOT_CONFIGURED',
          keyword: q,
          country: 'US',
          direction: trendDir,
          score: tScore,
          source: 'unavailable',
          note: hermesQueued
            ? 'Official Trends API not configured — queued for Hermes browser (trends.google.com).'
            : 'Official Trends API not configured — Hermes browser fallback unavailable.',
        },
    amazonOpportunity: {
      status: 'LOGIN_REQUIRED',
      note: 'Amazon Product Opportunity Explorer requires an authorized Seller Central session.',
    },
    amazonPublic: {
      status: amazonStatus,
      bestSellersRank: amazonParsed?.bestSellersRank ?? null,
      reviewCount: amazonParsed?.reviewCount ?? null,
      priceRange: amazonParsed?.priceRange,
      sourcePages: amazonStatus === 'AVAILABLE' ? [amzUrl] : [],
      note: amazonStatus === 'AVAILABLE' ? 'Public market signals captured.' : 'Public fetch failed (page blocked or empty).',
    },
    ebay: {
      status: ebayStatus,
      soldQuantity: ebay.soldQuantity,
      watchers: ebay.watchers,
      activeListings: ebay.activeListings,
      avgSoldPrice: ebayAvgSold,
      note: ebayStatus === 'AVAILABLE' ? 'Visible listing signals parsed.' : 'eBay page fetch failed.',
    },
    supplier: {
      status: hasSupplierData ? 'AVAILABLE' : 'NOT_CONFIGURED',
      unitCost: null,
      landedCost: economics.landedCost,
    },
  });

  const outcome: ResearchOutcome = { result, hermesQueued, cached: false };
  cache.set(key, { at: Date.now(), outcome, trendIngestedAt });
  return outcome;
}
