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
} from '../types';
import { getAccessToken } from '../../../services/supabase';
import { cjSafeStatusFromHealth } from './health';

const ENDPOINT = '/api/suppliers/cj';

async function call<T>(action: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const qs = new URLSearchParams({ action, ...params }).toString();
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
  return body as T;
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

  async searchProducts(opts: SupplierSearchOptions): Promise<SupplierSearchResult> {
    const params: Record<string, string> = { q: opts.query };
    if (opts.market) params.market = opts.market;
    if (opts.maxResults) params.size = String(opts.maxResults);
    if (opts.maxSupplierCost) params.maxCost = String(opts.maxSupplierCost);
    const data = await call<CjSearchResponse>('search', params);
    return {
      records: Array.isArray(data.records) ? data.records : [],
      health: cjSafeStatusFromHealth(data.health),
      warning: data.warning,
      points: data.points,
    };
  }

  async getProduct(productId: string, market = 'US'): Promise<SupplierProductRecord | null> {
    const data = await call<{ record?: SupplierProductRecord | null; points?: number }>('product', { pid: productId, market });
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
        }
      );
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
