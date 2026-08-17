// ============================================================================
// LUXEDGE V2 — PRODUCT SCOUT TYPES (Phase 4A)
//
// The scout pipeline researches real pet products, verifies the source,
// normalizes the data, scores the opportunity (100-point weighted), hard-
// rejects risky candidates, and shortlists the rest for owner approval.
//
// HONESTY CONTRACT: every fact carries an evidence status — VERIFIED (found
// in the fetched source), INFERRED (computed/derived, clearly labelled) or
// UNKNOWN. Nothing is invented; fields without evidence stay UNKNOWN/NULL.
// ============================================================================

/** Evidence status for a single observed fact. */
export type EvidenceStatus = 'verified' | 'inferred' | 'unknown';

export interface EvidenceItem {
  status: EvidenceStatus;
  value: unknown;
  /** Where the fact was observed (e.g. fetched page, source URL). */
  source?: string;
  note?: string;
}

/** Everything the scout knows (and does not know) about a candidate. */
export interface CandidateEvidence {
  sourceUrl: string;
  observedAt: string;
  title: EvidenceItem;
  supplierPrice: EvidenceItem;
  shippingCost: EvidenceItem;
  shippingDays: EvidenceItem;
  availability: EvidenceItem;
  images: EvidenceItem;
  /** Rating/review evidence found on the source page (never invented). */
  rating: EvidenceItem;
  origin: EvidenceItem;
  category: EvidenceItem;
  sizes: EvidenceItem;
  unknownFields: string[];
  riskNotes: string[];
}

