// GET/POST /api/suppliers/cj
//
// Server-side CJ Dropshipping proxy. The browser NEVER holds CJ credentials
// and NEVER calls CJ directly — it calls THIS endpoint with the admin JWT;
// the server holds CJ_API_KEY and the access/refresh tokens.
//
// Actions (query param `action`):
//   health   → { provider:'cj', health, detail }  (no CJ call when unconfigured)
//   start    → POST { provider, requestedBudget } — creates the DURABLE run
//              ledger row (migration 0008) and returns { runId, hardBudget }.
//              The server clamps the budget to the HARD MAX (250).
//   search   → ?action=search&q=...&market=US&size=30&maxCost=40&runId=...
//   product  → ?action=product&pid=...&market=US&runId=...
//   freight  → POST { productId, vid, startCountryCode, endCountryCode, runId }
//   budget   → ?action=budget&runId=... — authoritative durable usage.
//   finish   → POST { runId, status: completed|failed|exhausted }
//
// AUTHORITATIVE POINT BUDGET (live-readiness fix): the durable ledger in
// Supabase (supplier_api_runs + reserve_supplier_api_points — migration 0008)
// is the source of truth. Every actual paid outbound CJ request (incl. every
// paid retry) reserves its cost ATOMICALLY in the DB before the HTTP request;
// when the budget cannot afford it NO HTTP request is issued and the client
// receives { code: 'CJ_POINT_BUDGET_EXHAUSTED', usage }. The ledger is shared
// across Vercel instances, cold starts and concurrent requests — the old
// per-warm-instance in-memory Map is NOT the authority anymore.
//
// SECURITY: admin JWT required (forwarded to the ledger RPC, which refuses
// non-admin callers); rate-limited; timeouts + capped retries; errors scrubbed
// of any credential-like strings. READ/RESEARCH ONLY — this endpoint can never
// place an order or trigger a payment.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin, getBearerToken } from '../_lib/auth.js';
import {
  cjConfigured, cjAccessToken, cjSearchProducts, cjProductQuery, cjFreightCalculate, cjSafeError,
  CjDurableRunLedger, CjDurableRunContext, CjServerRunBudget, CJ_POINT_BUDGET_EXHAUSTED,
  type CjRunContext, type CjServerPointUsage,
} from '../_lib/cj.js';
import {
  normalizeCjListProduct, normalizeCjProductDetail, normalizeCountryCode, normalizeCjFreight,
} from '../../src/features/suppliers/cj/normalize.js';
import { CJ_POINT_COST, CJ_POINTS_BUDGET_PER_RUN } from '../../src/features/suppliers/cj/points.js';

const MAX_SEARCH_SIZE = 100;

/**
 * Build the run context for a paid action.
 *  - runId present → DURABLE ledger context (authoritative). The run row must
 *    exist (created by action=start); missing → error, no paid calls.
 *  - runId absent → local in-memory forecast only (manual probe path) — never
 *    authoritative across instances.
 */
