// ============================================================================
// LUXEDGE V2 — BROWSER CJ ADAPTER (Phase 4C)
//
// Implements SupplierDiscoveryAdapter for CJ in the BROWSER by proxying
// through the Luxedge server (/api/suppliers/cj). The browser never holds
// or sends CJ credentials — only the admin Supabase JWT (attached by the
// client) and plain query parameters travel. The server calls CJ.
// ============================================================================

import type {
  SupplierDiscoveryAdapter, SupplierSearchResult, SupplierSearchOptions,
  SupplierProductRecord, SupplierShippingEvidence, SupplierHealthResult,
  SupplierPointUsage,
} from '../types';
import { getAccessToken } from '../../../services/supabase';
import { cjSafeStatusFromHealth } from './health';
import { CJ_POINTS_BUDGET_PER_RUN, CJ_POINTS_HARD_MAX } from './points';

const ENDPOINT = '/api/suppliers/cj';

export const CJ_POINT_BUDGET_EXHAUSTED = 'CJ_POINT_BUDGET_EXHAUSTED';

async function call<T>(
  action: string,
  params: Record<string, string> = {},
  init: RequestInit = {},
  run?: { runId: string; runBudget: number }
): Promise<T & { code?: string; usage?: SupplierPointUsage }> {
  const token = getAccessToken();
  const qs = new URLSearchParams({
    action,
    ...(run ? { runId: run.runId, runBudget: String(Math.min(Math.max(run.runBudget, 50), CJ_POINTS_HARD_MAX)) } : {}),
    ...params,
  }).toString();
  const res = await fetch(`${ENDPOINT}?${qs}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `Supplier API error ${res.status}`);
  }
  return body as T & { code?: string; usage?: SupplierPointUsage };
}

/** Throw a catchable, distinguishable error when the server budget is exhausted. */
function ensureBudgetNotExhausted(body: { code?: string }): void {
  if (body.code === CJ_POINT_BUDGET_EXHAUSTED) {
    throw new Error(CJ_POINT_BUDGET_EXHAUSTED);
  }
}

interface CjSearchResponse {
  provider: string;
  health: string;
  records?: SupplierProductRecord[];
  warning?: string;
  points?: number;
}

interface CjFreightResponse {
  quotes?: SupplierShippingEvidence[];
  warning?: string;
  points?: number;
}

/** CJ adapter for the browser — talks ONLY to the Luxedge server proxy. */
export class CjSupplierAdapter implements SupplierDiscoveryAdapter {
  readonly provider = 'cj' as const;
  /** Run-scoped identifiers for server-authoritative budgeting (set by the engine). */
  runId: string | null = null;
  runBudget = CJ_POINTS_BUDGET_PER_RUN;

  private run(): { runId: string; runBudget: number } | undefined {
    return this.runId ? { runId: this.runId, runBudget: this.runBudget } : undefined;
  }

  /** Last server-authoritative usage seen (null until a paid call responds). */
  lastServerUsage: SupplierPointUsage | null = null;

  setRunScope(runId: string, budget: number): void {
    this.runId = runId;
    this.runBudget = budget;
    this.lastServerUsage = null;
  }

  /**
   * Start a DURABLE supplier run on the server: the server creates the
   * supplier_api_runs ledger row (migration 0008), clamps the requested
   * budget to the HARD MAX, and returns the authoritative run id. Every
   * subsequent paid call reserves points against THAT persisted run.
   */
  async startRun(requestedBudget?: number): Promise<{ runId: string; hardBudget: number } | null> {
    const data = await call<{ runId?: string | null; hardBudget?: number }>(
      'start',
      {},
      {
        method: 'POST',
        body: JSON.stringify({ provider: 'cj', requestedBudget: requestedBudget ?? CJ_POINTS_BUDGET_PER_RUN }),
      }
    );
    if (!data.runId) return null;
    this.runId = data.runId;
    this.runBudget = data.hardBudget ?? CJ_POINTS_HARD_MAX;
    this.lastServerUsage = data.usage ?? null;
    return { runId: data.runId, hardBudget: this.runBudget };
  }

  /** Mark the durable run finished on the server (best-effort). */
  async finishRun(status: 'completed' | 'failed' | 'exhausted'): Promise<void> {
    if (!this.runId) return;
    try {
      await call('finish', {}, {
        method: 'POST',
        body: JSON.stringify({ runId: this.runId, status }),
      }, this.run());
    } catch {
      /* best-effort — a failed finish must not break the run */
    }
  }

  /** Fetch the authoritative run usage from the server (no points consumed). */
  async getRunUsage(): Promise<SupplierPointUsage | null> {
    try {
      const data = await call<{ usage?: SupplierPointUsage }>('budget', {}, {}, this.run());
      if (data.usage) this.lastServerUsage = data.usage;
      return data.usage ?? this.lastServerUsage;
    } catch {
      return this.lastServerUsage;
    }
  }

  async searchProducts(opts: SupplierSearchOptions): Promise<SupplierSearchResult> {
    const params: Record<string, string> = { q: opts.query };
    if (opts.market) params.market = opts.market;
    if (opts.maxResults) params.size = String(opts.maxResults);
    if (opts.maxSupplierCost) params.maxCost = String(opts.maxSupplierCost);
    const data = await call<CjSearchResponse>('search', params, {}, this.run());
    ensureBudgetNotExhausted(data);
    if (data.usage) this.lastServerUsage = data.usage;
    return {
      records: Array.isArray(data.records) ? data.records : [],
      health: cjSafeStatusFromHealth(data.health),
      warning: data.warning,
      points: data.points,
      usage: data.usage,
    };
  }

  async getProduct(productId: string, market = 'US'): Promise<SupplierProductRecord | null> {
    const data = await call<{ record?: SupplierProductRecord | null; points?: number }>(
      'product', { pid: productId, market }, {}, this.run()
    );
    ensureBudgetNotExhausted(data);
    if (data.usage) this.lastServerUsage = data.usage;
    return data.record ?? null;
  }

  async getShippingEvidence(
    _productId: string,
    variantId: string,
    opts: { market?: string; originCountry?: string | null } = {}
  ): Promise<SupplierShippingEvidence> {
    const market = opts.market || 'US';
    // Origin comes from the SELECTED VARIANT's inventory/warehouse evidence.
    // No origin → freight UNKNOWN (never fabricate).
    if (!opts.originCountry) {
      return {
        costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
        arrivalDays: null, carrier: null, origin: null, destination: market, observedAt: new Date().toISOString(),
        verified: false,
        note: 'Origin UNKNOWN — freight not quoted (never fabricate an origin).',
      };
    }
    try {
      const data = await call<CjFreightResponse>(
        'freight',
        {},
        {
          method: 'POST',
          body: JSON.stringify({ vid: variantId, startCountryCode: opts.originCountry, endCountryCode: market }),
        },
        this.run()
      );
      ensureBudgetNotExhausted(data);
      if (data.usage) this.lastServerUsage = data.usage;
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      if (!quotes.length) {
        return {
          costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
          arrivalDays: null, carrier: null, origin: opts.originCountry, destination: market,
          observedAt: new Date().toISOString(), verified: false,
          note: 'CJ returned no freight quote for this variant',
        };
      }
      // Cheapest VERIFIED quote by usable total cost (totalPostageFee-preferred,
      // never just the headline logisticPrice). Real CJ numbers only.
      const best = quotes.reduce((a, b) => {
        const av = a.costUsd ?? Infinity;
        const bv = b.costUsd ?? Infinity;
        return bv < av ? b : a;
      }, quotes[0]);
      return {
        ...best,
        origin: best.origin || opts.originCountry,
        destination: best.destination || market,
        note: best.note || 'Freight quote from CJ logistic/freightCalculate (cheapest usable total)',
      };
    } catch (e) {
      return {
        costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
        arrivalDays: null, carrier: null, origin: opts.originCountry, destination: market,
        observedAt: new Date().toISOString(), verified: false,
        note: `Freight unavailable: ${(e as Error).message}`,
      };
    }
  }

  async healthCheck(): Promise<SupplierHealthResult> {
    const data = await call<{ provider: string; health: string; detail?: string }>('health');
    return { provider: 'cj', health: cjSafeStatusFromHealth(data.health), detail: data.detail };
  }
}
