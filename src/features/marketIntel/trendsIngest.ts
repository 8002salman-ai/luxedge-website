// ============================================================================
// LUXEDGE — GOOGLE TRENDS OBSERVATION INGESTION (pure, worker-safe)
//
// The intake contract for Hermes trends results. Hermes executes the browser
// side (trends.google.com comparison) on the user's machine — this module is
// what turns the returned observations into an honest TREND_SCORE.
//
// Honesty rules (spec §2/§13):
//   - Direction is NEVER inferred from missing data: zero usable periods →
//     INSUFFICIENT_DATA with a null score.
//   - A single observed period signals a direction but never a STRONGLY_*
//     claim — that requires 2+ agreeing periods.
//   - Coverage (present periods / 4) is reported alongside the score so a
//     partial result can never masquerade as fully-evidenced.
//   - The parser is strict: unknown fields are dropped, non-numeric period
//     values are rejected (never coerced into fake numbers).
// ============================================================================

import type { TrendEvidence } from './types';
import { trendDirectionFromPoints, trendScore } from './trend';

export interface TrendsObservations {
  /** Optional keyword echo — must match the job's keyword when provided. */
  keyword?: string;
  /** Directional change per period, -100..100 (positive = rising). Null = not observed. */
  d30?: number | null;
  d90?: number | null;
  d365?: number | null;
  yoy?: number | null;
  risingQueries?: string[];
  relatedQueries?: string[];
  usRelevant?: boolean;
  observedAt?: string;
  note?: string;
}

export const PERIOD_KEYS = ['d30', 'd90', 'd365', 'yoy'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/**
 * Strict intake parser — a Hermes/API payload is never trusted raw. Rejects
 * non-object bodies, non-numeric/out-of-range period values, and non-string
 * arrays; drops unknown fields.
 */
export function parseTrendsObservations(
  body: unknown
): { ok: true; observations: TrendsObservations } | { ok: false; errors: string[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Invalid trends result payload — expected an object.'] };
  }
  const o = body as Record<string, unknown>;
  const errors: string[] = [];
  const out: TrendsObservations = {};

  if (o.keyword !== undefined) {
    if (typeof o.keyword !== 'string') errors.push('keyword must be a string.');
    else out.keyword = o.keyword.trim().slice(0, 120);
  }

  for (const k of PERIOD_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) {
      out[k] = null;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${k} must be a finite number (-100..100) or null.`);
      continue;
    }
    if (v < -100 || v > 100) {
      errors.push(`${k} must be within -100..100.`);
      continue;
    }
    out[k] = v;
  }

  for (const arrKey of ['risingQueries', 'relatedQueries'] as const) {
    const v = o[arrKey];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      errors.push(`${arrKey} must be an array of strings.`);
      continue;
    }
    out[arrKey] = v
      .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
      .map((s) => s.trim().slice(0, 80))
      .slice(0, 20);
  }

  if (o.usRelevant !== undefined) {
    if (typeof o.usRelevant !== 'boolean') errors.push('usRelevant must be a boolean.');
    else out.usRelevant = o.usRelevant;
  }
  if (o.observedAt !== undefined) {
    if (typeof o.observedAt !== 'string') errors.push('observedAt must be a string.');
    else out.observedAt = o.observedAt;
  }
  if (o.note !== undefined) {
    if (typeof o.note !== 'string') errors.push('note must be a string.');
    else out.note = o.note.trim().slice(0, 400);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, observations: out };
}

/** How much of the 4-period window was actually observed (0..1). */
export function trendsCoverage(o: TrendsObservations): { present: number; total: number; ratio: number } {
  const present = PERIOD_KEYS.filter((k) => o[k] !== null && o[k] !== undefined).length;
  return { present, total: PERIOD_KEYS.length, ratio: PERIOD_KEYS.length ? present / PERIOD_KEYS.length : 0 };
}

/**
 * Map verified observations into a TrendEvidence + coverage. Never fabricates:
 * zero usable periods → INSUFFICIENT_DATA / null score; a single period is
 * downgraded out of STRONGLY_RISING.
 */
export function trendEvidenceFromObservations(
  obs: TrendsObservations,
  fallbackCountry = 'US'
): { evidence: TrendEvidence; coverage: number } {
  const { present, total, ratio } = trendsCoverage(obs);
  let direction = trendDirectionFromPoints(obs.d30 ?? null, obs.d90 ?? null, obs.d365 ?? null, obs.yoy ?? null);
  // Honesty: STRONGLY_RISING requires 2+ agreeing periods. A single +80
  // observation is a RISING signal, not a strong multi-period claim.
  if (present === 1 && direction === 'STRONGLY_RISING') direction = 'RISING';
  const score = trendScore({
    direction,
    risingQueries: obs.risingQueries,
    relatedQueries: obs.relatedQueries,
    usRelevant: obs.usRelevant,
  });
  const note =
    present === 0
      ? 'No usable trends observations — direction INSUFFICIENT_DATA (never fabricated from missing data).'
      : `Hermes trends observations ingested: ${present} of ${total} periods (coverage ${Math.round(ratio * 100)}%).`;
  return {
    evidence: {
      status: 'AVAILABLE',
      keyword: obs.keyword || '',
      country: fallbackCountry,
      direction,
      score,
      relatedQueries: obs.relatedQueries,
      risingQueries: obs.risingQueries,
      note,
      source: 'hermes_browser',
    },
    coverage: ratio,
  };
}