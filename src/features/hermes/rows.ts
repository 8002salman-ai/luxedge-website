// ============================================================================
// LUXEDGE — HERMES ROW BUILDERS (pure, dependency-free)
//
// Shared by:
//   - the browser admin repository (src/features/hermes/repository.ts)
//   - the serverless ingest route (api/hermes/ingest.ts)
//
// These functions turn validated research inputs into the exact snake_case
// row shapes of migration 0012. Nothing here can trigger execution, product
// creation, publishing, or any other Luxedge write — the rows are inert
// research evidence stored for Luxedge's own review pipeline.
// ============================================================================

import type {
  AdsReadinessRow,
  HermesMarketingIntelInput,
  HermesMarketingIntelRow,
  HermesProductSuggestionInput,
  HermesRecommendationRow,
  HermesSeoSuggestionInput,
  HermesSeoSuggestionRow,
} from './types';

function uid(): string {
  try {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Normalize a generic source string for provenance (defaults to hermes). */
function sourceOf(source: string | undefined, fallback = 'hermes'): string {
  const s = (source || '').trim();
  return s ? s.slice(0, 60) : fallback;
}

/** Build a hermes_recommendations row from a validated product input. */
export function productInputToRow(
  input: HermesProductSuggestionInput,
  opts: { receivedVia?: string; source?: string; sourceRef?: string } = {},
): HermesRecommendationRow {
  const now = new Date().toISOString();
  return {
    id: uid(),
    source: sourceOf(opts.source ?? input.sourceRef, 'hermes'),
    source_ref: opts.sourceRef ?? input.sourceRef ?? null,
    received_via: opts.receivedVia ?? 'salman_os',
    product_name: input.productName,
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    brand: input.brand ?? null,
    source_url: input.sourceUrl ?? null,
    supplier: input.supplier ?? null,
    supplier_price: input.supplierPrice ?? null,
    currency: input.currency ?? 'USD',
    shipping_cost: input.shippingCost ?? null,
    landed_cost: input.landedCost ?? null,
    delivery_estimate: input.deliveryEstimate ?? null,
    expected_selling_price: input.expectedSellingPrice ?? null,
    margin_estimate: input.marginEstimate ?? null,
    ratings: input.ratings ?? null,
    reviews: input.reviews ?? null,
    demand_evidence: input.demandEvidence ?? null,
    competition: input.competition ?? null,
    benefits: input.benefits ?? null,
    marketing_potential: input.marketingPotential ?? null,
    ads_potential: input.adsPotential ?? null,
    risks: input.risks ?? null,
    recommendation: input.recommendation ?? null,
    confidence: input.confidence ?? null,
    status: 'new',
    review_note: null,
    luxedge_score: null,
    validation: {},
    created_at: now,
    updated_at: now,
  };
}

/** Build a hermes_seo_suggestions row from a validated SEO input. */
export function seoInputToRow(
  input: HermesSeoSuggestionInput,
  opts: { source?: string; sourceRef?: string; project?: string } = {},
): HermesSeoSuggestionRow {
  const now = new Date().toISOString();
  return {
    id: uid(),
    source: sourceOf(opts.source ?? input.sourceRef, 'hermes'),
    source_ref: opts.sourceRef ?? input.sourceRef ?? null,
    project: opts.project ?? 'luxedge',
    url: input.url ?? null,
    suggestion_type: input.suggestionType ?? 'other',
    recommendation: input.recommendation,
    evidence: input.evidence ?? null,
    keyword: input.keyword ?? null,
    intent: input.intent ?? null,
    priority: input.priority ?? 'medium',
    confidence: input.confidence ?? null,
    status: 'new',
    review_note: null,
    created_at: now,
    updated_at: now,
  };
}

/** Build a hermes_marketing_intel row from a validated marketing input. */
export function marketingInputToRow(
  input: HermesMarketingIntelInput,
  opts: { source?: string; sourceRef?: string } = {},
): HermesMarketingIntelRow {
  const now = new Date().toISOString();
  return {
    id: uid(),
    source: sourceOf(opts.source ?? input.sourceRef, 'hermes'),
    source_ref: opts.sourceRef ?? input.sourceRef ?? null,
    intel_type: input.intelType ?? 'other',
    title: input.title,
    summary: input.summary,
    details: input.details ?? {},
    confidence: input.confidence ?? null,
    status: 'new',
    created_at: now,
    updated_at: now,
  };
}

/** Build an ads_readiness row (Luxedge's own economics assessment). */
export function adsReadinessToRow(
  assessment: Omit<AdsReadinessRow, 'id' | 'created_at' | 'updated_at'>,
): AdsReadinessRow {
  const now = new Date().toISOString();
  return {
    ...assessment,
    id: uid(),
    created_at: now,
    updated_at: now,
  };
}
