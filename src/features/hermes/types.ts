// ============================================================================
// LUXEDGE — HERMES INTELLIGENCE TYPES
//
// Hermes (via Salman OS) is an OPTIONAL external intelligence source.
// Everything stored under src/features/hermes is RESEARCH EVIDENCE ONLY.
// Luxedge's own engines validate, score, and decide. These types mirror the
// migration-0012 table shapes so the generic DbAdapter can persist them.
// ============================================================================

export type HermesRecommendationStatus = 'new' | 'reviewed' | 'accepted' | 'rejected' | 'imported';
export type HermesSeoStatus = 'new' | 'reviewed' | 'accepted' | 'rejected' | 'implemented';
export type HermesIntelStatus = 'new' | 'reviewed' | 'dismissed';
export type AdsReadinessLevel = 'insufficient_data' | 'possible' | 'promising' | 'strong';

export interface HermesRecommendationRow {
  id: string;
  source: string;
  source_ref: string | null;
  received_via: string;
  product_name: string;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  source_url: string | null;
  supplier: string | null;
  supplier_price: number | null;
  currency: string;
  shipping_cost: number | null;
  landed_cost: number | null;
  delivery_estimate: string | null;
  expected_selling_price: number | null;
  margin_estimate: number | null;
  ratings: number | null;
  reviews: number | null;
  demand_evidence: string | null;
  competition: string | null;
  benefits: string | null;
  marketing_potential: string | null;
  ads_potential: string | null;
  risks: string | null;
  recommendation: string | null;
  confidence: number | null;
  status: HermesRecommendationStatus;
  review_note: string | null;
  luxedge_score: number | null;
  validation: Record<string, { status: 'verified' | 'unknown'; note?: string }>;
  created_at: string;
  updated_at: string;
}

export interface HermesSeoSuggestionRow {
  id: string;
  source: string;
  source_ref: string | null;
  project: string;
  url: string | null;
  suggestion_type: 'keyword' | 'title' | 'meta_description' | 'content' | 'internal_link' | 'category' | 'topic_cluster' | 'marketing_language' | 'other';
  recommendation: string;
  evidence: string | null;
  keyword: string | null;
  intent: string | null;
  priority: 'low' | 'medium' | 'high';
  confidence: number | null;
  status: HermesSeoStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface HermesMarketingIntelRow {
  id: string;
  source: string;
  source_ref: string | null;
  intel_type: 'market' | 'positioning' | 'competitor' | 'trend' | 'seasonal' | 'bundle' | 'promotion' | 'content' | 'email' | 'social' | 'audience' | 'offer' | 'other';
  title: string;
  summary: string;
  details: Record<string, unknown>;
  confidence: number | null;
  status: HermesIntelStatus;
  created_at: string;
  updated_at: string;
}

export interface AdsReadinessRow {
  id: string;
  product_id: string | null;
  recommendation_id: string | null;
  selling_price: number | null;
  landed_cost: number | null;
  gross_margin: number | null;
  estimated_variable_costs: number | null;
  contribution_margin: number | null;
  break_even_cac: number | null;
  allowable_cac: number | null;
  assessment: string | null;
  readiness: AdsReadinessLevel;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Ingest payloads (what Salman OS / Hermes may submit — strictly validated)
// ---------------------------------------------------------------------------

export interface HermesProductSuggestionInput {
  sourceRef?: string;
  productName: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  sourceUrl?: string;
  supplier?: string;
  supplierPrice?: number;
  currency?: string;
  shippingCost?: number;
  landedCost?: number;
  deliveryEstimate?: string;
  expectedSellingPrice?: number;
  marginEstimate?: number;
  ratings?: number;
  reviews?: number;
  demandEvidence?: string;
  competition?: string;
  benefits?: string;
  marketingPotential?: string;
  adsPotential?: string;
  risks?: string;
  recommendation?: string;
  confidence?: number;
}

export interface HermesSeoSuggestionInput {
  sourceRef?: string;
  url?: string;
  suggestionType?: HermesSeoSuggestionRow['suggestion_type'];
  recommendation: string;
  evidence?: string;
  keyword?: string;
  intent?: string;
  priority?: HermesSeoSuggestionRow['priority'];
  confidence?: number;
}

export interface HermesMarketingIntelInput {
  sourceRef?: string;
  intelType?: HermesMarketingIntelRow['intel_type'];
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  confidence?: number;
}

export type HermesIngestInput =
  | { kind: 'product'; data: HermesProductSuggestionInput }
  | { kind: 'seo'; data: HermesSeoSuggestionInput }
  | { kind: 'marketing'; data: HermesMarketingIntelInput };
