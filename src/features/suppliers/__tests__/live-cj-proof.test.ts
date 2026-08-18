// ============================================================================
// LUXEDGE V2 — LIVE CJ PROOF HARNESS (Phase 4C controlled run)
//
// Guarded by RUN_LIVE_CJ_PROOF=1 — NEVER runs in normal `npm test`/CI.
//
// Drives the REAL application architecture end to end:
//   * temporary admin user (GoTrue admin API, service role from .env) — deleted
//     in `finally` — whose JWT authenticates every admin route;
//   * the REAL deployed Vercel preview serverless proxy (/api/suppliers/cj and
//     /api/ai/generate) — the browser adapter equivalent with an absolute URL;
//   * the REAL Supabase DB (agent_jobs / supplier_api_runs / candidates …)
//     through the admin JWT;
//   * the REAL engine (runMarketIntelligenceJob → runSupplierSearch) with the
//     durable point ledger enforced server-side (migration 0008).
//
// SECURITY: no secrets in this file. VERCEL_PREVIEW_API, VERCEL_PREVIEW_BYPASS
// and the Supabase keys are read from the gitignored local .env at runtime.
// Nothing is printed except status codes, counts, scores and ids — never keys.
// ============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type {
  SupplierDiscoveryAdapter, SupplierSearchResult, SupplierSearchOptions,
  SupplierProductRecord, SupplierShippingEvidence, SupplierHealthResult,
  SupplierPointUsage,
} from '../types';
import { SupabaseAdapter } from '../../../services/db';
import { runMarketIntelligenceJob } from '../../scout/engine';
import { runSupplierSearch } from '../../scout/supplierSearch';

const ENABLED = process.env.RUN_LIVE_CJ_PROOF === '1';

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// LIVE-ONLY HELPERS
// ---------------------------------------------------------------------------

class LiveCjAdapter implements SupplierDiscoveryAdapter {
  readonly provider = 'cj' as const;
  private runId: string | null = null;
  private runBudget = 250;
  private lastServerUsage: SupplierPointUsage | null = null;

