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
}

interface CjFreightResponse {
  quotes?: { logisticName?: string; logisticPrice?: number; logisticAging?: string }[];
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
    };
  }

  async getProduct(productId: string, market = 'US'): Promise<SupplierProductRecord | null> {
    const data = await call<{ record?: SupplierProductRecord | null }>('product', { pid: productId, market });
    return data.record ?? null;
  }

  async getShippingEvidence(
    _productId: string,
    variantId: string,
    opts: { market?: string } = {}
  ): Promise<SupplierShippingEvidence> {
    const market = opts.market || 'US';
    try {
      const data = await call<CjFreightResponse>(
        'freight',
        {},
        {
          method: 'POST',
          body: JSON.stringify({ vid: variantId, startCountryCode: 'CN', endCountryCode: market }),
        }
      );
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      if (!quotes.length) {
        return { costUsd: null, arrivalDays: null, carrier: null, verified: false, note: 'CJ returned no freight quote for this variant' };
      }
      // Cheapest verified quote — real CJ numbers, never invented.
      const best = quotes.reduce((a, b) => ((b.logisticPrice ?? Infinity) < (a.logisticPrice ?? Infinity) ? b : a), quotes[0]);
      return {
        costUsd: typeof best.logisticPrice === 'number' && Number.isFinite(best.logisticPrice) ? best.logisticPrice : null,
        arrivalDays: best.logisticAging || null,
        carrier: best.logisticName || null,
        verified: true,
        note: 'Freight quote from CJ logistic/freightCalculate (cheapest option)',
      };
    } catch (e) {
      return {
        costUsd: null, arrivalDays: null, carrier: null, verified: false,
        note: `Freight unavailable: ${(e as Error).message}`,
      };
    }
  }

  async healthCheck(): Promise<SupplierHealthResult> {
    const data = await call<{ provider: string; health: string; detail?: string }>('health');
    return { provider: 'cj', health: cjSafeStatusFromHealth(data.health), detail: data.detail };
  }
}
