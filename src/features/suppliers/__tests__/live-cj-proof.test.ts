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
import { parseHtmlPage, isProxyErrorText } from '../../ai/importer';

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

      // 3) ONE controlled Phase 4D Market Intelligence pass with the MARKET
      //    EVIDENCE PACK: discovery → select exact product pages → fetch via
      //    the REAL preview /api/fetch-page → extract → quality gate →
      //    DeepSeek only if the gate passes. No CJ product points are spent.
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
      let pageFetches = 0;
      // Mirrors the real client path (scoutFetchPage → fetchViaServerProxy →
      // parseHtmlPage): /api/fetch-page returns PLAIN text, not JSON.
      const fetchPage = async (url: string) => {
        pageFetches++;
        const res = await fetch(`${preview}/api/fetch-page?url=${encodeURIComponent(url)}`, {
          headers: { Accept: 'text/plain', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`fetch-page HTTP ${res.status}`);
        const raw = await res.text();
        // A proxy error page (Jina "Warning: … URL returned error 429…") is NOT
        // a page — a rate-limited Target/Walmart page must never count as
        // product evidence (Phase 4E honesty fix).
        if (isProxyErrorText(raw)) throw new Error('proxy error page (rate-limited/blocked)');
        const parsed = parseHtmlPage(raw);
        if (!parsed.text || parsed.text.trim().length < 100) throw new Error('page returned no usable content');
        return { text: parsed.text, images: parsed.images || [] };
      };
      const aiCall = async (prompt: string, model?: string) => {
        const res = await fetch(`${preview}/api/ai/generate`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ provider: 'deepseek', model: model || 'deepseek-chat', prompt, system: 'You are Luxedge\'s USA pet-market analyst. Reason ONLY over the given evidence; never invent facts. Return STRICT JSON with keys: marketOpportunityScore, trendConfidence, demandEvidence, competitionLevel, customerPainPoint, priceBand, risks, recommendedSearchQueries, reasoningSummary.' }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`AI proxy HTTP ${res.status}`);
        const body = await res.json() as { text?: string };
        if (!body.text) throw new Error('AI proxy returned no text');
        return body.text;
      };

      const mi = await runMarketIntelligenceJob({
        query: 'dog travel accessories',
        market: 'US',
        db,
        fetchPage,
        aiCall,
        // Phase 4E: site-restricted retailer discovery — exact product pages
        // from Chewy/Target/Walmart feed the evidence pack (market evidence
        // only; no CJ supplier points).
        retailDomains: ['chewy.com', 'target.com', 'walmart.com'],
        onProgress: (m) => console.log(`[mi] ${m}`),
      });
      console.log(`[mi] job ${mi.jobId} · signals ${mi.signals} · market score ${mi.marketScore ?? 'NULL'} (diagnostic ${mi.diagnosticDeterministicScore ?? 'n/a'}/100) · qualificationEligible=${mi.qualificationEligible} · ai=${mi.aiUsed} · page fetches=${pageFetches}`);
      const ev = mi.evidence;
      console.log(`[mi] evidence pack: discovered ${ev.discoveredUrls} URLs · selected ${ev.selectedUrls.length} · extracts ok ${ev.successfulExtracts} · failed ${ev.failedExtracts} · domains ${ev.independentDomains} · prices ${ev.priceEvidenceCount} · availability evidence ${ev.availabilityEvidenceCount} (${ev.availableCount} available) · ratings ${ev.ratingEvidenceCount} · reviews ${ev.reviewCountEvidenceCount} pages (${ev.totalObservedReviews} total)`);
      console.log(`[mi] evidence quality: ${ev.evidenceQuality.toUpperCase()} — ${ev.evidenceQualityReasons.join('; ')}`);
      if (ev.retail) {
        console.log(`[mi] retail discovery: ${ev.retail.searchRequests} search requests · domains attempted ${ev.retail.domainsAttempted.join(',')} · with results ${ev.retail.domainsWithResults.join(',') || 'NONE'}`);
        console.log(`[mi] retail navigation (Phase 4E.2): ${ev.retail.listingSources} listing/search pages used as NAVIGATION sources only · ${ev.retail.navigationPdpExtracted} exact PDP URLs extracted from listing pages`);
      }
      if (ev.rejectedUrls.length) {
        console.log(`[mi] rejected pages (${ev.rejectedUrls.length}): ${ev.rejectedUrls.slice(0, 8).map((r) => `${r.url} → ${r.reason}`).join(' | ')}`);
      }

      const job = await db.get<Record<string, unknown>>('agent_jobs', mi.jobId);
      const out = (job && job.output && typeof job.output === 'object' ? job.output : {}) as Record<string, unknown>;
      const recs = Array.isArray(out.recommendedSearchQueries)
        ? (out.recommendedSearchQueries as string[]).filter((r) => typeof r === 'string' && r.trim())
        : [];

      // 4) MARKET GATE (Phase 4E spec §12/§13): if the EVIDENCE QUALITY gate
      //    failed, STOP (DeepSeek was already skipped — credits saved).
      if (mi.evidence.evidenceQuality === 'insufficient') {
        console.log(`MARKET EVIDENCE INSUFFICIENT — CJ search NOT run, DeepSeek NOT called.`);
        console.log(`[result] ${JSON.stringify({ winner: 'NONE', evidenceQuality: 'insufficient', marketScore: mi.marketScore, reason: mi.evidence.evidenceQualityReasons.join('; '), miJobId: mi.jobId, evidence: mi.evidence })}`);
        return;
      }

      // 5) Evidence sufficient → the engine already ran ONE grounded DeepSeek
      //    call (aiUsed=true). If the Market Score >= 60: STOP and report
      //    MARKET-GROUNDED CJ SEARCH READY — do NOT run CJ in Phase 4E.
      if (mi.marketScore === null || mi.marketScore < 60 || recs.length === 0) {
        console.log(`MARKET OPPORTUNITY NOT STRONG ENOUGH (score=${mi.marketScore ?? 'UNKNOWN'}) — CJ search NOT run.`);
        console.log(`[result] ${JSON.stringify({ winner: 'NONE', marketScore: mi.marketScore, reason: 'market gate not met', miJobId: mi.jobId, evidence: mi.evidence })}`);
        return;
      }

      console.log(`MARKET-GROUNDED CJ SEARCH READY — score ${mi.marketScore} >= 60 with sufficient evidence. CJ NOT run in Phase 4E (owner/next phase authorizes the first paid supplier run).`);
      console.log(`[result] ${JSON.stringify({
        winner: 'NONE',
        marketScore: mi.marketScore,
        miJobId: mi.jobId,
        evidence: mi.evidence,
        cjSearchRun: 'NOT RUN (Phase 4E gate)' ,
        cjProductPointsConsumed: 0,
      }, null, 2)}`);
    } finally {
      if (tempUserId) {
        const del = await gotrue(base, serviceKey, `/admin/users/${tempUserId}`, { method: 'DELETE' });
        console.log(`[cleanup] temp admin user deleted (HTTP ${del.status})`);
      }
    }
  }, 600_000);
});
