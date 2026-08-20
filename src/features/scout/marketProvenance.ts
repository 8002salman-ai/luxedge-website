// ============================================================================
// LUXEDGE V2 — MARKET PROVENANCE VERIFICATION (Phase 4C live-readiness +
// migration-security revision)
//
// A BUSINESS qualification must be grounded in a REAL persisted
// MARKET_INTELLIGENCE agent job — never a client-supplied market score.
// Given a claimed marketAnalysisId, the supplier-search engine loads the job
// row from the DB and this module verifies:
//
//   type   = 'MARKET_INTELLIGENCE'
//   status = 'completed'
//   output.evidenceQuality      = 'sufficient'   (Phase 4E.1 fail-closed)
//   output.qualificationEligible = true          (Phase 4E.1 fail-closed)
//   output.marketScore            (0..100, finite — QUALIFYING score)
//   output.evidenceFingerprint    (non-empty)
//   observed_at                   (output.at / finished_at, parseable)
//   claimed fingerprint, when supplied, must MATCH the persisted job's
//     fingerprint (provenance: the run claims to follow THIS evidence).
//
// An insufficient-evidence job is rejected for qualification even when its
// diagnostic deterministic score happens to be >= 60 — a diagnostic score is
// NEVER a qualification-capable Market Opportunity Score.
//
// QUERY PROVENANCE (owner audit §10): the ACTUAL supplier search query must be
// verified against the recommendations persisted on the MI job
// (output.recommendedSearchQueries — persisted by runMarketIntelligenceJob).
// The engine passes the real search.query; a normalized exact match against a
// persisted recommendation yields queryProvenance = 'verified'. If the query
// does NOT match a persisted recommendation (or the job persisted none), the
// market score is treated as UNKNOWN for qualification and BUSINESS_QUALIFIED
// is impossible — the search still works as PRODUCT research.
//
// VERIFIED vs CLIENT LABELS (§11): every VERIFIED field (marketAnalysisId,
// opportunity, recommendedSearchQueries, hypothesis, marketScore,
// evidenceFingerprint, observedAt) is derived ONLY from the persisted job.
// Client-supplied labels (claimed.opportunity / claimed.hypothesis / claimed
// .marketScore) are reported separately as clientLabels and are NEVER treated
// as verified.
// ============================================================================

import type { MarketContext } from '../suppliers/types';

export interface VerifiedMarketContext {
  /** MI job id from the persisted row (never the client claim). */
  marketAnalysisId: string;
  /** Opportunity/category persisted on the MI job output (DB), if any. */
  opportunity: string | null;
  /** Search recommendations persisted on the MI job output (DB). */
  recommendedSearchQueries: string[];
  /**
   * The persisted recommendation the ACTUAL supplier search query matched —
   * null when queryProvenance is 'unverified'.
   */
  hypothesis: string | null;
  /** Market Opportunity Score /100 — from the persisted job (DB). */
  marketScore: number;
  evidenceFingerprint: string;
  observedAt: string;
  /**
   * Whether the ACTUAL supplier search query matches a persisted
   * recommendation. 'unverified' ⇒ Market Score is UNKNOWN for qualification
   * (BUSINESS_QUALIFIED impossible); PRODUCT_SHORTLISTED still allowed.
   */
  queryProvenance: 'verified' | 'unverified';
  /** Client-supplied labels — reported for transparency, NEVER verified. */
  clientLabels: { opportunity?: string | null; hypothesis?: string | null; marketScore?: number | null };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Normalize a query for comparison: lowercase, collapse non-alphanumerics. */
export function normalizeMarketQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function recommendationList(out: Record<string, unknown>): string[] {
  const recs = out.recommendedSearchQueries;
  if (!Array.isArray(recs)) return [];
  return recs.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}

/**
 * Verify a persisted MARKET_INTELLIGENCE agent job row against the claimed
 * context AND the actual supplier search query. Returns the VERIFIED market
 * context (every value from the DB) or null.
 *
 * Null is returned for: missing job, wrong type, not completed, insufficient
 * evidence (evidenceQuality != 'sufficient'), qualificationEligible != true,
 * missing/invalid marketScore, missing evidence fingerprint, invalid
 * observed_at, or a claimed fingerprint that does not match the persisted
 * job's.
 *
 * queryProvenance is 'verified' only when the normalized searchQuery matches a
 * persisted recommendedSearchQueries entry; otherwise 'unverified' (the job is
 * still real, but the query cannot be proven to follow its evidence).
 */
export function verifyMarketIntelligenceJob(
  job: unknown,
  claimed?: MarketContext | null,
  searchQuery?: string | null
): VerifiedMarketContext | null {
  if (!job || typeof job !== 'object') return null;
  const j = job as Record<string, unknown>;
  if (j.type !== 'MARKET_INTELLIGENCE') return null;
  if (j.status !== 'completed') return null;

  const out = (j.output && typeof j.output === 'object' ? j.output : {}) as Record<string, unknown>;

  // Phase 4E.1 FAIL-CLOSED: a job is eligible market provenance ONLY when the
  // evidence-quality gate passed (evidenceQuality 'sufficient' AND
  // qualificationEligible true). An insufficient-evidence job is rejected even
  // if its diagnostic score happens to be >= 60 — a diagnostic score is never
  // a qualification-capable Market Opportunity Score.
  if (out.evidenceQuality !== 'sufficient') return null;
  if (out.qualificationEligible !== true) return null;

  const score = out.marketScore;
  if (!isFiniteNumber(score) || score < 0 || score > 100) return null;

  const fp = typeof out.evidenceFingerprint === 'string' && out.evidenceFingerprint.trim()
    ? out.evidenceFingerprint.trim()
    : null;
  if (!fp) return null;

  // The persisted job itself is the provenance — a claimed fingerprint that
  // does not match it means the run is NOT grounded in this evidence.
  if (claimed?.evidenceFingerprint && claimed.evidenceFingerprint !== fp) return null;

  const observed =
    (typeof out.at === 'string' && out.at) ||
    (typeof j.finished_at === 'string' && j.finished_at) ||
    (typeof j.created_at === 'string' && j.created_at) ||
    null;
  if (!observed || Number.isNaN(Date.parse(observed))) return null;

  // QUERY PROVENANCE: the actual supplier search query must match a persisted
  // recommendation (normalized). No persisted recommendations ⇒ unverified.
  const recommendations = recommendationList(out);
  const normQuery = typeof searchQuery === 'string' && searchQuery.trim()
    ? normalizeMarketQuery(searchQuery)
    : '';
  const matched = normQuery && recommendations.length
    ? recommendations.find((r) => normalizeMarketQuery(r) === normQuery) ?? null
    : null;
  const queryProvenance: 'verified' | 'unverified' = matched ? 'verified' : 'unverified';

  // VERIFIED fields come from the DB only; client labels are separate.
  const clientLabels = {
    opportunity: claimed?.opportunity ?? null,
    hypothesis: claimed?.hypothesis ?? null,
    marketScore: claimed?.marketScore ?? null,
  };

  return {
    marketAnalysisId: typeof j.id === 'string' && j.id ? j.id : '',
    opportunity: typeof out.opportunity === 'string' && out.opportunity ? out.opportunity : null,
    recommendedSearchQueries: recommendations,
    hypothesis: matched,
    marketScore: score,
    evidenceFingerprint: fp,
    observedAt: observed,
    queryProvenance,
    clientLabels,
  };
}
