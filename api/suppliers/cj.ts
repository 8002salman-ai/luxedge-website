// GET/POST /api/suppliers/cj
//
// Server-side CJ Dropshipping proxy. The browser NEVER holds CJ credentials
// and NEVER calls CJ directly — it calls THIS endpoint with the admin JWT;
// the server holds CJ_API_KEY and the access/refresh tokens.
//
// Actions (query param `action`):
//   health   → { provider:'cj', health, detail }  (no CJ call when unconfigured)
//   search   → ?action=search&q=...&market=US&size=30&maxCost=40
//              returns normalized SupplierProductRecord[] (admin-only)
//   product  → ?action=product&pid=...&market=US  detail+variants+inventory
//   freight  → POST { productId, vid, startCountryCode, endCountryCode }
//
// SECURITY: admin JWT required; rate-limited; timeouts + capped retries;
// errors scrubbed of any credential-like strings. READ/RESEARCH ONLY — this
// endpoint can never place an order or trigger a payment.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  cjConfigured, cjAccessToken, cjSearchProducts, cjProductQuery, cjFreightCalculate, cjSafeError,
} from '../_lib/cj.js';
import {
  normalizeCjListProduct, normalizeCjProductDetail, normalizeCountryCode,
} from '../../src/features/suppliers/cj/normalize.js';

const MAX_SEARCH_SIZE = 100;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) break;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const url = new URL(req.url || '/', 'http://localhost');
  const action = (url.searchParams.get('action') || 'health').toLowerCase();

  // ---------------- health ----------------
  if (action === 'health') {
    if (!cjConfigured()) {
      sendJson(res, 200, {
        provider: 'cj',
        health: 'not_configured',
        detail: 'CJ_API_KEY is not set in the server environment. Supplier discovery returns zero records until it is configured.',
      });
      return;
    }
    try {
      await cjAccessToken(); // cheapest real auth probe
      sendJson(res, 200, { provider: 'cj', health: 'online', detail: 'CJ authentication succeeded' });
    } catch (e) {
      sendJson(res, 200, { provider: 'cj', health: 'offline', detail: cjSafeError(e) });
    }
    return;
  }

  if (!cjConfigured()) {
    sendJson(res, 200, {
      provider: 'cj',
      health: 'not_configured',
      records: [],
      warning: 'CJ_API_KEY is not configured on the server — add it to the server env (never the browser).',
    });
    return;
  }

  // ---------------- search ----------------
  if (action === 'search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    if (!q) {
      sendJson(res, 400, { error: 'A search query (q) is required' });
      return;
    }
    const market = (url.searchParams.get('market') || 'US').trim();
    const sizeRaw = parseInt(url.searchParams.get('size') || '30', 10);
    const size = Number.isFinite(sizeRaw) ? Math.min(Math.max(1, sizeRaw), MAX_SEARCH_SIZE) : 30;
    const maxCostRaw = parseFloat(url.searchParams.get('maxCost') || '');
    const maxCost = Number.isFinite(maxCostRaw) && maxCostRaw > 0 ? maxCostRaw : undefined;
    const country = normalizeCountryCode(market);

    try {
      const { products, total } = await cjSearchProducts({
        keyWord: q,
        size,
        countryCode: country ?? undefined,
        verifiedWarehouse: 1, // verified inventory preferred
        endSellPrice: maxCost,
      });
      const records = products
        .map((p) => normalizeCjListProduct(p as never, { market: country ?? undefined }))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      sendJson(res, 200, { provider: 'cj', health: 'online', records, total, query: q });
    } catch (e) {
      sendJson(res, 200, {
        provider: 'cj',
        health: /rate limited/i.test(String(e)) ? 'rate_limited' : 'offline',
        records: [],
        warning: cjSafeError(e),
      });
    }
    return;
  }

  // ---------------- product detail ----------------
  if (action === 'product') {
    const pid = (url.searchParams.get('pid') || '').trim().slice(0, 200);
    if (!pid) {
      sendJson(res, 400, { error: 'A product id (pid) is required' });
      return;
    }
    const market = (url.searchParams.get('market') || 'US').trim();
    const country = normalizeCountryCode(market);
    try {
      const detail = await cjProductQuery(pid, country ?? undefined);
      const record = normalizeCjProductDetail(detail as never, { market: country ?? undefined });
      if (!record) {
        sendJson(res, 404, { error: 'CJ product not found or unverifiable' });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'online', record });
    } catch (e) {
      sendJson(res, 200, { provider: 'cj', health: 'offline', record: null, warning: cjSafeError(e) });
    }
    return;
  }

  // ---------------- freight ----------------
  if (action === 'freight' && req.method === 'POST') {
    const body = await readBody(req);
    const vid = String(body.vid || '').trim();
    const startCountryCode = String(body.startCountryCode || 'CN').trim().toUpperCase();
    const endCountryCode = String(body.endCountryCode || 'US').trim().toUpperCase();
    if (!vid) {
      sendJson(res, 400, { error: 'A variant id (vid) is required for freight calculation' });
      return;
    }
    try {
      const quotes = await cjFreightCalculate({ startCountryCode, endCountryCode, vid });
      sendJson(res, 200, { provider: 'cj', health: 'online', quotes });
    } catch (e) {
      sendJson(res, 200, { provider: 'cj', health: 'offline', quotes: [], warning: cjSafeError(e) });
    }
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
