// ============================================================================
// LUXEDGE — PRODUCT INTELLIGENCE SCORE / CONFIDENCE / VERDICT
//
// PRODUCT_OPPORTUNITY_SCORE /100 — weighted components (spec §12):
//   Google Trends 15 | Amazon demand 20 | eBay demand 20 | Competition 10
//   Supplier 10 | Profit/margin 15 | Shipping/return 5 | Policy/IP safety 5
//
// Unavailable data never receives full points. The score is re-normalized to
// the covered weight transparently, and DATA CONFIDENCE (separate) tells the
// owner how much of the score is evidence-backed. A 91 with 42% confidence
// is NOT treated as stronger than an 86 with 91% confidence.
// ============================================================================

import type {
  OpportunityBreakdown, ProfitEconomics, VerdictDetail,
  ProductOpportunityResult, ResearchProvenance,
} from './types';
import { ebayScores } from './ebay';
import { trendScore, trendDirectionFromPoints } from './trend';

export const OPPORTUNITY_WEIGHTS = {
  trend: 15,
  amazonDemand: 20,
  ebayDemand: 20,
  competition: 10,
  supplier: 10,
  profit: 15,
  shipping: 5,
  safety: 5,
} as const;

export const OPPORTUNITY_MAX = Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0);

export interface OpportunityInput {
  trendDirection: Parameters<typeof trendDirectionFromPoints>[0] extends never ? never : ReturnType<typeof trendDirectionFromPoints>;
  trendPoints?: { d30: number | null; d90: number | null; d365: number | null; yoy: number | null };
  risingQueries?: string[];
  relatedQueries?: string[];
  usRelevant?: boolean;
  amazonDemand: { volume: number | null; bsrVelocity: 'rising' | 'stable' | 'declining' | null; reviews: number | null };
  ebay: { soldQuantity: number | null; watchers: number | null; activeListings: number | null; competitorCount: number | null; avgSoldPrice: number | null };
  supplierAvailable: boolean;
  economics: ProfitEconomics;
  /** null = no evidence — never counts as present for confidence. */
  shippingSimple: boolean | null;
  ipSafe: boolean | null;
}

/** Component scores 0..weight (missing → 0, never auto-full). */
function componentScores(i: OpportunityInput): Record<keyof typeof OPPORTUNITY_WEIGHTS, { points: number; present: boolean }> {
  const t = i.trendDirection === 'INSUFFICIENT_DATA' ? null : trendScore({
    direction: i.trendDirection,
    risingQueries: i.risingQueries,
    relatedQueries: i.relatedQueries,
    usRelevant: i.usRelevant,
  });
  const trendPts = t !== null ? Math.round((t / 100) * OPPORTUNITY_WEIGHTS.trend) : 0;

  let amazonPts = 0;
  const amazonPresent = i.amazonDemand.volume !== null || i.amazonDemand.bsrVelocity !== null || i.amazonDemand.reviews !== null;
  if (amazonPresent) {
    let a = 0;
    if (i.amazonDemand.volume !== null) a += Math.min(12, i.amazonDemand.volume / 200);
    if (i.amazonDemand.bsrVelocity === 'rising') a += 6;
    else if (i.amazonDemand.bsrVelocity === 'stable') a += 3;
    if (i.amazonDemand.reviews !== null && i.amazonDemand.reviews > 0) a += 2;
    amazonPts = Math.min(OPPORTUNITY_WEIGHTS.amazonDemand, Math.round(a));
  }

  const es = ebayScores({
    status: 'AVAILABLE',
    soldQuantity: i.ebay.soldQuantity,
    watchers: i.ebay.watchers,
    activeListings: i.ebay.activeListings,
    competitorCount: i.ebay.competitorCount,
    avgSoldPrice: i.ebay.avgSoldPrice,
  });
  const ebayPts = es.demandScore !== null ? Math.round((es.demandScore / 100) * OPPORTUNITY_WEIGHTS.ebayDemand) : 0;

  // Competition: high competition is a negative on the 10-pt opportunity slot.
  let compPts = 0;
  if (es.competitionScore !== null) {
    compPts = Math.round(((100 - es.competitionScore) / 100) * OPPORTUNITY_WEIGHTS.competition);
  }

  const supplierPts = i.supplierAvailable ? OPPORTUNITY_WEIGHTS.supplier : 0;

  let profitPts = 0;
  const profitPresent = i.economics.marginPct !== null && i.economics.marginPct !== undefined;
  if (profitPresent && i.economics.marginPct !== null) {
    profitPts = Math.round(Math.min(1, i.economics.marginPct / 50) * OPPORTUNITY_WEIGHTS.profit);
  }

  // Structural components only count as PRESENT when there is real evidence.
  // Otherwise they would inflate confidence/score for otherwise-empty research.
  const shippingPts = i.shippingSimple ? OPPORTUNITY_WEIGHTS.shipping : 0;
  const safetyPts = i.ipSafe ? OPPORTUNITY_WEIGHTS.safety : 0;

  return {
    trend: { points: trendPts, present: t !== null },
    amazonDemand: { points: amazonPts, present: amazonPresent },
    ebayDemand: { points: ebayPts, present: es.demandScore !== null },
    competition: { points: compPts, present: es.competitionScore !== null },
    supplier: { points: supplierPts, present: i.supplierAvailable },
    profit: { points: profitPts, present: profitPresent },
    shipping: { points: shippingPts, present: i.shippingSimple !== null },
    safety: { points: safetyPts, present: i.ipSafe !== null },
  };
}

