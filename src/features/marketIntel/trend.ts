// ============================================================================
// LUXEDGE — GOOGLE TRENDS PROVIDER
//
// Priority:
//   A. Official Google Trends API (alpha) — used ONLY when configured.
//   B. Hermes browser fallback (trends.google.com) — queued, never blocking.
//   C. BigQuery public Google Trends dataset — trend discovery feed (optional).
//
// Honesty rule: never convert missing data into a fake positive score.
// ============================================================================

import type { TrendDirection, SourceStatus } from './types';

/** Config knobs (admin-provided via settings; absence = not configured). */
export interface TrendsConfig {
  officialApiEnabled?: boolean;
  country?: string;
  periods?: string[];
}

const DEFAULT_PERIODS = ['90 days', '12 months'];

/**
 * Classify a normalized direction from trend evidence. Deterministic so the
 * TREND_SCORE never depends on model mood.
 */
export function trendDirectionFromPoints(
  d30: number | null,
  d90: number | null,
  d365: number | null,
  yoy: number | null
): TrendDirection {
  const present = [d30, d90, d365, yoy].filter((x): x is number => x !== null && x !== undefined);
  if (!present.length) return 'INSUFFICIENT_DATA';
  const avg = present.reduce((a, b) => a + b, 0) / present.length;
  const anyRising = present.some((p) => p >= 40);
  const anyDeclining = present.some((p) => p <= -40);
  if (anyRising && !anyDeclining) return 'STRONGLY_RISING';
  if (avg > 15) return 'RISING';
  if (avg < -15) return 'DECLINING';
  if (anyDeclining && anyRising) return 'SEASONAL';
  if (Math.abs(avg) <= 15 && present.length >= 2) return 'STABLE';
  return 'INSUFFICIENT_DATA';
}

/**
 * TREND_SCORE /100 from verified data only.
 * - Direction carries most weight; rising related queries add; US relevance adds.
 * - Returns null (never a fake positive) when there is no verified data.
 */
export function trendScore(input: {
  direction: TrendDirection;
  risingQueries?: string[];
  relatedQueries?: string[];
  usRelevant?: boolean;
}): number | null {
  if (input.direction === 'INSUFFICIENT_DATA') return null;
  const base: Record<TrendDirection, number> = {
    STRONGLY_RISING: 85,
    RISING: 68,
    STABLE: 45,
    SEASONAL: 38,
    DECLINING: 15,
    INSUFFICIENT_DATA: 0,
  };
  let s = base[input.direction];
  const rising = input.risingQueries?.length ?? 0;
  s += Math.min(10, rising * 3);
  s += (input.relatedQueries?.length ?? 0) > 0 ? 2 : 0;
  s += input.usRelevant ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * A. Official Google Trends API — alpha. We never claim availability we can't
 * prove. When not configured the provider reports NOT_CONFIGURED and the app
 * continues normally (Hermes browser becomes the keyword fallback).
 */
export function officialTrendsStatus(cfg?: TrendsConfig): SourceStatus {
  if (!cfg?.officialApiEnabled) return 'NOT_CONFIGURED';
  // Official API access is alpha and gated by Google; unless the operator has
  // proven a working endpoint, we stay honest. Flip this only with a verified
  // integration + key.
  return 'NOT_CONFIGURED';
}

/**
 * B. Hermes browser fallback payload — the durable queue entry a Hermes
 * browser run picks up (trends.google.com comparison for the keyword).
 * Never blocks the research job; returns a queued marker.
 */
export function hermesTrendsTask(keyword: string, cfg?: TrendsConfig): {
  provider: 'hermes';
  stage: 'search';
  intent: 'google_trends_browser';
  keyword: string;
  country: string;
  periods: string[];
} {
  return {
    provider: 'hermes',
    stage: 'search',
    intent: 'google_trends_browser',
    keyword,
    country: cfg?.country || 'US',
    periods: cfg?.periods || DEFAULT_PERIODS,
  };
}

/** C. BigQuery trend-discovery feed config — cost-capped, US/international. */
export interface BigQueryTrendsConfig {
  enabled?: boolean;
  dataset?: string;
  country?: string;
  maxRows?: number;
}

export function bigQueryStatus(cfg?: BigQueryTrendsConfig): SourceStatus {
  if (!cfg?.enabled) return 'NOT_CONFIGURED';
  return 'AVAILABLE';
}
