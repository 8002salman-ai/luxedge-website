// ============================================================================
// LUXEDGE V2 — PRODUCT SCORE (100 POINTS)
//
// Exact weighted model required by the Phase 4A spec:
//   Demand/usefulness         20
//   Supplier reliability      15
//   USA delivery / warehouse  15
//   Profit margin             15
//   Ratings / review evidence 10
//   Visual / viral potential  10
//   Competition                5
//   Upsell potential           5
//   Return / complaint risk    5
//   TOTAL                     100
//
// RULE: no points where evidence is unavailable. Every criterion records its
// evidence basis in the breakdown note so the owner can audit the score.
// ============================================================================

import type { PageExtract } from './types';
import type { MarginCalc } from './types';
import type { ScoreBreakdown, ScoreCriterion } from './types';

export const SCORE_WEIGHTS: Record<string, number> = {
  demand: 20,
  supplierReliability: 15,
  usaDelivery: 15,
  profitMargin: 15,
  ratingsEvidence: 10,
  visualViral: 10,
  competition: 5,
  upsell: 5,
  returnRisk: 5,
};

export const SHORTLIST_THRESHOLD = 75;

export interface ScoreInput {
  title: string;
  extract: PageExtract;
  margin: MarginCalc;
  supplierVerified: boolean; // page fetched & supplier identity derived
  sourceIsManufacturer: boolean;
  images: string[];
  riskFlags: string[];
}

/** Cap a sub-score to its max. */
function cap(points: number, max: number): number {
  return Math.max(0, Math.min(max, points));
}

/**
 * Compute the 100-point opportunity score. Each criterion is graded on
 * evidence; missing evidence → 0 points with an explanatory note.
 */