/** Pricing / margin model — calculated separately from scoring. */
export interface MarginCalc {
  supplierPrice: number | null;
  shippingCost: number | null;
  landedCost: number | null;
  /** Suggested Luxedge retail price (INFERRED from landed cost + markup). */
  proposedLuxedgePrice: number | null;
  grossMarginDollars: number | null;
  grossMarginPct: number | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

export interface ScoreCriterion {
  points: number;
  max: number;
  note: string;
}

export interface ScoreBreakdown {
  overall: number;
  weights: Record<string, number>;
  breakdown: Record<string, ScoreCriterion>;
  explanation: string;
}

export type CandidateStatus = 'researching' | 'qualified' | 'rejected' | 'approved' | 'failed';

export interface ScoutCandidate {
  id: string;
  title: string;
  /** Supplier name derived from the source domain. */
  source: string;
  sourceUrl: string;
  supplierSlug: string;
  supplierProductId?: string;
  images: string[];
  evidence: CandidateEvidence;
  margin: MarginCalc;
  score: ScoreBreakdown | null;
  status: CandidateStatus;
  rejectionReason?: string;
  createdAt: string;
}

export interface ScoutRunResult {
  /** PRODUCT_RESEARCH job id. */
  jobId: string;
  /** PRODUCT_SCORE job id. */
  scoreJobId?: string;
  /** PRODUCT_QA job id. */
  qaJobId?: string;
  researched: number;
  rejected: number;
  shortlisted: number;
  failed: number;
  candidates: ScoutCandidate[];
}

/** A page fetched from the wild, pre-extraction. */
export interface FetchedSourcePage {
  text: string;
  images: string[];
}

/** Minimal durable record persisted for a supplier. */
export interface ScoutSupplier {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
}

/** Raw page facts extracted by rule-based parsing (no AI required). */
export interface PageExtract {
  title: string | null;
  price: number | null;
  images: string[];
  availability: 'available' | 'unavailable' | 'unknown';
  shippingDays: { min: number; max: number } | null;
  freeShipping: boolean;
  rating: number | null;
  reviewCount: number | null;
  origin: string | null;
  sizes: string[] | null;
}

// ---------------------------------------------------------------------------
// Phase 4B — Market Intelligence + Guarded Autonomy
// ---------------------------------------------------------------------------

/** A single collected market signal (evidence-based, never invented). */
export interface MarketSignal {
  id: string;
  /** e.g. 'search_pattern', 'price_range', 'rating_evidence', 'availability', 'competition', 'product_concept'. */
  signalType: string;
  source: string;
  sourceUrl: string;
  observedAt: string;
  /** Human-readable summary of the observed signal. */
  summary: string;
  confidence: 'verified' | 'inferred' | 'unknown';
  /** What this signal does NOT prove (honesty guard). */
  limitations: string;
}

/** Market analysis result (AI-grounded or deterministic fallback). */
export interface MarketAnalysis {
  /** Separate 100-pt market opportunity score (NOT the product score). */
  marketOpportunityScore: number;
  trendConfidence: 'verified' | 'inferred' | 'unknown';
  demandEvidence: string;
  competitionLevel: 'low' | 'medium' | 'high' | 'unknown';
  customerPainPoint: string | null;
  priceBand: { min: number; max: number } | null;
  risks: string[];
  recommendedSearchQueries: string[];
  reasoningSummary: string;
  /** true when DeepSeek produced this analysis over the collected signals. */
  aiUsed: boolean;
  model?: string;
  /** Claims the AI proposed that had NO supporting evidence and were removed. */
  unsupportedClaims: string[];
  analyzedAt: string;
}

/** Final combined opportunity score — documented formula, not a silent swap. */
export interface FinalOpportunityScore {
  productScore: number;
  marketScore: number;
  /** Formula weights (default product 0.7 / market 0.3). */
  productWeight: number;
  marketWeight: number;
  overall: number;
  formula: string;
}

/** Listing generated for an approved candidate (always a DB draft). */
export interface ListingDraft {
  title: string;
  shortDescription: string;
  longDescription: string;
  features: string[];
  benefits: string[];
  specifications: Record<string, string>;
  seoTitle: string;
  metaDescription: string;
  keywords: string[];
  imageAlts: string[];
  faqs: { q: string; a: string }[];
}

/** Factual-QA classification of one listing claim against source evidence. */
export type ClaimStatus = 'supported' | 'unsupported' | 'unknown';

export interface ListingClaim {
  claim: string;
  status: ClaimStatus;
  /** Why this classification (which evidence field supports/contradicts it). */
  reason: string;
}

/** Result of the listing factual-QA pass. */
export interface ListingQAResult {
  claims: ListingClaim[];
  /** false when any important claim is UNSUPPORTED → listing must be corrected. */
  passed: boolean;
  unsupported: string[];
  unknown: string[];
}

// ---------------------------------------------------------------------------
// Autonomy policy
// ---------------------------------------------------------------------------

export type AutonomyMode = 'MANUAL' | 'REVIEW' | 'AUTO';

/** Configurable autonomy thresholds (admin-settable). */
export interface AutonomyConfig {
  mode: AutonomyMode;
  /** Minimum Product Score /100 to consider advancing. */
  productScoreThreshold: number;
  /** Minimum Market Opportunity Score /100 to consider advancing. */
  marketScoreThreshold: number;
  /** Minimum gross margin fraction (e.g. 0.4 = 40%). */
  minMarginPct: number;
  /** Maximum allowed unknown evidence fields before QA forces owner review. */
  maxUnknownFields: number;
  /** Require positive USA delivery evidence. */
  requireUsaDelivery: boolean;
  /** Require PRODUCT_QA pass before advancing. */
  requireQa: boolean;
  /** Emergency pause — when true NO auto approvals/drafts/publishing. */
  emergencyPause: boolean;
  /** Max DeepSeek calls per scout run (cost control). */
  maxAiCallsPerRun: number;
}

export interface AutonomyDecision {
  eligibleForAutoPublish: boolean;
  reason: string;
  /** Gates checked (each true = passed). */
  gates: Record<string, boolean>;
  needsOwnerAttention: boolean;
}

/** Owner attention queue item — surfaced only for meaningful decisions. */
export interface OwnerAttentionItem {
  id: string;
  candidateId: string | null;
  title: string;
  /** WHY owner attention is required. */
  reason: string;
  /** Recommended action. */
  recommendedAction: string;
  /** Risk if ignored. */
  riskIfIgnored: string;
  /** Evidence reference. */
  evidence: string;
  createdAt: string;
  status: 'pending' | 'resolved';
}
