// ============================================================================
// LUXEDGE V2 — MARKET PROVENANCE VERIFICATION (Phase 4C live-readiness)
//
// A BUSINESS qualification must be grounded in a REAL persisted
// MARKET_INTELLIGENCE agent job — never a client-supplied market score.
// Given a claimed marketAnalysisId, the supplier-search engine loads the job
// row from the DB and this module verifies:
//
//   type   = 'MARKET_INTELLIGENCE'
//   status = 'completed'
//   output.marketScore            (0..100, finite)
//   output.evidenceFingerprint    (non-empty)
//   observed_at                   (output.at / finished_at, parseable)
//   claimed fingerprint, when supplied, must MATCH the persisted job's
//     fingerprint (provenance: the run claims to follow THIS evidence).
//
// The derived marketScore / fingerprint / observed_at come from the persisted
// job only. No evidence ⇒ verification fails (fail closed): Market Score
// UNKNOWN, BUSINESS_QUALIFIED impossible. Deterministic MI analyses are valid
// provenance (the same job shape persists for AI and deterministic runs).
// ============================================================================

import type { MarketContext } from '../suppliers/types';

export interface VerifiedMarketContext {
  marketAnalysisId: string;
  opportunity?: string | null;
  hypothesis?: string | null;
  marketScore: number;
  evidenceFingerprint: string | null;
  observedAt: string | null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Verify a persisted MARKET_INTELLIGENCE agent job row against the claimed
 * context. Returns the VERIFIED market context (score from the DB) or null.
 * Null is returned for: missing job, wrong type, not completed, missing/
 * invalid marketScore, missing evidence fingerprint, invalid observed_at, or
 * a claimed fingerprint that does not match the persisted job's.
 */
export function verifyMarketIntelligenceJob(
  job: unknown,
  claimed?: MarketContext | null
): VerifiedMarketContext | null {
  if (!job || typeof job !== 'object') return null;
  const j = job as Record<string, unknown>;
  if (j.type !== 'MARKET_INTELLIGENCE') return null;
  if (j.status !== 'completed') return null;

  const out = (j.output && typeof j.output === 'object' ? j.output : {}) as Record<string, unknown>;
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

  return {
    marketAnalysisId: typeof j.id === 'string' && j.id ? j.id : claimed?.marketAnalysisId ?? '',
    opportunity: claimed?.opportunity ?? null,
    hypothesis: claimed?.hypothesis ?? null,
    marketScore: score,
    evidenceFingerprint: fp,
    observedAt: observed,
  };
}