  constructor(private readonly base: string, private readonly jwt: string, private readonly bypass: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.jwt}` };
    if (this.bypass) h['x-vercel-protection-bypass'] = this.bypass;
    return h;
  }

  private async call<T>(action: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<T & { code?: string; usage?: SupplierPointUsage; warning?: string }> {
    const qs = new URLSearchParams({ action, ...(this.runId ? { runId: this.runId, runBudget: String(this.runBudget) } : {}), ...params }).toString();
    const res = await fetch(`${this.base}/api/suppliers/cj?${qs}`, { ...init, headers: { ...this.headers(), ...(init.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (body?.code === 'CJ_POINT_BUDGET_EXHAUSTED') throw new Error('CJ_POINT_BUDGET_EXHAUSTED');
    if (body?.code === 'CJ_DURABLE_LEDGER_UNAVAILABLE') throw new Error('CJ_DURABLE_LEDGER_UNAVAILABLE');
    if (!res.ok) throw new Error((body as { error?: string }).error || `Supplier API error ${res.status}`);
    return body as T & { code?: string; usage?: SupplierPointUsage; warning?: string };
  }

  async startRun(requestedBudget?: number): Promise<{ runId: string; hardBudget: number } | null> {
    const data = await this.call<{ runId?: string | null; hardBudget?: number; usage?: SupplierPointUsage }>(
      'start', {}, { method: 'POST', body: JSON.stringify({ provider: 'cj', requestedBudget: requestedBudget ?? 250 }) }
    );
    if (!data.runId) throw new Error('CJ_DURABLE_LEDGER_UNAVAILABLE');
    this.runId = data.runId;
    this.runBudget = data.hardBudget ?? 250;
    this.lastServerUsage = data.usage ?? null;
    return { runId: data.runId, hardBudget: this.runBudget };
  }

  async finishRun(status: 'completed' | 'failed' | 'exhausted'): Promise<void> {
    if (!this.runId) return;
    try {
      await this.call('finish', {}, { method: 'POST', body: JSON.stringify({ runId: this.runId, status }) });
    } catch { /* best-effort */ }
  }

  async getRunUsage(): Promise<SupplierPointUsage | null> {
    try {
      const data = await this.call<{ usage?: SupplierPointUsage }>('budget');
      if (data.usage) this.lastServerUsage = data.usage;
      return data.usage ?? this.lastServerUsage;
    } catch { return this.lastServerUsage; }
  }

  setRunScope(runId: string, budget: number): void {
    this.runId = runId;
    this.runBudget = budget;
    this.lastServerUsage = null;
  }

  async searchProducts(opts: SupplierSearchOptions): Promise<SupplierSearchResult> {
    const params: Record<string, string> = { q: opts.query };
    if (opts.market) params.market = opts.market;
    if (opts.maxResults) params.size = String(opts.maxResults);
    if (opts.maxSupplierCost) params.maxCost = String(opts.maxSupplierCost);
    const data = await this.call<{ records?: SupplierProductRecord[]; health: string; warning?: string; points?: number; usage?: SupplierPointUsage }>('search', params);
    if (data.usage) this.lastServerUsage = data.usage;
    return {
      records: Array.isArray(data.records) ? data.records : [],
      health: (data.health === 'online' || data.health === 'rate_limited' || data.health === 'offline' ? data.health : 'offline'),
      warning: data.warning,
      points: data.points,
      usage: data.usage,
    };
  }

  async getProduct(productId: string, market = 'US'): Promise<SupplierProductRecord | null> {
    const data = await this.call<{ record?: SupplierProductRecord | null; usage?: SupplierPointUsage }>('product', { pid: productId, market });
    if (data.usage) this.lastServerUsage = data.usage;
    return data.record ?? null;
  }

  async getShippingEvidence(_productId: string, variantId: string, opts: { market?: string; originCountry?: string | null } = {}): Promise<SupplierShippingEvidence> {
    const market = opts.market || 'US';
    if (!opts.originCountry) {
      return {
        costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
        arrivalDays: null, carrier: null, origin: null, destination: market,
        observedAt: new Date().toISOString(), verified: false,
        note: 'Origin UNKNOWN — freight not quoted (never fabricate an origin).',
      };
    }
    try {
      const data = await this.call<{ quotes?: SupplierShippingEvidence[]; usage?: SupplierPointUsage }>(
        'freight', {}, {
          method: 'POST',
          body: JSON.stringify({ vid: variantId, startCountryCode: opts.originCountry, endCountryCode: market }),
        }
      );
      if (data.usage) this.lastServerUsage = data.usage;
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      if (!quotes.length) {
        return {
          costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
          arrivalDays: null, carrier: null, origin: opts.originCountry, destination: market,
          observedAt: new Date().toISOString(), verified: false, note: 'CJ returned no freight quote for this variant',
        };
      }
      const best = quotes.reduce((a, b) => ((b.costUsd ?? Infinity) < (a.costUsd ?? Infinity) ? b : a), quotes[0]);
      return { ...best, origin: best.origin || opts.originCountry, destination: best.destination || market, note: best.note || 'Freight quote from CJ logistic/freightCalculate (cheapest usable total)' };
    } catch (e) {
      return {
        costUsd: null, baseFreightUsd: null, taxesFeeUsd: null, clearanceFeeUsd: null, tariffUsd: null,
        arrivalDays: null, carrier: null, origin: opts.originCountry, destination: market,
        observedAt: new Date().toISOString(), verified: false, note: `Freight unavailable: ${(e as Error).message}`,
      };
    }
  }

  async healthCheck(): Promise<SupplierHealthResult> {
    const data = await this.call<{ provider: string; health: string; detail?: string }>('health');
    const safe = data.health === 'online' || data.health === 'rate_limited' || data.health === 'offline' || data.health === 'not_configured' ? data.health : 'offline';
    return { provider: 'cj', health: safe, detail: data.detail };
  }
}

async function gotrue(base: string, serviceKey: string, path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/auth/v1${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, body };
}

describe.skipIf(!ENABLED)('LIVE CJ PROOF (RUN_LIVE_CJ_PROOF=1 only)', () => {
  it('runs the real MI → CJ pipeline against the deployed preview + real DB', async () => {
    const env = loadEnv('.env');
    const base = (env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const anonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
    const preview = (env.VERCEL_PREVIEW_API || process.env.VERCEL_PREVIEW_API || '').trim().replace(/\/$/, '');
    const bypass = (env.VERCEL_PREVIEW_BYPASS || process.env.VERCEL_PREVIEW_BYPASS || '').trim();
    if (!base || !serviceKey || !anonKey || !preview) {
      throw new Error('LIVE PROOF needs VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY / VERCEL_PREVIEW_API in .env');
    }

    // 1) Temporary admin user (deleted in finally) — the only way to exercise
    //    the admin-JWT-protected routes without the owner's password.
    const email = `cj-proof-${Date.now()}@luxedge.us`;
    const password = `Pw-${Date.now()}-x7q2`;
    const created = await gotrue(base, serviceKey, '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role: 'admin' } }),
    });
    // GoTrue returns 201 or 200 for a successful admin user creation.
    expect([200, 201]).toContain(created.status);
    const tempUserId = String(created.body.id || '');
    if (!tempUserId) throw new Error(`temp admin creation failed: ${JSON.stringify(created.body).slice(0, 200)}`);
    let adminJwt = '';
    try {
      const token = await gotrue(base, serviceKey, '/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      expect(token.status).toBe(200);
      adminJwt = String(token.body.access_token || '');
      if (!adminJwt) throw new Error('no access_token from temp admin sign-in');

      const db = new SupabaseAdapter(base, anonKey);
      db.setAccessToken(adminJwt);
      const adapter = new LiveCjAdapter(preview, adminJwt, bypass);

      // 2) CJ auth health — cheapest safe proof first (max 1 retry).
      let health: SupplierHealthResult | null = null;
      try {
        health = await adapter.healthCheck();
      } catch (e) {
        console.log(`[health] probe failed: ${(e as Error).message}`);
      }
      expect(health?.health).toBe('online');
      console.log(`[health] CJ Supplier API = ${health?.health}${health?.detail ? ` — ${health.detail}` : ''}`);

      // 3) Fresh grounded Market Intelligence pass(es) (DeepSeek via the real
      //    proxy). At most TWO materially different opportunities — never loop.
      const aiCall = async (prompt: string, model?: string) => {
        const res = await fetch(`${preview}/api/ai/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
          body: JSON.stringify({ provider: 'deepseek', model: model || 'deepseek-chat', prompt, system: 'You are Luxedge\'s USA pet-market analyst. Reason ONLY over the given evidence; never invent facts. Return STRICT JSON with keys: marketOpportunityScore, trendConfidence, demandEvidence, competitionLevel, customerPainPoint, priceBand, risks, recommendedSearchQueries, reasoningSummary.' }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`AI proxy HTTP ${res.status}`);
        const body = await res.json() as { text?: string };
        if (!body.text) throw new Error('AI proxy returned no text');
        return body.text;
      };

      const attempts = ['pet enrichment', 'dog travel accessories'];
      let mi: Awaited<ReturnType<typeof runMarketIntelligenceJob>> | null = null;
      for (const attempt of attempts) {
        mi = await runMarketIntelligenceJob({ query: attempt, market: 'US', db, aiCall, onProgress: (m) => console.log(`[mi] ${m}`) });
        console.log(`[mi] job ${mi.jobId} · query "${attempt}" · signals ${mi.signals} · market score ${mi.marketScore} · ai=${mi.aiUsed}`);
        const j = await db.get<Record<string, unknown>>('agent_jobs', mi.jobId);
        const o = (j && j.output && typeof j.output === 'object' ? j.output : {}) as Record<string, unknown>;
        const r = Array.isArray(o.recommendedSearchQueries) ? (o.recommendedSearchQueries as string[]).filter((x) => typeof x === 'string' && x.trim()) : [];
        if (mi.marketScore !== null && mi.marketScore >= 60 && r.length > 0) break;
        console.log(`MARKET OPPORTUNITY NOT STRONG ENOUGH for "${attempt}" (score=${mi.marketScore ?? 'UNKNOWN'}) — CJ search NOT run for it.`);
      }
      if (!mi) throw new Error('no MI attempt ran');

      const job = await db.get<Record<string, unknown>>('agent_jobs', mi.jobId);
      const out = (job && job.output && typeof job.output === 'object' ? job.output : {}) as Record<string, unknown>;
      const recs = Array.isArray(out.recommendedSearchQueries)
        ? (out.recommendedSearchQueries as string[]).filter((r) => typeof r === 'string' && r.trim())
        : [];

      // 4) MARKET GATE — if the grounded score < 60 after the attempts, do NOT
      //    run CJ (report winner NONE honestly).
      if (mi.marketScore === null || mi.marketScore < 60 || recs.length === 0) {
        console.log(`MARKET OPPORTUNITY NOT STRONG ENOUGH after attempts (best score=${mi.marketScore ?? 'UNKNOWN'}) — CJ search NOT run.`);
        console.log(`[result] ${JSON.stringify({ winner: 'NONE', marketScore: mi.marketScore, reason: 'market gate not met after at most 2 attempts', miJobId: mi.jobId })}`);
        return;
      }

      const query = recs[0];
      console.log(`[mi] selected persisted hypothesis: "${query}" (of ${recs.length} recommendations)`);

      // 5) ONE controlled market-grounded CJ search (durable 250-pt ledger).
      const result = await runSupplierSearch({
        adapter,
        search: {
          query,
          market: 'US',
          maxResults: 40,
          marketContext: { marketAnalysisId: mi.jobId, hypothesis: query, opportunity: String(out.opportunity ?? '') },
        },
        db,
        onProgress: (m) => console.log(`[cj] ${m}`),
      });

      const usage = await adapter.getRunUsage();
      console.log(`[result] ${JSON.stringify({
        miJobId: mi.jobId,
        marketScore: result.marketContext?.marketScore,
        queryProvenance: result.marketContext?.queryProvenance,
        searched: result.searched,
        duplicates: result.duplicates,
        prefilterRejected: result.prefilterRejected,
        researched: result.researched,
        rejected: result.rejected,
        productShortlisted: result.productShortlisted,
        qaPassed: result.qaPassed,
        businessQualified: result.businessQualified,
        health: result.health,
        code: result.code ?? null,
        warning: result.warning ?? null,
        runUsage: usage,
        winner: result.businessQualified > 0 ? 'YES' : 'NONE',
        topCandidates: result.businessQualifiedCandidates.slice(0, 5).map((c) => ({
          title: c.title, productScore: c.productScore, marketScore: c.marketScore,
          finalOpportunityScore: c.finalOpportunityScore, landedCostConfidence: c.landedCostConfidence,
          usaDeliveryConfidence: c.usaDeliveryConfidence, marginPct: c.marginPct,
        })),
      }, null, 2)}`);

      // Assertions are informational for the live proof; the run must not throw.
      expect(result.code).toBeUndefined();
    } finally {
      if (tempUserId) {
        const del = await gotrue(base, serviceKey, `/admin/users/${tempUserId}`, { method: 'DELETE' });
        console.log(`[cleanup] temp admin user deleted (HTTP ${del.status})`);
      }
    }
  }, 600_000);
});
