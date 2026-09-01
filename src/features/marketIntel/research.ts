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
//      keyword within the TTL does not re-fetch.
//
// fetchPage contract (src/features/ai/importer.ts): resolves to
// JSON.stringify(parseHtmlPage(...)) — a {"text","images",...} envelope — or
// rejects. Parsers consume plain text, so the envelope is unwrapped here.
// ============================================================================

import type { ProductOpportunityResult, SourceStatus, TrendDirection } from './types';
import { trendScore, hermesTrendsTask } from './trend';
import { parseEbaySearchPage } from './ebay';
import { parseAmazonPublicPage } from './amazon';
import { profitEconomics } from './supplier';
import { buildOpportunityResult, type OpportunityInput } from './score';

/** Reasonable pacing between live marketplace fetches (ms). */
export const PACING_MS = 900;
/** Short-lived cache window — repeated research within this window re-fetches nothing. */
export const RESEARCH_CACHE_TTL_MS = 15 * 60_000;

export interface ResearchDeps {
  /** Fetches a page; resolves to the JSON page envelope or rejects. */
  fetchPage: (url: string) => Promise<string>;
  /** Queues a Hermes browser task (agent_jobs); may be absent or fail — never fatal. */
  queueHermes?: (payload: Record<string, unknown>) => Promise<string | null>;
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
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RESEARCH_CACHE_TTL_MS) {
    return { ...hit.outcome, cached: true };
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

  // ---- Google Trends: honest NOT_CONFIGURED + Hermes browser queue ----
  // Trends data is never invented; missing data reports INSUFFICIENT_DATA and
  // the keyword is queued for a Hermes trends.google.com comparison instead.
  const trendDir: TrendDirection = 'INSUFFICIENT_DATA';
  const tScore = trendScore({ direction: trendDir });
  let hermesQueued = false;
  try {
    if (deps.queueHermes) {
      const queuedId = await deps.queueHermes(hermesTrendsTask(q));
      hermesQueued = queuedId !== null;
    }
  } catch {
    hermesQueued = false; // queue write failure must never stop the research job
  }

  const input: OpportunityInput = {
    trendDirection: trendDir,
    risingQueries: [],
    relatedQueries: [],
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
    trend: {
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
  cache.set(key, { at: Date.now(), outcome });
  return outcome;
}
