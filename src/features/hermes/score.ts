// ============================================================================
// LUXEDGE — HERMES RECOMMENDATION SCORING (Luxedge-owned, deterministic)
//
// Hermes data is RESEARCH EVIDENCE, never automatic truth. This module is
// Luxedge's own pre-screen for deciding whether a suggestion deserves deeper
// validation through Luxedge's existing product pipeline (supplier checks,
// real pricing, QA, and the existing Product/Market Score gates).
//
// Rules:
//   - Only fields actually present contribute points. Unknown stays unknown.
//   - No invented demand: Hermes's own claims (ratings, reviews, demand
//     evidence, competition) contribute only as "evidence completeness",
//     never as consumer demand or sales proof.
//   - Hermes confidence is ONE input with a capped weight.
//   - The score is deterministic and documented; it never bypasses Luxedge's
//     qualification gates and can never create/publish a product.
// ============================================================================

import type { HermesProductSuggestionInput, HermesRecommendationRow } from './types';

/** Map a stored recommendation row back to the input shape for scoring. */
export function recommendationRowToInput(row: Pick<HermesRecommendationRow, never> & Partial<HermesRecommendationRow>): HermesProductSuggestionInput {
  return {
    productName: row.product_name ?? '',
    category: row.category ?? undefined,
    subcategory: row.subcategory ?? undefined,
    brand: row.brand ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    supplier: row.supplier ?? undefined,
    supplierPrice: row.supplier_price ?? undefined,
    shippingCost: row.shipping_cost ?? undefined,
    landedCost: row.landed_cost ?? undefined,
    expectedSellingPrice: row.expected_selling_price ?? undefined,
    marginEstimate: row.margin_estimate ?? undefined,
    ratings: row.ratings ?? undefined,
    reviews: row.reviews ?? undefined,
    demandEvidence: row.demand_evidence ?? undefined,
    competition: row.competition ?? undefined,
    benefits: row.benefits ?? undefined,
    marketingPotential: row.marketing_potential ?? undefined,
    adsPotential: row.ads_potential ?? undefined,
    risks: row.risks ?? undefined,
    recommendation: row.recommendation ?? undefined,
    confidence: row.confidence ?? undefined,
  };
}

export interface ScoreBreakdown {
  economics: number;      // 0..30 — real cost/price/margin evidence
  marketEvidence: number; // 0..25 — completeness of market claims (not demand)
  clarity: number;        // 0..20 — product identity/narrative completeness
  riskNarrative: number;  // 0..15 — risks + marketing/ads narrative present
  confidence: number;     // 0..10 — Hermes's own confidence (capped input)
  total: number;          // 0..100
}

export interface ScoreResult {
  total: number;             // 0..100 (Luxedge Opportunity pre-score)
  breakdown: ScoreBreakdown;
  marginPercent: number | null; // computed from real fields only
  marginSource: 'landed_cost' | 'supplier_plus_shipping' | null;
  missing: string[];         // important unknown fields (for honest review)
}

/** Gross margin % from real fields only; null when no cost evidence exists. */
export function marginFrom(input: HermesProductSuggestionInput): {
  marginPercent: number | null;
  source: 'landed_cost' | 'supplier_plus_shipping' | null;
} {
  const price = input.expectedSellingPrice;
  if (!price || price <= 0) return { marginPercent: null, source: null };
  let cost: number | null = null;
  let source: 'landed_cost' | 'supplier_plus_shipping' | null = null;
  if (input.landedCost && input.landedCost > 0) {
    cost = input.landedCost;
    source = 'landed_cost';
  } else if (input.supplierPrice && input.supplierPrice > 0) {
    cost = input.supplierPrice + (input.shippingCost ?? 0);
    source = 'supplier_plus_shipping';
  }
  if (cost === null || cost <= 0) return { marginPercent: null, source: null };
  return { marginPercent: Math.round(((price - cost) / price) * 10000) / 100, source };
}

function marginPoints(margin: number | null): number {
  if (margin === null) return 0;
  if (margin >= 40) return 8;
  if (margin >= 30) return 6;
  if (margin >= 20) return 4;
  if (margin >= 10) return 2;
  return 1;
}

/** Deterministic Luxedge Opportunity pre-score for a Hermes product suggestion. */
export function scoreHermesRecommendation(input: HermesProductSuggestionInput): ScoreResult {
  const { marginPercent, source } = marginFrom(input);

  // --- economics (0..30) --------------------------------------------------
  let economics = 0;
  if (input.supplierPrice !== undefined) economics += 8;
  if (input.landedCost !== undefined) economics += 8;
  if (input.expectedSellingPrice !== undefined) economics += 6;
  economics += marginPoints(marginPercent);

  // --- market evidence completeness (0..25) — claims, not facts ----------
  let marketEvidence = 0;
  if (input.demandEvidence) marketEvidence += 7;
  if (input.competition) marketEvidence += 5;
  if (input.ratings !== undefined) marketEvidence += 5;
  if (input.reviews !== undefined) marketEvidence += 4;
  if (input.sourceUrl) marketEvidence += 4;

  // --- clarity (0..20) ----------------------------------------------------
  let clarity = 0;
  if (input.productName) clarity += 6;
  if (input.category) clarity += 5;
  if (input.benefits) clarity += 5;
  if (input.supplier) clarity += 4;

  // --- risk / narrative (0..15) -------------------------------------------
  let riskNarrative = 0;
  if (input.risks) riskNarrative += 6;
  if (input.marketingPotential) riskNarrative += 5;
  if (input.adsPotential) riskNarrative += 4;

  // --- Hermes confidence (0..10, one input only) --------------------------
  const confidence = input.confidence === undefined ? 0 : Math.round(Math.min(1, Math.max(0, input.confidence)) * 10);

  const total = Math.min(100, economics + marketEvidence + clarity + riskNarrative + confidence);
  const breakdown: ScoreBreakdown = { economics, marketEvidence, clarity, riskNarrative, confidence, total };

  const missing: string[] = [];
  if (marginPercent === null) missing.push('cost/margin evidence (supplier or landed cost + selling price)');
  if (!input.sourceUrl) missing.push('source URL');
  if (!input.supplier) missing.push('supplier name');
  if (!input.risks) missing.push('risk notes');

  return { total, breakdown, marginPercent, marginSource: source, missing };
}

/**
 * Mark which fields have been verified by Luxedge's own validation pipeline.
 * Everything starts as UNKNOWN at ingest (research claims). Only Luxedge can
 * flip a field to 'verified' after its own checks.
 */
export function validationFromRow(row: Pick<HermesRecommendationRow, 'validation'>): Record<string, { status: 'verified' | 'unknown'; note?: string }> {
  return { ...(row.validation ?? {}) };
}

/** Human label for a score band (Luxedge's own staging, not a qualification gate). */
export function scoreBand(total: number): 'thin' | 'moderate' | 'promising' | 'strong' {
  if (total < 40) return 'thin';
  if (total < 60) return 'moderate';
  if (total < 75) return 'promising';
  return 'strong';
}
