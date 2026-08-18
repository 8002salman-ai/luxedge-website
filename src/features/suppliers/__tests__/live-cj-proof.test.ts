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
import { runMarketIntelligenceJob, MARKET_QUALIFICATION_GATE } from '../../scout/engine';
import { runCjSeedDiscovery, seedConceptSearchQuery, conditionalQualifiedRunDecision, clusterCjSeedConcepts, type CjSeedRecord } from '../../scout/cjSeedDiscovery';
import type { AgentJobRow } from '../../scout/persist';
import { runSupplierSearch } from '../../scout/supplierSearch';
import { parseHtmlPage, isProxyErrorText } from '../../ai/importer';
import { discoverUrls } from '../../scout/discover';
import { extractPageFacts } from '../../scout/extract';
import { validateExactProduct } from '../../scout/marketEvidence';

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

      // 3) PHASE 4F — CJ SEED DISCOVERY: ONE controlled listV2 call on a
      //    durable 50-point run. Supplier data is NOT market demand — seeds
      //    only surface real product concepts for targeted USA research.
      const seed = await runCjSeedDiscovery({
        adapter,
        db,
        query: 'dog travel accessories',
        market: 'US',
        maxResults: 40,
        onProgress: (m) => console.log(`[seed] ${m}`),
      });
      console.log(`[seed] job ${seed.jobId} · run ${seed.runId} · budget ${seed.hardBudget} · records ${seed.recordsReturned} · seeds ${seed.seeds.length} (dups ${seed.duplicates}) · points ${seed.pointsReserved} · listCalls ${seed.listCalls} · detailCalls ${seed.detailCalls} · freightCalls ${seed.freightCalls}`);
      console.log(`[seed] concepts (max 2): ${seed.concepts.map((c) => `"${c.label.slice(0, 48)}" (${c.memberPids.length} records, suitability ${c.suitabilityScore})`).join(' | ') || 'NONE'}`);
      if (!seed.runId || seed.seeds.length === 0) {
        console.log(`CJ SEED DISCOVERY FAILED — no seed records. CJ detail/freight = 0, market research skipped.`);
        console.log(`[result] ${JSON.stringify({ winner: 'NONE', seed: { runId: seed.runId, recordsReturned: seed.recordsReturned, seeds: seed.seeds.length, warning: seed.warning } }, null, 2)}`);
        return;
      }

      // 4) TARGETED MARKET EVIDENCE — for each selected concept (max 2):
      //    build targeted web searches using the ACTUAL concept/title
      //    vocabulary learned from CJ (not fixed retailer queries), fetch real
      //    exact PDPs, run the fail-closed evidence gate, and only then allow
      //    ONE grounded DeepSeek analysis.
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
      let pageFetches = 0;
      const fetchPage = async (url: string) => {
        pageFetches++;
        const res = await fetch(`${preview}/api/fetch-page?url=${encodeURIComponent(url)}`, {
          headers: { Accept: 'text/plain', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`fetch-page HTTP ${res.status}`);
        const raw = await res.text();
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

      // Try concept #1; if its evidence pack is insufficient, try concept #2
      // ONCE, then STOP (no category looping, no third concept, no score fishing).
      let mi: Awaited<ReturnType<typeof runMarketIntelligenceJob>> | null = null;
      let attemptedConcepts = 0;
      for (const concept of seed.concepts.slice(0, 2)) {
        attemptedConcepts++;
        const query = seedConceptSearchQuery(concept);
        console.log(`[mi] concept #${attemptedConcepts} — query "${query}" (from CJ seed vocabulary)`);
        mi = await runMarketIntelligenceJob({
          query,
          market: 'US',
          db,
          fetchPage,
          aiCall,
          // Phase 4F: NOT restricted to Target/Chewy/Walmart — targeted search
          // across reputable retailers/manufacturers using the CJ vocabulary.
          onProgress: (m) => console.log(`[mi] ${m}`),
        });
        const ev = mi.evidence;
        console.log(`[mi] job ${mi.jobId} · signals ${mi.signals} · market score ${mi.marketScore ?? 'NULL'} (diagnostic ${mi.diagnosticDeterministicScore ?? 'n/a'}/100) · qualificationEligible=${mi.qualificationEligible} · ai=${mi.aiUsed} · page fetches=${pageFetches}`);
        console.log(`[mi] evidence pack: discovered ${ev.discoveredUrls} URLs · selected ${ev.selectedUrls.length} · extracts ok ${ev.successfulExtracts} · failed ${ev.failedExtracts} · domains ${ev.independentDomains} · prices ${ev.priceEvidenceCount} · availability evidence ${ev.availabilityEvidenceCount} (${ev.availableCount} available) · ratings ${ev.ratingEvidenceCount} · reviews ${ev.reviewCountEvidenceCount} pages (${ev.totalObservedReviews} total)`);
        console.log(`[mi] evidence quality: ${ev.evidenceQuality.toUpperCase()} — ${ev.evidenceQualityReasons.join('; ')}`);
        if (ev.rejectedUrls.length) {
          console.log(`[mi] rejected pages (${ev.rejectedUrls.length}): ${ev.rejectedUrls.slice(0, 8).map((r) => `${r.url} → ${r.reason}`).join(' | ')}`);
        }
        if (mi.evidence.evidenceQuality === 'sufficient') break; // gate passed — no need for concept #2
      }
      if (!mi) {
        console.log(`NO CONCEPT RESEARCHED — no concepts from the seed run.`);
        console.log(`[result] ${JSON.stringify({ winner: 'NONE', seedConcepts: 0 }, null, 2)}`);
        return;
      }

      // 5) PART D — EVIDENCE GATE + MARKET DECISION (fail-closed):
      //    insufficient evidence → marketScore NULL, DeepSeek 0 (gate saved the
      //    credits); Market < 60 → STOP; only Market >= 60 with a PERSISTED
      //    recommendation unlocks the conditional qualified CJ run (Part E).
      const decision = conditionalQualifiedRunDecision(mi);
      console.log(`[gate] conditional run decision: ${JSON.stringify(decision)}`);
      if (!decision.run) {
        console.log(`MARKET OPPORTUNITY NOT STRONG ENOUGH — reason ${decision.reason}. CJ detail/freight NOT run (0 points spent on research).`);
        console.log(`[result] ${JSON.stringify({
          winner: 'NONE',
          seed: { runId: seed.runId, hardBudget: seed.hardBudget, recordsReturned: seed.recordsReturned, seeds: seed.seeds.length, pointsReserved: seed.pointsReserved, listCalls: seed.listCalls, detailCalls: seed.detailCalls, freightCalls: seed.freightCalls, concepts: seed.concepts.map((c) => ({ label: c.label, pids: c.memberPids.length, suitability: c.suitabilityScore })) },
          market: { marketScore: mi.marketScore, diagnostic: mi.diagnosticDeterministicScore, evidenceQuality: mi.evidence.evidenceQuality, evidence: mi.evidence, miJobId: mi.jobId },
          conditionalRun: decision,
          cjResearchPointsConsumed: 0,
        }, null, 2)}`);
        return;
      }

      // 6) PART E — MARKET-GROUNDED CJ QUALIFICATION RUN (ONLY after the gate):
      //    a NEW durable 250-pt run; the ACTUAL query must match the persisted
      //    MI recommendation so marketProvenance verifies it from the DB.
      console.log(`MARKET-GROUNDED CJ QUALIFICATION RUN ALLOWED — score ${decision.marketScore} >= ${MARKET_QUALIFICATION_GATE} with persisted recommendation "${decision.query}".`);
      const run = await runSupplierSearch({
        adapter,
        db,
        search: {
          query: decision.query,
          market: 'US',
          maxResults: 40,
          pointsBudget: 250,
          marketContext: { marketAnalysisId: decision.marketAnalysisId, hypothesis: decision.hypothesis, evidenceFingerprint: mi.evidenceFingerprint ?? undefined },
        },
        onProgress: (m) => console.log(`[cj] ${m}`),
      });
      console.log(`[cj] run ${run.jobId} · searched ${run.searched} · duplicates ${run.duplicates} · prefilterRejected ${run.prefilterRejected} · researched ${run.researched} · rejected ${run.rejected} · PRODUCT_SHORTLISTED ${run.productShortlisted} · QA passed ${run.qaPassed} · BUSINESS_QUALIFIED ${run.businessQualified}`);
      console.log(`[cj] points (client forecast) ${JSON.stringify(run.points)}`);
      console.log(`[cj] server usage ${JSON.stringify(run.serverPoints)}`);
      console.log(`[result] ${JSON.stringify({
        winner: run.businessQualified > 0 ? 'QUALIFIED' : 'NONE',
        seed: { runId: seed.runId, hardBudget: seed.hardBudget, recordsReturned: seed.recordsReturned, seeds: seed.seeds.length, pointsReserved: seed.pointsReserved, listCalls: seed.listCalls, detailCalls: seed.detailCalls, freightCalls: seed.freightCalls, concepts: seed.concepts.map((c) => ({ label: c.label, pids: c.memberPids.length, suitability: c.suitabilityScore })) },
        market: { marketScore: decision.marketScore, miJobId: decision.marketAnalysisId, hypothesis: decision.hypothesis, evidence: mi.evidence },
        cjRun: { jobId: run.jobId, searched: run.searched, duplicates: run.duplicates, prefilterRejected: run.prefilterRejected, researched: run.researched, productShortlisted: run.productShortlisted, qaPassed: run.qaPassed, businessQualified: run.businessQualified, businessQualifiedCandidates: run.businessQualifiedCandidates, marketContext: run.marketContext, points: run.points, serverPoints: run.serverPoints },
      }, null, 2)}`);
    } finally {
      if (tempUserId) {
        const del = await gotrue(base, serviceKey, `/admin/users/${tempUserId}`, { method: 'DELETE' });
        console.log(`[cleanup] temp admin user deleted (HTTP ${del.status})`);
      }
    }
  }, 600_000);

  it('runs a market-evidence-only pass for the CJ-seeded elevated dog sofa bed concept (NO new CJ calls until the market gate authorizes the qualification stage)', async () => {
    const env = loadEnv('.env');
    const base = (env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const anonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
    const preview = (env.VERCEL_PREVIEW_API || process.env.VERCEL_PREVIEW_API || '').trim().replace(/\/$/, '');
    const bypass = (env.VERCEL_PREVIEW_BYPASS || process.env.VERCEL_PREVIEW_BYPASS || '').trim();
    if (!base || !serviceKey || !anonKey || !preview) {
      throw new Error('LIVE PROOF needs VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY / VERCEL_PREVIEW_API in .env');
    }

    const email = `sofabed-proof-${Date.now()}@luxedge.us`;
    const password = `Pw-${Date.now()}-x7q2`;
    const created = await gotrue(base, serviceKey, '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role: 'admin' } }),
    });
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

      // 0) NO CJ calls in this pass — the concept vocabulary comes from the
      //    ALREADY-PERSISTED Phase 4F CJ seed run (durable agent_jobs row).
      //    Read the most recent CJ_SEED_DISCOVERY job and re-cluster its
      //    persisted factual seeds deterministically (same code path as the
      //    original run — no re-seed, no new CJ spend).
      const jobs = await db.list<AgentJobRow>('agent_jobs', { orderBy: 'created_at.desc', limit: 100 });
      const seedJob = jobs.find((j) => {
        const o = j.output as Record<string, unknown> | null;
        return j.type === 'PRODUCT_RESEARCH'
          && o?.mode === 'CJ_SEED_DISCOVERY'
          && Array.isArray(o?.seeds)
          && (o?.seeds as unknown[]).length > 0;
      });
      expect(seedJob).toBeTruthy();
      const seedOutput = (seedJob!.output as Record<string, unknown>) ?? {};
      const persistedSeeds = (seedOutput.seeds as CjSeedRecord[]).filter((s) => s && typeof s.title === 'string');
      console.log(`[seed-source] job ${seedJob!.id} (${seedJob!.status}) · ${persistedSeeds.length} persisted CJ seed records from the Phase 4F run (mode CJ_SEED_DISCOVERY) — NO new CJ calls`);
      expect(persistedSeeds.length).toBeGreaterThan(0);

      // Re-cluster from the persisted seeds (deterministic — identical to the
      // original run's clustering). The concept is selected EXPLICITLY by
      // owner priority: the elevated dog sofa bed (Phase 4F concept #1, 3 real
      // CJ records). Owner priority overrides the suitability ranking for
      // which concept to research — it is not score-fishing.
      const concepts = clusterCjSeedConcepts(persistedSeeds);
      console.log(`[concepts] re-clustered (${concepts.length}): ${concepts.slice(0, 8).map((c) => `"${c.label.slice(0, 44)}" (${c.memberPids.length} records, suitability ${c.suitabilityScore})`).join(' | ')}`);
      const sofaBed = concepts.find((c) => /sofa/i.test(c.label))
        ?? concepts.find((c) => /\belevated\b/i.test(c.label))
        ?? concepts[0];
      console.log(`[concept] owner-priority selection: "${sofaBed.label}" — ${sofaBed.memberPids.length} CJ record(s), suitability ${sofaBed.suitabilityScore} (${sofaBed.suitabilityReasons.join('; ')})`);
      expect(sofaBed.memberPids.length).toBeGreaterThan(0);
      const query = seedConceptSearchQuery(sofaBed);
      console.log(`[query] targeted market-search vocabulary from CJ titles: "${query}"`);

      // 1) ONE serious market-evidence pass for this concept — real
      //    retailer/manufacturer exact PDPs only. Google Ads demand adapter is
      //    NOT wired (DEFERRED — billing) ⇒ demand status not_configured,
      //    zero external demand calls. DeepSeek runs ONLY if the evidence
      //    gate passes (exactly ONE grounded call).
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
      let pageFetches = 0;
      const fetchPage = async (url: string) => {
        pageFetches++;
        const res = await fetch(`${preview}/api/fetch-page?url=${encodeURIComponent(url)}`, {
          headers: { Accept: 'text/plain', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`fetch-page HTTP ${res.status}`);
        const raw = await res.text();
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
        query,
        market: 'US',
        db,
        fetchPage,
        aiCall,
        onProgress: (m) => console.log(`[mi] ${m}`),
      });
      const ev = mi.evidence;
      console.log(`[mi] job ${mi.jobId} · signals ${mi.signals} · market score ${mi.marketScore ?? 'NULL'} (diagnostic ${mi.diagnosticDeterministicScore ?? 'n/a'}/100) · qualificationEligible=${mi.qualificationEligible} · ai=${mi.aiUsed} · page fetches=${pageFetches}`);
      console.log(`[mi] evidence pack: discovered ${ev.discoveredUrls} URLs · selected ${ev.selectedUrls.length} · extracts ok ${ev.successfulExtracts} · failed ${ev.failedExtracts} · domains ${ev.independentDomains} · prices ${ev.priceEvidenceCount} · availability evidence ${ev.availabilityEvidenceCount} (${ev.availableCount} available) · ratings ${ev.ratingEvidenceCount} · reviews ${ev.reviewCountEvidenceCount} pages (${ev.totalObservedReviews} total)`);
      console.log(`[mi] evidence quality: ${ev.evidenceQuality.toUpperCase()} — ${ev.evidenceQualityReasons.join('; ')}`);
      if (ev.rejectedUrls.length) {
        console.log(`[mi] rejected pages (${ev.rejectedUrls.length}): ${ev.rejectedUrls.slice(0, 8).map((r) => `${r.url} → ${r.reason}`).join(' | ')}`);
      }

      // 2) GATES UNCHANGED (fail-closed): Market Score >= 60 + sufficient
      //    evidence + persisted recommendation BEFORE any CJ research point.
      const decision = conditionalQualifiedRunDecision(mi);
      console.log(`[gate] conditional run decision: ${JSON.stringify(decision)}`);
      if (!decision.run) {
        console.log(`NOT QUALIFIED — ${decision.reason}. No CJ product calls, no research points. (Google Ads live demand = DEFERRED, zero calls.)`);
        console.log(`[result] ${JSON.stringify({
          winner: 'NONE',
          concept: { label: sofaBed.label, pids: sofaBed.memberPids.length, suitability: sofaBed.suitabilityScore },
          query,
          seedSource: { jobId: seedJob!.id, records: persistedSeeds.length },
          market: { marketScore: mi.marketScore, diagnostic: mi.diagnosticDeterministicScore, evidenceQuality: ev.evidenceQuality, evidence: ev, miJobId: mi.jobId },
          conditionalRun: decision,
          googleAds: { liveDemand: 'DEFERRED', calls: 0 },
          cjResearchPointsConsumed: 0,
        }, null, 2)}`);
        return;
      }

      // 3) MARKET GATE PASSED — authorize ONLY the existing market-grounded
      //    path toward the controlled CJ qualification stage: a NEW durable
      //    250-pt run whose actual query must match the persisted MI
      //    recommendation (marketProvenance verifies from the DB).
      console.log(`MARKET-GROUNDED CJ QUALIFICATION RUN ALLOWED — score ${decision.marketScore} >= ${MARKET_QUALIFICATION_GATE} with persisted recommendation "${decision.query}".`);
      const run = await runSupplierSearch({
        adapter,
        db,
        search: {
          query: decision.query,
          market: 'US',
          maxResults: 40,
          pointsBudget: 250,
          marketContext: { marketAnalysisId: decision.marketAnalysisId, hypothesis: decision.hypothesis, evidenceFingerprint: mi.evidenceFingerprint ?? undefined },
        },
        onProgress: (m) => console.log(`[cj] ${m}`),
      });
      console.log(`[cj] run ${run.jobId} · searched ${run.searched} · duplicates ${run.duplicates} · prefilterRejected ${run.prefilterRejected} · researched ${run.researched} · rejected ${run.rejected} · PRODUCT_SHORTLISTED ${run.productShortlisted} · QA passed ${run.qaPassed} · BUSINESS_QUALIFIED ${run.businessQualified}`);
      console.log(`[cj] server usage ${JSON.stringify(run.serverPoints)}`);
      console.log(`[result] ${JSON.stringify({
        winner: run.businessQualified > 0 ? 'QUALIFIED' : 'NONE',
        concept: { label: sofaBed.label, pids: sofaBed.memberPids.length, suitability: sofaBed.suitabilityScore },
        query,
        seedSource: { jobId: seedJob!.id, records: persistedSeeds.length },
        market: { marketScore: decision.marketScore, miJobId: decision.marketAnalysisId, hypothesis: decision.hypothesis, evidence: ev },
        cjRun: { jobId: run.jobId, searched: run.searched, duplicates: run.duplicates, prefilterRejected: run.prefilterRejected, researched: run.researched, productShortlisted: run.productShortlisted, qaPassed: run.qaPassed, businessQualified: run.businessQualified, businessQualifiedCandidates: run.businessQualifiedCandidates, marketContext: run.marketContext, points: run.points, serverPoints: run.serverPoints },
        googleAds: { liveDemand: 'DEFERRED', calls: 0 },
      }, null, 2)}`);
    } finally {
      if (tempUserId) {
        const del = await gotrue(base, serviceKey, `/admin/users/${tempUserId}`, { method: 'DELETE' });
        console.log(`[cleanup] temp admin user deleted (HTTP ${del.status})`);
      }
    }
  }, 600_000);

  it('PRICE-EVIDENCE CLOSURE — elevated dog sofa bed: probe exact-product PDPs for REAL prices, then ONE grounded MI pass (no CJ calls)', async () => {
    const env = loadEnv('.env');
    const base = (env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const anonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
    const preview = (env.VERCEL_PREVIEW_API || process.env.VERCEL_PREVIEW_API || '').trim().replace(/\/$/, '');
    const bypass = (env.VERCEL_PREVIEW_BYPASS || process.env.VERCEL_PREVIEW_BYPASS || '').trim();
    if (!base || !serviceKey || !anonKey || !preview) {
      throw new Error('LIVE PROOF needs VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY / VERCEL_PREVIEW_API in .env');
    }

    const email = `priceclosure-${Date.now()}@luxedge.us`;
    const password = `Pw-${Date.now()}-x7q2`;
    const created = await gotrue(base, serviceKey, '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role: 'admin' } }),
    });
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

      // 0) NO CJ calls. Reuse the exact product identity from the persisted
      //    Phase 4F CJ seeds (elevated dog sofa bed — owner priority).
      const jobs = await db.list<AgentJobRow>('agent_jobs', { orderBy: 'created_at.desc', limit: 100 });
      const seedJob = jobs.find((j) => {
        const o = j.output as Record<string, unknown> | null;
        return j.type === 'PRODUCT_RESEARCH'
          && o?.mode === 'CJ_SEED_DISCOVERY'
          && Array.isArray(o?.seeds)
          && (o?.seeds as unknown[]).length > 0;
      });
      expect(seedJob).toBeTruthy();
      const persistedSeeds = ((seedJob!.output as Record<string, unknown>).seeds as CjSeedRecord[]).filter((s) => s && typeof s.title === 'string');
      const concepts = clusterCjSeedConcepts(persistedSeeds);
      const sofaBed = concepts.find((c) => /sofa/i.test(c.label))
        ?? concepts.find((c) => /\belevated\b/i.test(c.label))
        ?? concepts[0];
      console.log(`[seed-source] job ${seedJob!.id} · concept "${sofaBed.label.slice(0, 70)}…" (${sofaBed.memberPids.length} CJ records, suitability ${sofaBed.suitabilityScore}) — NO new CJ calls`);
      const q1 = seedConceptSearchQuery(sofaBed);
      const q2 = 'elevated dog sofa bed';

      // 1) PRICE-FOCUSED DISCOVERY — two real searches for the SAME exact
      //    product to widen the retailer pool (CJ vocabulary + common name).
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
      let pageFetches = 0;
      const fetchPage = async (url: string) => {
        pageFetches++;
        const res = await fetch(`${preview}/api/fetch-page?url=${encodeURIComponent(url)}`, {
          headers: { Accept: 'text/plain', Authorization: `Bearer ${adminJwt}`, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`fetch-page HTTP ${res.status}`);
        const raw = await res.text();
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

      const [d1, d2] = await Promise.all([
        discoverUrls({ query: q1, market: 'US', maxResults: 12 }),
        discoverUrls({ query: q2, market: 'US', maxResults: 12 }),
      ]);
      const pool: string[] = [];
      const seenUrl = new Set<string>();
      for (const u of [...d1.urls, ...d2.urls]) {
        if (!seenUrl.has(u)) { seenUrl.add(u); pool.push(u); }
      }
      console.log(`[probe] discovery pool ${pool.length} URLs (q1 "${q1}" → ${d1.urls.length}, q2 "${q2}" → ${d2.urls.length})`);

      // 2) PROBE each candidate — fetch via the real proxy and keep ONLY
      //    exact-product PDPs that expose a REAL price in the page itself
      //    (visible HTML / JSON-LD / server-rendered data). Listing/category/
      //    search-page prices are never PDP evidence. ≤2 per domain.
      const priceRich: { url: string; price: number; domain: string }[] = [];
      const probeRejections: { url: string; reason: string }[] = [];
      const perDomain = new Map<string, number>();
      for (const url of pool.slice(0, 16)) {
        let page;
        try {
          page = await fetchPage(url);
        } catch (e) {
          probeRejections.push({ url, reason: `fetch failed: ${(e as Error).message}` });
          continue;
        }
        const extract = extractPageFacts(page);
        const valid = validateExactProduct(extract);
        if (!valid.usable) {
          probeRejections.push({ url, reason: valid.reason ?? 'not an exact product page' });
          continue;
        }
        if (extract.price === null || extract.price <= 0) {
          probeRejections.push({ url, reason: 'no real price in page extract (JS-rendered or blocked price)' });
          continue;
        }
        const domain = new URL(url).hostname.replace(/^www\./, '');
        const used = perDomain.get(domain) ?? 0;
        if (used >= 2) {
          probeRejections.push({ url, reason: `domain quota (max 2 per domain: ${domain})` });
          continue;
        }
        perDomain.set(domain, used + 1);
        priceRich.push({ url, price: extract.price, domain });
      }
      console.log(`[probe] page fetches=${pageFetches} · price-rich exact PDPs: ${priceRich.length} — ${priceRich.map((p) => `${p.domain} $${p.price}`).join(' | ')}`);
      console.log(`[probe] rejections (${probeRejections.length}): ${probeRejections.slice(0, 10).map((r) => `${r.url.slice(0, 58)} → ${r.reason}`).join(' | ')}`);
      const priceDomains = new Set(priceRich.map((p) => p.domain)).size;
      if (priceRich.length < 3 || priceDomains < 3) {
        console.log(`PRICE EVIDENCE BLOCKED — ${priceRich.length} real retailer prices across ${priceDomains} independent domain(s) (need >=3 each). No MI run, no DeepSeek, no CJ. No fetch-system redesign (per instruction).`);
        console.log(`[result] ${JSON.stringify({
          winner: 'NONE', priceEvidenceBlocked: true, prices: priceRich, priceDomains, probeRejections,
          googleAds: { liveDemand: 'DEFERRED', calls: 0 }, cjPointsSpent: 0,
        }, null, 2)}`);
        return;
      }

      // 3) ONE grounded MI pass — the evidence pack is built from the
      //    price-rich exact PDPs (standard engine path; the gate still
      //    requires >=4 pages / >=3 domains / >=3 prices / >=3 availability).
      //    DeepSeek runs ONLY if the gate passes (max 1 call).
      const priceRichUrls = priceRich.map((p) => p.url);
      const mi = await runMarketIntelligenceJob({
        query: q1,
        market: 'US',
        db,
        fetchPage,
        aiCall,
        discover: async () => ({ query: q1, rawLinks: priceRichUrls, urls: priceRichUrls, filtered: 0, duplicates: 0 }),
        onProgress: (m) => console.log(`[mi] ${m}`),
      });
      const ev = mi.evidence;
      console.log(`[mi] job ${mi.jobId} · signals ${mi.signals} · market score ${mi.marketScore ?? 'NULL'} (diagnostic ${mi.diagnosticDeterministicScore ?? 'n/a'}/100) · qualificationEligible=${mi.qualificationEligible} · ai=${mi.aiUsed} · page fetches=${pageFetches}`);
      console.log(`[mi] evidence pack: usable ${ev.successfulExtracts} · domains ${ev.independentDomains} · prices ${ev.priceEvidenceCount} · availability evidence ${ev.availabilityEvidenceCount} (${ev.availableCount} available) · ratings ${ev.ratingEvidenceCount} · identity pages ${ev.identityEvidencePages}`);
      console.log(`[mi] evidence quality: ${ev.evidenceQuality.toUpperCase()} — ${ev.evidenceQualityReasons.join('; ')}`);

      // 4) GATES UNCHANGED: Market >= 60 + sufficient + persisted rec BEFORE
      //    any CJ spend. If eligible: report READY — DO NOT start the 250-pt
      //    CJ qualification run (owner authorizes the paid spend separately).
      const decision = conditionalQualifiedRunDecision(mi);
      console.log(`[gate] conditional run decision: ${JSON.stringify(decision)}`);
      if (decision.run) {
        console.log(`MARKET-GROUNDED CJ QUALIFICATION READY — score ${decision.marketScore} >= ${MARKET_QUALIFICATION_GATE} with persisted recommendation "${decision.query}". CJ qualification run NOT started (250-pt spend requires separate owner authorization).`);
        console.log(`[result] ${JSON.stringify({
          winner: 'NONE', marketGroundedCjReady: true, marketScore: decision.marketScore,
          miJobId: decision.marketAnalysisId, recommendation: decision.query,
          prices: priceRich, evidence: ev,
          googleAds: { liveDemand: 'DEFERRED', calls: 0 }, cjPointsSpent: 0,
        }, null, 2)}`);
      } else {
        console.log(`MARKET NOT QUALIFIED — ${decision.reason}. No CJ research points spent.`);
        console.log(`[result] ${JSON.stringify({
          winner: 'NONE', marketGroundedCjReady: false, decision,
          market: { marketScore: mi.marketScore, diagnostic: mi.diagnosticDeterministicScore, evidence: ev, miJobId: mi.jobId },
          prices: priceRich,
          googleAds: { liveDemand: 'DEFERRED', calls: 0 }, cjPointsSpent: 0,
        }, null, 2)}`);
      }
    } finally {
      if (tempUserId) {
        const del = await gotrue(base, serviceKey, `/admin/users/${tempUserId}`, { method: 'DELETE' });
        console.log(`[cleanup] temp admin user deleted (HTTP ${del.status})`);
      }
    }
  }, 600_000);
});