export function opportunityBreakdown(i: OpportunityInput): OpportunityBreakdown {
  const comps = componentScores(i);
  const covered = Object.values(comps).filter((c) => c.present).length;
  return {
    trend: comps.trend.points,
    amazonDemand: comps.amazonDemand.points,
    ebayDemand: comps.ebayDemand.points,
    competition: comps.competition.points,
    supplier: comps.supplier.points,
    profit: comps.profit.points,
    shipping: comps.shipping.points,
    safety: comps.safety.points,
    max: OPPORTUNITY_MAX,
    covered,
    components: Object.keys(OPPORTUNITY_WEIGHTS).length,
  };
}

/**
 * Final score: raw points re-normalized to the covered weight so a partial
 * result is comparable, AND a separate confidence % (evidence coverage).
 * Both are always reported together — never a bare number.
 */
export function opportunityScore(i: OpportunityInput): { score: number; confidence: number; breakdown: OpportunityBreakdown } {
  const breakdown = opportunityBreakdown(i);
  const comps = componentScores(i);
  const raw = Object.values(comps).reduce((a, c) => a + c.points, 0);
  const coveredWeight = Object.entries(OPPORTUNITY_WEIGHTS)
    .filter(([k]) => comps[k as keyof typeof OPPORTUNITY_WEIGHTS].present)
    .reduce((a, [, w]) => a + w, 0);
  // Re-normalize transparently: raw / coveredWeight * 100. If nothing is
  // covered, score is 0 with 0% confidence (honest).
  const score = coveredWeight > 0 ? Math.round((raw / coveredWeight) * 100) : 0;
  const confidence = Math.round((coveredWeight / OPPORTUNITY_MAX) * 100);
  return { score, confidence, breakdown };
}

/** Verdict — data-driven, with test quantities for buy/test tiers. */
export function verdictFrom(score: number, confidence: number, economics: ProfitEconomics): VerdictDetail {
  const margin = economics.marginPct ?? 0;
  const roi = economics.roiPct ?? 0;
  const landed = economics.landedCost ?? 0;

  if (confidence < 30) {
    return { verdict: 'WATCH', recommendedTestQuantity: null, expectedInvestment: null, note: 'Confidence too low for a buy/test call — gather more evidence.' };
  }
  if (score >= 75 && margin >= 40 && roi >= 100) {
    return {
      verdict: 'STRONG BUY',
      recommendedTestQuantity: 25,
      expectedInvestment: Math.round((landed * 25) * 100) / 100,
      note: `Strong multi-source demand + margin ${margin}% + ROI ${roi}%.`,
    };
  }
  if (score >= 60 && margin >= 30 && roi >= 60) {
    return {
      verdict: 'BUY TEST',
      recommendedTestQuantity: 10,
      expectedInvestment: Math.round((landed * 10) * 100) / 100,
      note: `Solid demand signals; test 10 units to validate before scaling.`,
    };
  }
  if (score >= 45 && margin >= 20) {
    return {
      verdict: 'TEST SMALL',
      recommendedTestQuantity: 5,
      expectedInvestment: Math.round((landed * 5) * 100) / 100,
      note: `Moderate signals — small test only.`,
    };
  }
  if (score < 30 || margin < 10) {
    return {
      verdict: 'SKIP',
      recommendedTestQuantity: null,
      expectedInvestment: null,
      note: margin < 10 ? 'Margin too thin to be profitable.' : 'Weak demand evidence across sources.',
    };
  }
  if (margin < 20 || roi < 40) {
    return {
      verdict: 'HIGH RISK',
      recommendedTestQuantity: null,
      expectedInvestment: null,
      note: 'Signals are mixed; margin/ROI below safe thresholds.',
    };
  }
  return {
    verdict: 'WATCH',
    recommendedTestQuantity: null,
    expectedInvestment: null,
    note: 'Monitor trends and competition before committing.',
  };
}

/** Assemble the full result with provenance. */
export function buildOpportunityResult(
  keyword: string,
  i: OpportunityInput,
  provenance: Omit<ResearchProvenance, 'confidence' | 'finalScore' | 'researchDate' | 'keyword'>
): ProductOpportunityResult {
  const { score, confidence, breakdown } = opportunityScore(i);
  const verdict = verdictFrom(score, confidence, i.economics);
  const covered = breakdown.covered / breakdown.components;
  const p: ResearchProvenance = {
    ...provenance,
    researchDate: new Date().toISOString(),
    keyword,
    confidence,
    finalScore: score,
  };
  return {
    keyword,
    opportunityScore: score,
    confidence,
    breakdown,
    economics: i.economics,
    verdict,
    provenance: p,
    partial: covered < 1,
  };
}
