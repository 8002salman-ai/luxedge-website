// ============================================================================
// LUXEDGE — AMAZON PROVIDERS
//
// 5. AmazonOpportunityProvider — Amazon's OWN Seller Central research tool.
//    Browser/provider integration via an authorized session (Hermes). No
//    public API exists; never bypass auth. Without a session → LOGIN_REQUIRED.
//
// 6. AmazonPublicResearchProvider — public market signals (Best Sellers,
//    Movers & Shakers, New Releases, PDPs, BSR). Normal requests, reasonable
//    pacing. Never aggressive scraping.
// ============================================================================

import type { AmazonOpportunityEvidence, AmazonPublicEvidence, SourceStatus } from './types';

/** 5. Opportunity Explorer — Seller Central session required. */
export function amazonOpportunityStatus(authorized: boolean): SourceStatus {
  return authorized ? 'AVAILABLE' : 'LOGIN_REQUIRED';
}

export function amazonOpportunityEvidence(authorized: boolean): AmazonOpportunityEvidence {
  if (!authorized) {
    return {
      status: 'LOGIN_REQUIRED',
      note: 'Amazon Product Opportunity Explorer requires an authorized Seller Central session (Hermes browser). Continuing with public market signals.',
    };
  }
  // Data is captured by the authorized Hermes browser run and ingested here;
  // we never fabricate search-volume numbers.
  return { status: 'AVAILABLE', note: 'Opportunity Explorer data available via authorized session.' };
}

/** BSR-to-velocity heuristic from public Best Sellers data. */
export function bsrVelocity(bsr: number | null): 'rising' | 'stable' | 'declining' | null {
  if (bsr === null || bsr === undefined) return null;
  // BSR lower = faster selling. Absolute cutoffs are category-dependent; this
  // is a directional signal only, never a fabricated sales estimate.
  if (bsr <= 5_000) return 'rising';
  if (bsr <= 30_000) return 'stable';
  return 'declining';
}

/**
 * Parse a public Amazon product detail page (or Best Sellers row) into
 * AmazonPublicEvidence. Only fields actually visible in the text are set —
 * missing data stays null, never guessed.
 */
export function parseAmazonPublicPage(
  text: string,
  sourceUrl: string
): Partial<AmazonPublicEvidence> {
  const out: Partial<AmazonPublicEvidence> = {};
  // Best Sellers Rank: "#1,234 in Pet Supplies" / "Best Sellers Rank: #5,678"
  const bsrMatch = text.match(/#([\d,]{1,12})\s+in\s+([A-Za-z &,'-]+)/) || text.match(/Best Sellers Rank:\s*#([\d,]{1,12})/);
  if (bsrMatch) {
    out.bestSellersRank = parseInt(bsrMatch[1].replace(/,/g, ''), 10) || null;
    if (bsrMatch[2]) out.category = bsrMatch[2].trim();
  }
  // Price: "$14.99" or "Price: $14.99 - $19.99"
  const priceMatch = text.match(/\$([\d,]+\.?\d*)\s*[-–]\s*\$([\d,]+\.?\d*)/);
  if (priceMatch) {
    out.priceRange = {
      min: parseFloat(priceMatch[1].replace(/,/g, '')),
      max: parseFloat(priceMatch[2].replace(/,/g, '')),
    };
  } else {
    const single = text.match(/(?:Price:|^)\s*\$([\d,]+\.?\d*)/m);
    if (single) {
      const v = parseFloat(single[1].replace(/,/g, ''));
      out.priceRange = { min: v, max: v };
    }
  }
  // Reviews: "4.6 out of 5 stars" + "1,234 ratings"
  const rating = text.match(/([\d.]+)\s+out of 5 stars/);
  if (rating) out.rating = parseFloat(rating[1]);
  const reviews = text.match(/([\d,]+)\s+(?:ratings|global ratings|customer reviews)/);
  if (reviews) out.reviewCount = parseInt(reviews[1].replace(/,/g, ''), 10) || null;
  out.sourcePages = [sourceUrl];
  out.status = 'AVAILABLE';
  return out;
}

/** 6. Public research status after a fetch attempt. */
export function amazonPublicStatus(ok: boolean, _reason?: string): SourceStatus {
  return ok ? 'AVAILABLE' : 'FAILED';
}
