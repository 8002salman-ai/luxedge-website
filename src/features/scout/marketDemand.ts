// ============================================================================
// LUXEDGE V2 — MARKET DEMAND ADAPTER (Phase 4D, §9-§10)
//
// Provider-neutral interface for FUTURE official/permitted demand-data sources
// (e.g. Google Ads Keyword Planner: average monthly searches, keyword
// competition, historical metrics, geo=USA). Phase 4D deliberately requires NO
// new credentials and performs NO live demand calls — the default adapter is
// the no-op, so Market Intelligence simply proceeds without demand data.
//
// CJ `listedNum` / supplier listing count is NEVER routed through this
// interface and is NEVER treated as consumer demand (sales/orders/search
// volume/reviews) — it remains supplier/economics evidence only.
// ============================================================================

import type { MarketSignal } from './types';

export interface MarketDemandQuery {
  /** Market/category hypothesis, e.g. "dog travel accessories". */
  query: string;
  /** Target market (ISO-ish), e.g. "US". */
  market?: string;
}

export interface DemandSignalInput extends MarketDemandQuery {
  /** For future geo = USA / language filters. */
  geo?: string;
}

/**
 * A provider-neutral demand-data source. Implementations return ONLY evidence
 * that was actually observed/retrieved from an official permitted source.
 * Returning [] is always valid (no data) — it must never fabricate numbers.
 */
export interface MarketDemandAdapter {
  readonly provider: string;
  /** True when the adapter has valid server-side credentials configured. */
  readonly configured: boolean;
  /**
   * Fetch demand evidence (searches, competition, historical metrics). Never
   * invented: an adapter that cannot retrieve data returns [].
   */
  getDemandSignals(query: DemandSignalInput): Promise<MarketSignal[]>;
}

/**
 * Default adapter when no demand-data provider is configured. Always returns
 * zero signals — Market Intelligence never blocks on it.
 */
export class NoopMarketDemandAdapter implements MarketDemandAdapter {
  readonly provider = 'none';
  readonly configured = false;

  async getDemandSignals(): Promise<MarketSignal[]> {
    return [];
  }
}

/** Fold demand-adapter signals into the evidence pack (empty-safe). */
export async function collectDemandSignals(
  adapter: MarketDemandAdapter | undefined | null,
  query: MarketDemandQuery
): Promise<MarketSignal[]> {
  if (!adapter || !adapter.configured) return [];
  try {
    const signals = await adapter.getDemandSignals({ ...query, geo: query.market === 'US' || query.market === 'USA' ? 'US' : undefined });
    return Array.isArray(signals) ? signals : [];
  } catch {
    return []; // a failing demand source never breaks the deterministic pipeline
  }
}