async function runContextFor(req: IncomingMessage): Promise<{ run: CjRunContext | null; error?: string }> {
  const url = new URL(req.url || '/', 'http://localhost');
  const runId = (url.searchParams.get('runId') || '').trim();
  if (!runId) {
    const requested = parseInt(url.searchParams.get('runBudget') || String(CJ_POINTS_BUDGET_PER_RUN), 10);
    return { run: new CjServerRunBudget(requested) };
  }
  const ledger = new CjDurableRunLedger(getBearerToken(req));
  let row: CjServerPointUsage | null = null;
  try {
    row = await ledger.usage(runId);
  } catch {
    row = null;
  }
  if (!row) return { run: null, error: 'Supplier run not found — call action=start first.' };
  return { run: new CjDurableRunContext(ledger, runId, row.budget) };
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

  // ---------------- start (create the DURABLE run) ----------------
  if (action === 'start' && req.method === 'POST') {
    const body = await readBody(req);
    const provider = String(body.provider || 'cj').slice(0, 40);
    const raw = body.requestedBudget;
    const requested = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : CJ_POINTS_BUDGET_PER_RUN;
    try {
      const ledger = new CjDurableRunLedger(getBearerToken(req));
      const started = await ledger.start(provider, Number.isFinite(requested) ? requested : CJ_POINTS_BUDGET_PER_RUN);
      sendJson(res, 200, { provider, runId: started.runId, hardBudget: started.usage.budget, usage: started.usage });
    } catch (e) {
      sendJson(res, 200, {
        provider, runId: null, health: 'offline',
        warning: `Supplier run could not be started — ${cjSafeError(e)}`,
      });
    }
    return;
  }

  // ---------------- budget (authoritative durable usage) ----------------
  if (action === 'budget') {
    const runId = (url.searchParams.get('runId') || '').trim();
    if (!runId) {
      sendJson(res, 400, { error: 'runId is required' });
      return;
    }
    try {
      const usage = await new CjDurableRunLedger(getBearerToken(req)).usage(runId);
      sendJson(res, 200, { provider: 'cj', health: usage ? 'online' : 'offline', usage });
    } catch (e) {
      sendJson(res, 200, { provider: 'cj', health: 'offline', warning: cjSafeError(e) });
    }
    return;
  }

  // ---------------- finish (mark the run completed/failed/exhausted) ----------------
  if (action === 'finish' && req.method === 'POST') {
    const body = await readBody(req);
    const runId = String(body.runId || '').trim();
    const status = ['completed', 'failed', 'exhausted'].includes(String(body.status)) ? String(body.status) : 'completed';
    if (!runId) {
      sendJson(res, 400, { error: 'runId is required' });
      return;
    }
    try {
      await new CjDurableRunLedger(getBearerToken(req)).finish(runId, status as 'completed' | 'failed' | 'exhausted');
      sendJson(res, 200, { provider: 'cj', runId, status });
    } catch (e) {
      sendJson(res, 200, { provider: 'cj', runId, status: 'unknown', warning: cjSafeError(e) });
    }
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
    const ctx = await runContextFor(req);
    if (ctx.error) {
      sendJson(res, 400, { error: ctx.error });
      return;
    }
    const run = ctx.run;

    try {
      const { products, total } = await cjSearchProducts({
        keyWord: q,
        size,
        countryCode: country ?? undefined,
        verifiedWarehouse: 1, // verified inventory preferred
        endSellPrice: maxCost,
      }, run ?? undefined);
      const records = products
        .map((p) => normalizeCjListProduct(p as never, { market: country ?? undefined }))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      sendJson(res, 200, {
        provider: 'cj', health: 'online', records, total, query: q,
        points: CJ_POINT_COST.listV2,
        usage: run?.usage() ?? undefined,
      });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', records: [],
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: run?.usage() ?? undefined,
        });
        return;
      }
      sendJson(res, 200, {
        provider: 'cj',
        health: /rate limited/i.test(String(e)) ? 'rate_limited' : 'offline',
        records: [],
        warning: cjSafeError(e),
        usage: run?.usage() ?? undefined,
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
    const ctx = await runContextFor(req);
    if (ctx.error) {
      sendJson(res, 400, { error: ctx.error });
      return;
    }
    const run = ctx.run;
    try {
      const detail = await cjProductQuery(pid, country ?? undefined, run ?? undefined);
      const record = normalizeCjProductDetail(detail as never, { market: country ?? undefined });
      if (!record) {
        sendJson(res, 404, { error: 'CJ product not found or unverifiable' });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'online', record, points: CJ_POINT_COST.productQuery, usage: run?.usage() ?? undefined });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', record: null,
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: run?.usage() ?? undefined,
        });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'offline', record: null, warning: cjSafeError(e), usage: run?.usage() ?? undefined });
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
    const ctx = await runContextFor(req);
    if (ctx.error) {
      sendJson(res, 400, { error: ctx.error });
      return;
    }
    const run = ctx.run;
    try {
      const quotes = await cjFreightCalculate({ startCountryCode, endCountryCode, vid }, run ?? undefined);
      const normalized = (Array.isArray(quotes) ? quotes : [])
        .map((q) => normalizeCjFreight(q as never, { origin: startCountryCode, destination: endCountryCode }))
        .filter((q): q is NonNullable<typeof q> => q !== null);
      sendJson(res, 200, { provider: 'cj', health: 'online', quotes: normalized, points: CJ_POINT_COST.freightCalculate, usage: run?.usage() ?? undefined });
    } catch (e) {
      if (e instanceof Error && e.message === CJ_POINT_BUDGET_EXHAUSTED) {
        sendJson(res, 200, {
          provider: 'cj', health: 'offline', quotes: [],
          code: CJ_POINT_BUDGET_EXHAUSTED,
          warning: 'CJ point budget exhausted — no further paid requests issued.',
          usage: run?.usage() ?? undefined,
        });
        return;
      }
      sendJson(res, 200, { provider: 'cj', health: 'offline', quotes: [], warning: cjSafeError(e), usage: run?.usage() ?? undefined });
    }
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
