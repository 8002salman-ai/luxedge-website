// ============================================================================
// LUXEDGE — /api/shippo (public, server-side Shippo proxy)
//
//   POST { action: 'validate' } → address validation outcome
//   POST { action: 'rates' }    → live US carrier rates for the cart+address
//
// The Shippo token NEVER leaves the server. Responses carry only safe,
// customer-facing data. Both actions are debounced/cached by the client and
// rate-limited here per IP.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, clientIp, InMemoryRateLimiter } from './_lib/providers.js';
import {
  addressIsComplete,
  fetchLiveRates,
  validateShippingAddress,
  type ShippingAddressInput,
} from './_lib/shippo.js';

const limiter = new InMemoryRateLimiter();

function parseAddress(body: Record<string, unknown>): ShippingAddressInput | null {
  const a = (body.address ?? {}) as Record<string, unknown>;
  const fullName = typeof a.fullName === 'string' ? a.fullName.trim() : '';
  const addressLine1 = typeof a.addressLine1 === 'string' ? a.addressLine1.trim() : '';
  const city = typeof a.city === 'string' ? a.city.trim() : '';
  const state = typeof a.state === 'string' ? a.state.trim() : '';
  const postalCode = typeof a.postalCode === 'string' ? a.postalCode.trim() : '';
  const country = typeof a.country === 'string' && a.country.trim() ? a.country.trim() : 'US';
  if (!fullName || !addressLine1 || !city || !state || !postalCode) return null;
  return {
    fullName,
    addressLine1,
    addressLine2: typeof a.addressLine2 === 'string' && a.addressLine2.trim() ? a.addressLine2.trim() : undefined,
    city,
    state,
    postalCode,
    country,
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  if (limiter.isLimited(`shippo:${clientIp(req)}`)) {
    sendJson(res, 429, { error: 'Too many requests. Please try again in a moment.' });
    return;
  }
  let body: unknown;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action === 'rates' ? 'rates' : 'validate';

  const address = parseAddress(b);
  if (!address) {
    sendJson(res, 400, { error: 'Complete shipping address is required (name, street, city, state, postal code).' });
    return;
  }
  if (!addressIsComplete(address)) {
    sendJson(res, 400, { error: 'Complete shipping address is required (name, street, city, state, postal code).' });
    return;
  }

  if (action === 'validate') {
    const outcome = await validateShippingAddress(address);
    sendJson(res, 200, outcome);
    return;
  }

  // action === 'rates'
  const rawItems = Array.isArray(b.items)
    ? b.items
        .map((raw) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const productId = String(it.productId || it.id || '').trim();
          const quantity = Math.max(1, Math.floor(Number(it.quantity) || 0));
          return { productId, quantity, weightOz: Number(it.weightOz) > 0 ? Number(it.weightOz) : 0 };
        })
        .filter((li) => li.productId && li.quantity > 0)
    : [];
  if (rawItems.length === 0) {
    sendJson(res, 400, { error: 'At least one cart item is required for shipping rates.' });
    return;
  }

  // Weights are resolved from the AUTHORITATIVE products table (weight_oz,
  // migration 0030) — the client never supplies parcel weight. Weightless or
  // unknown products mean live rates cannot be quoted honestly; the caller
  // falls back to the configured flat rate instead.
  const lineItems = await resolveWeightLines(rawItems);
  if (lineItems.length === 0 || lineItems.some((li) => !li.weightOz || li.weightOz <= 0)) {
    sendJson(res, 422, { error: 'Some items in your cart are missing shipping weight — flat-rate shipping applies.', rates: [] });
    return;
  }
  const rates = await fetchLiveRates({ address, lineItems });
  if (!rates.ok) {
    sendJson(res, rates.status, { error: rates.message, rates: [] });
    return;
  }
  sendJson(res, 200, { rates: rates.rates });
}

/** Map cart { productId, quantity } → Shippo weight lines via the products table. */
async function resolveWeightLines(raw: { productId: string; quantity: number; weightOz: number }[]): Promise<{ weightOz: number; quantity: number }[]> {
  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (base && key) {
    try {
      const q = raw.map((i) => `"${i.productId}"`).join(',');
      const res = await fetch(`${base}/rest/v1/products?id=in.(${q})&select=id,weight_oz`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ id: string; weight_oz: number | null }>;
        const weightById = new Map(rows.map((p) => [String(p.id), p.weight_oz === null || p.weight_oz === undefined ? 0 : Number(p.weight_oz)]));
        return raw
          .map((i) => ({ weightOz: Number(weightById.get(i.productId) || 0), quantity: i.quantity }))
          .filter((li) => li.quantity > 0);
      }
    } catch {
      // Fall through to honest unavailable below.
    }
  }
  return raw.map((i) => ({ weightOz: 0, quantity: i.quantity }));
}
