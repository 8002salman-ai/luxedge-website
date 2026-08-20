// ============================================================================
// LUXEDGE V2 — SCOUT AI COST CONTROL (Phase 4B)
//
// DeepSeek calls cost money, so every AI call is gated:
//  1) Deterministic prefilter runs first — AI is only offered candidates that
//     already passed the hard gates (never the cheapest path in reverse).
//  2) Cache by evidence fingerprint — identical evidence never pays twice.
//  3) Max AI calls per run — hard cap, admin-configurable.
//  4) Token/cost metadata is recorded on the job when the provider reports it.
//
// The cache is in-memory for this phase (per browser session) and is
// explicitly NOT a global limiter — a future shared KV can implement the
// same interface.
// ============================================================================

import type { AutonomyConfig } from './types';

// ---------------------------------------------------------------------------
// Evidence fingerprint — stable hash of the evidence that actually matters.
// ---------------------------------------------------------------------------

/** Deterministic string fingerprint of evidence (no crypto needed). */
export function evidenceFingerprint(parts: (string | number | null | undefined)[]): string {
  const joined = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `fp-${h.toString(36)}`;
}

// ---------------------------------------------------------------------------
// In-memory AI call cache (per session)
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  result: string;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 200;

export function cacheGet(key: string): string | null {
  const e = cache.get(key);
  return e ? e.result : null;
}

export function cachePut(key: string, result: string): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { key, result, at: Date.now() });
}

/** Reset (test helper). */
export function clearAiCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Per-run AI call budget
// ---------------------------------------------------------------------------

export interface AiBudget {
  /** How many calls were actually made. */
  used: number;
  /** Whether the budget allowed the next call. */
  canCall: boolean;
}

export function makeAiBudget(maxCalls: number): { canCall: () => boolean; record: () => void; used: () => number } {
  let used = 0;
  return {
    canCall: () => used < Math.max(0, maxCalls),
    record: () => { used++; },
    used: () => used,
  };
}

// ---------------------------------------------------------------------------
// Deterministic prefilter — cheapest valid path runs FIRST.
// ---------------------------------------------------------------------------

export interface PrefilterInput {
  hardRejected: boolean;
  productScore: number | null;
  hasSourceCost: boolean;
  config: AutonomyConfig;
}

/**
 * Should this candidate be offered to the AI at all? Cheap deterministic
 * gates only — anything that clearly fails never consumes an AI call.
 */
export function aiPrefilter(input: PrefilterInput): { allow: boolean; reason: string } {
  if (input.hardRejected) return { allow: false, reason: 'hard-rejected — no AI spend' };
  if (input.productScore === null || input.productScore < input.config.productScoreThreshold * 0.7) {
    return { allow: false, reason: `product score ${input.productScore ?? 'n/a'} well below threshold — no AI spend` };
  }
  if (!input.hasSourceCost) return { allow: false, reason: 'no verified source cost — no AI spend' };
  return { allow: true, reason: 'passes deterministic prefilter' };
}

/** Fingerprint a candidate's evidence for cache lookups. */
export function candidateEvidenceKey(candidate: {
  sourceUrl: string;
  title: string;
  evidence: { supplierPrice?: { value: unknown }; shippingDays?: { value: unknown }; availability?: { value: unknown }; rating?: { value: unknown } };
}): string {
  const v = (x: unknown): string | number | null | undefined => (typeof x === 'number' || typeof x === 'string' || x === null || x === undefined ? x : JSON.stringify(x));
  return evidenceFingerprint([
    candidate.sourceUrl,
    candidate.title,
    v(candidate.evidence.supplierPrice?.value),
    v(candidate.evidence.shippingDays?.value),
    v(candidate.evidence.availability?.value),
    v(candidate.evidence.rating?.value),
  ]);
}
