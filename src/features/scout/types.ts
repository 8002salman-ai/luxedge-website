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
  jobId: string;
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