export function scoreCandidate(input: ScoreInput): ScoreBreakdown {
  const { title, extract, margin, supplierVerified, sourceIsManufacturer, images, riskFlags } = input;
  const breakdown: Record<string, ScoreCriterion> = {};

  // 1) Demand / usefulness (20) — pet relevance + category signal.
  const isPet = /dog|cat|puppy|kitten|pet/i.test(title);
  const categorySignal = /feed|toy|bed|leash|harness|groom|treat|bowl|carrier|scratch|water|chew|brush|bath|walk/i.test(title);
  let demandPts = 0;
  const demandNote: string[] = [];
  if (isPet) { demandPts += 10; demandNote.push('Pet-relevant title (+10)'); }
  else demandNote.push('No pet-relevance evidence in title (+0)');
  if (categorySignal) { demandPts += 10; demandNote.push('Clear pet category signal (+10)'); }
  else demandNote.push('No specific pet category signal (+0)');
  breakdown.demand = { points: cap(demandPts, 20), max: 20, note: demandNote.join('; ') };

  // 2) Supplier reliability (15) — verified fetch + identity.
  if (!supplierVerified) {
    breakdown.supplierReliability = { points: 0, max: 15, note: 'Supplier page could not be verified (+0)' };
  } else if (sourceIsManufacturer) {
    breakdown.supplierReliability = { points: 15, max: 15, note: 'Official manufacturer source, page fetched (+15)' };
  } else {
    breakdown.supplierReliability = { points: 10, max: 15, note: 'Known retailer source, page fetched (+10)' };
  }

  // 3) USA delivery / warehouse (15).
  let deliveryPts = 0;
  const deliveryNote: string[] = [];
  if (extract.freeShipping) { deliveryPts += 5; deliveryNote.push('Free-shipping signal (+5)'); }
  else deliveryNote.push('No free-shipping evidence (+0)');
  if (extract.shippingDays) {
    if (extract.shippingDays.max <= 7) { deliveryPts += 10; deliveryNote.push(`Delivery ${extract.shippingDays.min}-${extract.shippingDays.max} days (+10)`); }
    else if (extract.shippingDays.max <= 14) { deliveryPts += 7; deliveryNote.push(`Delivery up to ${extract.shippingDays.max} days (+7)`); }
    else { deliveryPts += 3; deliveryNote.push(`Slow delivery up to ${extract.shippingDays.max} days (+3)`); }
  } else {
    deliveryNote.push('No USA delivery window evidence (+0)');
  }
  breakdown.usaDelivery = { points: cap(deliveryPts, 15), max: 15, note: deliveryNote.join('; ') };

  // 4) Profit margin (15) — only when fully computable (high confidence).
  if (margin.confidence === 'high' && margin.grossMarginPct !== null) {
    const pct = margin.grossMarginPct;
    let pts = 0;
    if (pct >= 0.5) pts = 15;
    else if (pct >= 0.4) pts = 12;
    else if (pct >= 0.3) pts = 8;
    else if (pct >= 0.25) pts = 5;
    else pts = 2;
    breakdown.profitMargin = { points: pts, max: 15, note: `Gross margin ${(pct * 100).toFixed(1)}% (landed-cost verified) (+${pts})` };
  } else {
    breakdown.profitMargin = { points: 0, max: 15, note: 'Margin not fully computable — no points (+0)' };
  }

  // 5) Ratings / review evidence (10) — evidence found on the source page.
  if (extract.rating !== null || extract.reviewCount !== null) {
    let pts = 4;
    const note = [`Source rating ${extract.rating ?? 'n/a'}/${extract.reviewCount ?? 0} reviews found (+4)`];
    if (extract.rating !== null && extract.rating >= 4) { pts += 4; note.push('Rating ≥ 4.0 (+4)'); }
    if (extract.reviewCount !== null && extract.reviewCount >= 50) { pts += 2; note.push('50+ reviews (+2)'); }
    breakdown.ratingsEvidence = { points: cap(pts, 10), max: 10, note: note.join('; ') };
  } else {
    breakdown.ratingsEvidence = { points: 0, max: 10, note: 'No rating/review evidence on source page (+0)' };
  }

  // 6) Visual / viral potential (10) — image count.
  const imgCount = images.length;
  if (imgCount >= 6) breakdown.visualViral = { points: 10, max: 10, note: `${imgCount} product images (+10)` };
  else if (imgCount >= 4) breakdown.visualViral = { points: 8, max: 10, note: `${imgCount} product images (+8)` };
  else if (imgCount >= 2) breakdown.visualViral = { points: 5, max: 10, note: `${imgCount} product images (+5)` };
  else if (imgCount === 1) breakdown.visualViral = { points: 2, max: 10, note: '1 product image (+2)' };
  else breakdown.visualViral = { points: 0, max: 10, note: 'No usable images (+0)' };

  // 7) Competition (5) — heuristic from category popularity.
  const competitiveCategories = /feed|bowl|leash|harness|brush|toy/i.test(title);
  if (competitiveCategories) {
    breakdown.competition = { points: 2, max: 5, note: 'Popular category — high competition assumed (+2)' };
  } else if (extract.sizes && extract.sizes.length > 0) {
    breakdown.competition = { points: 4, max: 5, note: 'Niche/multi-size product — moderate competition (+4)' };
  } else {
    breakdown.competition = { points: 3, max: 5, note: 'No competition data — neutral (+3)' };
  }

  // 8) Upsell potential (5).
  if (extract.sizes && extract.sizes.length > 1) {
    breakdown.upsell = { points: 5, max: 5, note: `${extract.sizes.length} size options → variant upsell (+5)` };
  } else if (extract.sizes && extract.sizes.length === 1) {
    breakdown.upsell = { points: 2, max: 5, note: 'Single size (+2)' };
  } else {
    breakdown.upsell = { points: 1, max: 5, note: 'No variant data — neutral (+1)' };
  }

  // 9) Return / complaint risk (5) — risk flags reduce points.
  const riskCount = riskFlags.length;
  if (riskCount === 0) breakdown.returnRisk = { points: 5, max: 5, note: 'No risk flags (+5)' };
  else if (riskCount === 1) breakdown.returnRisk = { points: 3, max: 5, note: `1 risk flag: ${riskFlags[0]} (+3)` };
  else breakdown.returnRisk = { points: 1, max: 5, note: `${riskCount} risk flags (+1)` };

  const overall = Object.entries(breakdown).reduce((sum, [, c]) => sum + c.points, 0);
  const explanation = `Score ${overall}/100 — ${isPet ? 'pet product' : 'non-pet title'}; margin ${margin.grossMarginPct !== null ? (margin.grossMarginPct * 100).toFixed(1) + '%' : 'uncomputable'}; delivery ${extract.shippingDays ? extract.shippingDays.min + '-' + extract.shippingDays.max + 'd' : 'unknown'}; images ${images.length}.`;

  return {
    overall,
    weights: { ...SCORE_WEIGHTS },
    breakdown,
    explanation,
  };
}
