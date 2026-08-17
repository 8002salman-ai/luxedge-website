// GET/POST /api/suppliers/cj
//
// Server-side CJ Dropshipping proxy. The browser NEVER holds CJ credentials
// and NEVER calls CJ directly — it calls THIS endpoint with the admin JWT;
// the server holds CJ_API_KEY and the access/refresh tokens.
//
// Actions (query param `action`):
//   health   → { provider:'cj', health, detail }  (no CJ call when unconfigured)
//   search   → ?action=search&q=...&market=US&size=30&maxCost=40&runId=...&runBudget=250
//              returns normalized SupplierProductRecord[] (admin-only)
//   product  → ?action=product&pid=...&market=US&runId=...&runBudget=250
//   freight  → POST { productId, vid, startCountryCode, endCountryCode } (+ runId/runBudget)
//
// AUTHORITATIVE POINT BUDGET: the client supplies a runId + requested budget
// for paid actions. The SERVER maintains the run-scoped budget and clamps the
// requested value to [listV2 cost, 250] — callers/AI can never raise it. Every
// actual paid outbound request (incl. retries) reserves its cost; when the
// budget cannot afford an attempt NO HTTP request is issued and the client
// receives { code: 'CJ_POINT_BUDGET_EXHAUSTED', usage }. The in-memory run map
// is per warm instance (honest limitation, like the token cache).
//
// SECURITY: admin JWT required; rate-limited; timeouts + capped retries;
// errors scrubbed of any credential-like strings. READ/RESEARCH ONLY — this
// endpoint can never place an order or trigger a payment.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  cjConfigured, cjAccessToken, cjSearchProducts, cjProductQuery, cjFreightCalculate, cjSafeError,
  CjServerRunBudget, CJ_POINT_BUDGET_EXHAUSTED, type CjServerPointUsage,
} from '../_lib/cj.js';
import {
  normalizeCjListProduct, normalizeCjProductDetail, normalizeCountryCode, normalizeCjFreight,
} from '../../src/features/suppliers/cj/normalize.js';
import { CJ_POINT_COST, CJ_POINTS_BUDGET_PER_RUN } from '../../src/features/suppliers/cj/points.js';

const MAX_SEARCH_SIZE = 100;

// Run-scoped budgets keyed by runId (per warm serverless instance). Capped in
// size to avoid unbounded growth; entries are best-effort per instance.
const RUN_BUDGETS = new Map<string, CjServerRunBudget>();
const MAX_RUN_BUDGETS = 200;

function runBudgetFor(req: IncomingMessage): CjServerRunBudget | null {
  const url = new URL(req.url || '/', 'http://localhost');
  const runId = (url.searchParams.get('runId') || '').trim();
  if (!runId) return null;
  let b = RUN_BUDGETS.get(runId);
  if (!b) {
    const requested = parseInt(url.searchParams.get('runBudget') || String(CJ_POINTS_BUDGET_PER_RUN), 10);
    b = new CjServerRunBudget(requested); // server clamps to ≤ 250
    if (RUN_BUDGETS.size >= MAX_RUN_BUDGETS) {
      // Simple eviction of the oldest entry to bound memory.
      const first = RUN_BUDGETS.keys().next().value;
      if (first) RUN_BUDGETS.delete(first);
    }
    RUN_BUDGETS.set(runId, b);
  }
  return b;
}

/** Attach usage to a response for a run. */
function usageOf(budget: CjServerRunBudget | null): CjServerPointUsage | undefined {
  return budget ? budget.usage() : undefined;
}

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

  // ---------------- budget (authoritative run usage) ----------------
  if (action === 'budget') {
    const budget = runBudgetFor(req);
    sendJson(res, 200, { provider: 'cj', health: 'online', usage: usageOf(budget) });
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
    const budget = runBudgetFor(req);

    try {
      const { products, total } = await cjSearchProducts({
        keyWord: q,
        size,
        countryCode: country ?? undefined,
        verifiedWarehouse: 1, // verified inventory preferred
        endSellPrice: maxCost,
      }, budget ?? undefined);
      const records = products
        .map((p) => normalizeCjListProduct(p as never, { market: country ?? undefined }))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      sendJson(res, 200, {
        provider: 'cj', health: 'online', records, total, query: q,
        points: CJ_POINT_COST.listV2,
        usage: usageOf(budget),
      });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', records: [],
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: usageOf(budget),
        });
        return;
      }
      sendJson(res, 200, {
        provider: 'cj',
        health: /rate limited/i.test(String(e)) ? 'rate_limited' : 'offline',
        records: [],
        warning: cjSafeError(e),
        usage: usageOf(budget),
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
    const budget = runBudgetFor(req);
    try {
      const detail = await cjProductQuery(pid, country ?? undefined, budget ?? undefined);
      const record = normalizeCjProductDetail(detail as never, { market: country ?? undefined });
      if (!record) {
        sendJson(res, 404, { error: 'CJ product not found or unverifiable' });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'online', record, points: CJ_POINT_COST.productQuery, usage: usageOf(budget) });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', record: null,
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: usageOf(budget),
        });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'offline', record: null, warning: cjSafeError(e), usage: usageOf(budget) });
    }
    return;
  }

  // ---------------- freight ----------------
  // Origin is NOT hardcoded: the client passes the SELECTED VARIANT's origin
  // (from inventory/warehouse evidence). When origin is genuinely unknown the
  // client should NOT call freight — it records freight UNKNOWN instead.
  if (action === 'freight' && req.method === 'POST') {
    const body = await readBody(req);
    const vid = String(body.vid || '').trim();
    const startCountryCode = String(body.startCountryCode || '').trim().toUpperCase();
    const endCountryCode = String(body.endCountryCode || 'US').trim().toUpperCase();
    if (!vid) {
      sendJson(res, 400, { error: 'A variant id (vid) is required for freight calculation' });
      return;
    }
    if (!startCountryCode) {
      sendJson(res, 200, {
        provider: 'cj', health: 'online', quotes: [], points: 0,
        warning: 'Origin UNKNOWN — freight not quoted (never fabricate an origin).',
      });
      return;
    }
    const budget = runBudgetFor(req);
    try {
      const quotes = await cjFreightCalculate({ startCountryCode, endCountryCode, vid }, budget ?? undefined);
      const normalized = (Array.isArray(quotes) ? quotes : [])
        .map((q) => normalizeCjFreight(q as never, { origin: startCountryCode, destination: endCountryCode }))
        .filter((q): q is NonNullable<typeof q> => q !== null);
      sendJson(res, 200, { provider: 'cj', health: 'online', quotes: normalized, points: CJ_POINT_COST.freightCalculate, usage: usageOf(budget) });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', quotes: [],
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: usageOf(budget),
        });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'offline', quotes: [], warning: cjSafeError(e), usage: usageOf(budget) });
    }
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
