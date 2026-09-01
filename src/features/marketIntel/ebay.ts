// ============================================================================
// LUXEDGE — EBAY MARKET SIGNAL
//
// Reads visible eBay listing signals (active comparables, USA sellers,
// feedback, price, shipping, sold/watchers where visible) and computes
// EBAY_DEMAND_SCORE and EBAY_COMPETITION_SCORE. Missing data → lower
// confidence, never a fake positive.
// ============================================================================

import type { EbayMarketEvidence, SourceStatus } from './types';

export interface EbayParseResult {
  activeListings: number | null;
  soldQuantity: number | null;
  watchers: number | null;
  avgSoldPrice: number | null;
  priceRange: { min: number | null; max: number | null } | null;
}

/**
 * Parse visible eBay search-page signals. Only fields actually present in the
 * text are populated. eBay's HTML varies; missing fields stay null.
 */
export function parseEbaySearchPage(text: string): EbayParseResult {
  const out: EbayParseResult = {
    activeListings: null,
    soldQuantity: null,
    watchers: null,
    avgSoldPrice: null,
    priceRange: null,
  };
  // "1,234 results" / "About 567 results"
  const results = text.match(/([\d,]+)\s+results/);
  if (results) out.activeListings = parseInt(results[1].replace(/,/g, ''), 10) || null;
  // Sold items: "X sold" / "Sold: Y"
  const sold = text.match(/([\d,]+)\s+sold\b/);
  if (sold) out.soldQuantity = parseInt(sold[1].replace(/,/g, ''), 10) || null;
  // Watchers: "N watchers"
  const watch = text.match(/([\d,]+)\s+watchers?\b/);
  if (watch) out.watchers = parseInt(watch[1].replace(/,/g, ''), 10) || null;
  // Prices: "$12.99" occurrences — take min/max from visible price points.
  const prices = [...text.matchAll(/\$([\d,]+\.?\d*)/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((v) => v > 0 && v < 10_000);
  if (prices.length) {
    out.priceRange = { min: Math.min(...prices), max: Math.max(...prices) };
  }
  return out;
}

export interface EbayScores {
  demandScore: number | null;
  competitionScore: number | null;
  demandBasis: string[];
  competitionBasis: string[];
}

/**
 * EBAY_DEMAND_SCORE and EBAY_COMPETITION_SCORE — deterministic, evidence-based.
 * - Demand: sold quantity + watchers + active listings breadth.
 * - Competition: active listings density (more listings = more competition).
 * Missing signals shrink the basis and pull the score toward null (unknown).
 */
export function ebayScores(ev: EbayMarketEvidence): EbayScores {
  const demandBasis: string[] = [];
  const competitionBasis: string[] = [];
  let demand = 0;
  let comp = 0;

  if (ev.soldQuantity !== null && ev.soldQuantity !== undefined) {
    demand += Math.min(45, ev.soldQuantity / 10);
    demandBasis.push(`sold ${ev.soldQuantity}`);
  }
  if (ev.watchers !== null && ev.watchers !== undefined) {
    demand += Math.min(30, ev.watchers / 2);
    demandBasis.push(`watchers ${ev.watchers}`);
  }
  if (ev.activeListings !== null && ev.activeListings !== undefined) {
    // A healthy number of active listings shows a working market…
    demand += ev.activeListings >= 20 ? 15 : ev.activeListings >= 5 ? 10 : 5;
    demandBasis.push(`${ev.activeListings} active listings`);
    // …but density is competition.
    comp += Math.min(80, ev.activeListings);
    competitionBasis.push(`${ev.activeListings} competing listings`);
  }
  if (ev.competitorCount !== null && ev.competitorCount !== undefined) {
    comp += Math.min(20, ev.competitorCount);
    competitionBasis.push(`${ev.competitorCount} sellers`);
  }

  const demandScore = demandBasis.length ? Math.round(Math.min(100, demand)) : null;
  const competitionScore = competitionBasis.length ? Math.round(Math.min(100, comp)) : null;
  return { demandScore, competitionScore, demandBasis, competitionBasis };
}

export function ebayStatus(ok: boolean): SourceStatus {
  return ok ? 'AVAILABLE' : 'FAILED';
}
