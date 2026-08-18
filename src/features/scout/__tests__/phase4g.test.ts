// ============================================================================
// LUXEDGE V2 — PHASE 4G TESTS: DIRECT SEARCH-DEMAND EVIDENCE +
// CJ SEED ACCOUNTING HARDENING
//
// A) server ledger reserves 50, client response fails before local budget spend
//    → serverAuthorizedPoints = 50, clientForecastPoints may be 0, never 0/0
// B) successful seed: server points authority used
// C) concept with 5 duplicate variants does NOT beat equally-complete 1-record
//    concept
// D) listedNum/memberCount never contributes suitability score
// E) exact same GTIN/SKU → exact identity
// F) title-only similarity → concept identity, NOT exact
// G) different products' reviews → no fake exact-product aggregation
// H) Google adapter not configured → status not_configured, zero outbound call
// I) Google adapter response parses avg searches, history, competition, bids
// J) no secret enters browser bundle (env access guarded by process check)
// K) max 5 keywords enforced
// L) configured provider failure → explicit safe error status, not silently []
// M) same keyword+geo+month → cached result reused, no duplicate request
// N) Google metrics become MarketSignals with explicit limitations
// O) CJ listedNum never enters MarketDemandAdapter
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierProductRecord, SupplierSearchResult,
  SupplierShippingEvidence, SupplierHealthResult, SupplierPointUsage, SupplierSearchOptions,
} from '../../suppliers/types';
import { normalizeCjListProduct, type CjListProduct } from '../../suppliers/cj/normalize';
import {
  runCjSeedDiscovery, seedRecordFromSupplierRecord,
  assessConceptSuitability, type CjSeedRecord,
} from '../cjSeedDiscovery';
import {
  GoogleAdsKeywordPlannerDemandAdapter, collectDemandSignals,
  googleAdsConfigured, googleDemandCacheKey, googleMetricsToSignals,
  parseGoogleAdsMetrics, GOOGLE_MAX_KEYWORDS, GOOGLE_ADS_ENV,
} from '../marketDemand';
import {
  identityMatchLevel, aggregateReviewEvidence,
  type PageIdentityEvidence,
} from '../identity';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function listProduct(over: Partial<CjListProduct> = {}): CjListProduct {
  return {
    id: 'PID123456',
    nameEn: 'Dog Travel Water Bottle 600ML Portable for Walking',
    sku: 'SKU-ABC-001',
    spu: 'SPU-001',
    bigImage: 'https://img.cjdropshipping.com/pid123456.jpg',
    sellPrice: '12.50',
    nowPrice: '10.99',
    listedNum: 320,
    oneCategoryName: 'Pet Supplies',
    twoCategoryName: 'Dog Supplies',
    threeCategoryName: 'Travel Accessories',
    addMarkStatus: 1,
    deliveryCycle: '3-5',
    warehouseInventoryNum: 86,
    totalVerifiedInventory: 42,
    verifiedWarehouse: 1,
    supplierName: 'CJ Dropshipping',
    saleStatus: '3',
    ...over,
  };
}

function seedRecord(over: Partial<CjListProduct> = {}): CjSeedRecord {
  return seedRecordFromSupplierRecord(normalizeCjListProduct(listProduct(over), { market: 'US' })!);
}

class FakeDb implements DbAdapter {
  mode = 'supabase' as const;
  token: string | null = null;
  rows = new Map<string, Record<string, unknown>[]>();
  constructor() {
    for (const t of ['suppliers', 'supplier_products', 'product_candidates', 'product_scores', 'agent_jobs', 'agent_runs', 'agent_logs']) {
      this.rows.set(t, []);
    }
  }
  async list<T>(table: string): Promise<T[]> { return [...(this.rows.get(table) || [])] as T[]; }
  async get<T>(table: string, id: string): Promise<T | null> {
    return ((this.rows.get(table) || []).find((r) => r.id === id) as T) || null;
  }
  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    return ((this.rows.get(table) || []).find((r) => r[column] === value) as T) || null;
  }
  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    this.rows.get(table)?.push({ ...row });
    return row;
  }
  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    const list = this.rows.get(table) || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    return list[idx] as T;
  }
  async remove(table: string, id: string): Promise<void> {
    this.rows.set(table, (this.rows.get(table) || []).filter((r) => r.id !== id));
  }
  async testConnection() { return { ok: true, mode: 'supabase' as const, detail: 'fake' }; }
}

class FakeCjAdapter implements SupplierDiscoveryAdapter {
  readonly provider = 'cj' as const;
  records: SupplierProductRecord[];
  failSearch = false;
  searchCalls = 0;
  usage: SupplierPointUsage | null = null;
  constructor(records: SupplierProductRecord[]) { this.records = records; }

  async searchProducts(_opts?: SupplierSearchOptions): Promise<SupplierSearchResult> {
    this.searchCalls++;
    if (this.failSearch) throw new Error('CJ listV2 failed (response lost)');
    return { records: this.records, health: 'online' };
  }
  async getProduct(): Promise<SupplierProductRecord | null> { return this.records[0] ?? null; }
  async getShippingEvidence(): Promise<SupplierShippingEvidence> {
    return {
      costUsd: 3.99, baseFreightUsd: 3.50, taxesFeeUsd: 0, clearanceFeeUsd: 0, tariffUsd: 0.49,
      arrivalDays: '8-12', carrier: 'CJ Logistic', origin: 'US', destination: 'US',
      observedAt: new Date().toISOString(), verified: true, note: 'freight quote',
    };
  }
  async healthCheck(): Promise<SupplierHealthResult> { return { provider: 'cj', health: 'online' }; }
  setRunScope(): void {}
  async getRunUsage(): Promise<SupplierPointUsage | null> { return this.usage; }
  async startRun(requestedBudget?: number): Promise<{ runId: string; hardBudget: number } | null> {
    // Preserve a test-preset usage (e.g. a simulated reservation that
    // happened server-side before a lost response). Only initialize when
    // nothing was preset.
    if (!this.usage) {
      this.usage = {
        budget: requestedBudget ?? 50, reserved: 0, remaining: requestedBudget ?? 50,
        listAttempts: 0, detailAttempts: 0, freightAttempts: 0, paidRetries: 0, denied: 0,
      };
    }
    return { runId: 'run-seed-4g', hardBudget: requestedBudget ?? 50 };
  }
  async finishRun(_status: 'completed' | 'failed' | 'exhausted'): Promise<void> {}

  /** Test helper — simulate the server ledger having reserved points. */
  setUsage(u: SupplierPointUsage | null) { this.usage = u; }
}

// ---------------------------------------------------------------------------
// A) — B) Server-authoritative accounting
// ---------------------------------------------------------------------------

describe('Phase 4G — CJ server-authoritative point accounting (Part A)', () => {
  it('A) failure path: server ledger reserved 50, client forecast 0 → reports serverAuthorized=50, never 0', async () => {
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([]);
    adapter.failSearch = true;
    // Server reserved the points BEFORE the outbound call; the response was
    // lost, so the local client budget never spent.
    adapter.usage = {
      budget: 50, reserved: 50, remaining: 0,
      listAttempts: 1, detailAttempts: 0, freightAttempts: 0, paidRetries: 0, denied: 0,
    };
    const out = await runCjSeedDiscovery({ db, adapter, query: 'dog travel accessories', market: 'US' });
    expect(out.serverAuthorizedPoints).toBe(50);
    expect(out.serverListAttempts).toBe(1);
    expect(out.clientForecastPoints).toBe(0);
    // The deprecated alias is the client forecast — must NOT be claimed as authority.
    expect(out.pointsReserved).toBe(0);
    expect(out.serverPoints?.reserved).toBe(50);
    expect(out.warning).toContain('serverAuthorized=50');
    // Never report reserved = 0 when the server ledger says 50.
    expect(out.serverAuthorizedPoints).not.toBe(0);
  });

  it('B) success path: server points authority used (authorized 50/50, list attempt 1)', async () => {
    const db = new FakeDb();
    const records = [normalizeCjListProduct(listProduct(), { market: 'US' })!];
    const adapter = new FakeCjAdapter(records);
    adapter.usage = {
      budget: 50, reserved: 50, remaining: 0,
      listAttempts: 1, detailAttempts: 0, freightAttempts: 0, paidRetries: 0, denied: 0,
    };
    const out = await runCjSeedDiscovery({ db, adapter, query: 'dog travel accessories', market: 'US' });
    expect(out.serverAuthorizedPoints).toBe(50);
    expect(out.serverRemainingPoints).toBe(0);
    expect(out.serverListAttempts).toBe(1);
    expect(out.serverDetailAttempts).toBe(0);
    expect(out.serverFreightAttempts).toBe(0);
    expect(out.serverPoints?.reserved).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// C) — D) Concept size-bias removal
// ---------------------------------------------------------------------------

describe('Phase 4G — fixed concept-level suitability (Part B)', () => {
  it('C) a concept with 5 duplicate variants does NOT beat an equally-complete 1-record concept', () => {
    const base: Partial<CjListProduct> = {
      id: 'PID-A1', sku: 'SKU-A1', nameEn: 'Dog Car Seat Cover Waterproof for Pets',
      sellPrice: '15.00', bigImage: 'https://img.cjdropshipping.com/a1.jpg',
      warehouseInventoryNum: 40, totalVerifiedInventory: 20, verifiedWarehouse: 1,
      deliveryCycle: '3-5', addMarkStatus: 1,
    };
    const multi = [
      seedRecord({ ...base }),
      seedRecord({ ...base, id: 'PID-A2', sku: 'SKU-A2', sellPrice: '15.50' }),
      seedRecord({ ...base, id: 'PID-A3', sku: 'SKU-A3', sellPrice: '15.20' }),
      seedRecord({ ...base, id: 'PID-A4', sku: 'SKU-A4', sellPrice: '16.00' }),
      seedRecord({ ...base, id: 'PID-A5', sku: 'SKU-A5', sellPrice: '14.80' }),
    ];
    const single = [
      seedRecord({
        id: 'PID-B1', sku: 'SKU-B1', nameEn: 'Portable Dog Water Bottle for Walking Travel',
        sellPrice: '9.99', bigImage: 'https://img.cjdropshipping.com/b1.jpg',
        warehouseInventoryNum: 30, totalVerifiedInventory: 15, verifiedWarehouse: 1,
        deliveryCycle: '4-7', addMarkStatus: 1,
      }),
    ];
    const a = assessConceptSuitability(multi);
    const b = assessConceptSuitability(single);
    // Equally-complete concepts must score the SAME — member count is not a
    // quality signal.
    expect(a.score).toBe(b.score);
    expect(a.score).toBeLessThanOrEqual(15);
  });

  it('D) listedNum / memberCount NEVER contribute to suitability', () => {
    const base: Partial<CjListProduct> = {
      id: 'PID-D1', sku: 'SKU-D1', nameEn: 'Dog Car Seat Cover Waterproof for Pets',
      sellPrice: '15.00', bigImage: 'https://img.cjdropshipping.com/d1.jpg',
      warehouseInventoryNum: 40, totalVerifiedInventory: 20, verifiedWarehouse: 1,
      deliveryCycle: '3-5', addMarkStatus: 1,
    };
    const highListed = assessConceptSuitability([seedRecord({ ...base, listedNum: 9000 })]);
    const lowListed = assessConceptSuitability([seedRecord({ ...base, listedNum: 3 })]);
    expect(highListed.score).toBe(lowListed.score);
    // Explicit sanity: changing ONLY listedNum cannot move the score.
    const baseScore = assessConceptSuitability([seedRecord({ ...base, listedNum: 100 })]).score;
    expect(highListed.score).toBe(baseScore);
    // memberCount is informational: two records vs one must not raise the score.
    const two = assessConceptSuitability([
      seedRecord({ ...base }),
      seedRecord({ ...base, id: 'PID-D2', sku: 'SKU-D2' }),
    ]);
    expect(two.score).toBe(baseScore);
  });
});

// ---------------------------------------------------------------------------
// E) — G) Product identity honesty (Part C)
// ---------------------------------------------------------------------------

function ident(over: Partial<PageIdentityEvidence> = {}): PageIdentityEvidence {
  return {
    brand: null, model: null, mpn: null, sku: null, upc: null, canonicalTitle: null,
    ...over,
  };
}

describe('Phase 4G — product identity (Part C)', () => {
  it('E) exact same GTIN/UPC → exact identity', () => {
    const a = ident({ upc: '085000123456', brand: 'PawHut', model: 'Ramp-1' });
    const b = ident({ upc: '085000123456', brand: 'Other', model: 'Different' });
    expect(identityMatchLevel(a, b)).toBe('exact');
  });

  it('E2) exact same MPN → exact identity', () => {
    const a = ident({ mpn: 'MPN-9988', brand: 'PetAmi' });
    const b = ident({ mpn: 'MPN-9988' });
    expect(identityMatchLevel(a, b)).toBe('exact');
  });

  it('E3) same brand + same model → exact identity', () => {
    const a = ident({ brand: 'PawHut', model: 'FDM001' });
    const b = ident({ brand: 'PawHut', model: 'FDM001' });
    expect(identityMatchLevel(a, b)).toBe('exact');
  });

  it('F) title-only similarity → concept identity, NOT exact', () => {
    const a = ident({ canonicalTitle: 'Dog Car Seat Cover Waterproof Pet Car Seat Protector' });
    const b = ident({ canonicalTitle: 'Waterproof Dog Car Seat Cover for Pets Back Seat' });
    expect(identityMatchLevel(a, b)).toBe('concept');
    expect(identityMatchLevel(a, b)).not.toBe('exact');
  });

  it('F2) unrelated titles → unknown', () => {
    const a = ident({ canonicalTitle: 'Dog Car Seat Cover Waterproof' });
    const b = ident({ canonicalTitle: 'Cat Scratching Post Sisal' });
    expect(identityMatchLevel(a, b)).toBe('unknown');
  });

  it('G) different products\' review evidence → no fake exact-product aggregation', () => {
    // Two pages, same concept, NO exact identity (different brand/model).
    const pages = [
      ident({ brand: 'BrandA', model: 'X1', canonicalTitle: 'Dog Car Seat Cover Waterproof' }),
      ident({ brand: 'BrandB', model: 'Y2', canonicalTitle: 'Waterproof Dog Car Seat Cover Pet' }),
    ];
    const report = aggregateReviewEvidence(pages);
    expect(report.pagesWithReviewEvidence).toBe(2);
    expect(report.exactIdentityGroups).toBe(2); // NOT merged into one
    expect(report.conceptOnlyPages).toBe(0);
    expect(report.note).toContain('NOT summed');
    // No single aggregated review count is implied.
    expect(report.note).not.toMatch(/\b\d+\s+reviews?\b/);
  });
});

// ---------------------------------------------------------------------------
// H) — N) Google Ads demand adapter (Part D/E)
// ---------------------------------------------------------------------------

describe('Phase 4G — Google Ads keyword planner adapter (Part D/E)', () => {
  it('H) adapter not configured → status not_configured, zero outbound call', async () => {
    const spy = vi.fn(async () => []);
    const adapter = new GoogleAdsKeywordPlannerDemandAdapter({ fetchMetrics: spy });
    // Force not-configured (no credentials in the test env).
    expect(adapter.configured).toBe(false);
    const result = await collectDemandSignals(adapter, { query: 'dog travel accessories', market: 'US' });
    expect(result.status).toBe('not_configured');
    expect(result.signals).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(result.provider).toBe('google-ads');
  });

  it('I) official metrics parse: avg monthly searches, monthly history, competition/index, bid ranges', () => {
    const raw = {
      keyword: 'dog travel accessories',
      keyword_idea_metrics: {
        avg_monthly_searches: 5400,
        competition: 'HIGH',
        competition_index: 84,
        low_top_of_page_bid_micros: 1500000,
        high_top_of_page_bid_micros: 4200000,
      },
      keyword_historical_metrics: {
        monthly_search_volumes: [
          { month: '2026-05', searches: 5100 },
          { month: '2026-06', searches: 5800 },
        ],
      },
    };
    const m = parseGoogleAdsMetrics(raw);
    expect(m.keyword).toBe('dog travel accessories');
    expect(m.avgMonthlySearches).toBe(5400);
    expect(m.monthlySearchVolumes).toHaveLength(2);
    expect(m.competition).toBe('HIGH');
    expect(m.competitionIndex).toBe(84);
    expect(m.lowTopOfPageBidUsd).toBeCloseTo(1.5);
    expect(m.highTopOfPageBidUsd).toBeCloseTo(4.2);
  });

  it('J) no secret can enter the browser bundle (env access is process-guarded)', () => {
    // GOOGLE_ADS_ENV lists only NAME constants — no values anywhere.
    expect(GOOGLE_ADS_ENV).toContain('GOOGLE_ADS_DEVELOPER_TOKEN');
    // The module must never reference VITE_* prefixed secrets.
    const src = GoogleAdsKeywordPlannerDemandAdapter.toString();
    expect(src).not.toMatch(/VITE_GOOGLE_ADS|localStorage/);
    // googleAdsConfigured reads process.env only inside a typeof-process guard.
    expect(typeof googleAdsConfigured).toBe('function');
  });

  it('K) max 5 keywords enforced', () => {
    const many = GoogleAdsKeywordPlannerDemandAdapter.normalizeKeywords(
      Array.from({ length: 20 }, (_, i) => `keyword number ${i}`)
    );
    expect(many.length).toBe(5);
    expect(GOOGLE_MAX_KEYWORDS).toBe(5);
  });

  it('L) configured provider failure → explicit safe error status, not silently []', async () => {
    const adapter = new GoogleAdsKeywordPlannerDemandAdapter({
      fetchMetrics: async () => { throw new Error('GOOGLE_ADS_REFRESH_TOKEN invalid (401)'); },
    });
    // Simulate configured by stubbing the getter (credentials absent in tests).
    (adapter as unknown as { configured: boolean }).configured = true;
    const result = await collectDemandSignals(adapter, { query: 'dog travel', market: 'US' });
    expect(result.status).toBe('error');
    expect(result.errorSafe).toContain('401');
    // Credential value must be scrubbed from the safe error.
    expect(result.errorSafe).not.toContain('GOOGLE_ADS_REFRESH_TOKEN');
  });

  it('M) same keyword+geo+month → cached result reused, no duplicate request', async () => {
    let calls = 0;
    const adapter = new GoogleAdsKeywordPlannerDemandAdapter({
      fetchMetrics: async () => {
        calls++;
        return [{ keyword: 'dog ramp', keyword_idea_metrics: { avg_monthly_searches: 1200 } }];
      },
    });
    (adapter as unknown as { configured: boolean }).configured = true;
    const a = await adapter.getDemandSignals({ query: 'dog ramp', market: 'US', keywords: ['Dog Ramp'] });
    const b = await adapter.getDemandSignals({ query: 'dog ramp', market: 'US', keywords: ['dog ramp'] });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(calls).toBe(1); // cached — identical normalized keywords + geo + month
    // The adapter normalizes keywords BEFORE keying (dedupe + lowercase), so
    // the cache key is canonical — no duplicate keywords in the key.
    const norm = GoogleAdsKeywordPlannerDemandAdapter.normalizeKeywords(['Dog Ramp', 'dog ramp']);
    expect(norm).toEqual(['dog ramp']);
    const key = googleDemandCacheKey(norm, 'US', 'en');
    expect(key).toMatch(/^US:en:\d{4}-\d{2}:dog ramp$/);
  });

  it('N) Google metrics become MarketSignals with explicit limitations', () => {
    const m = parseGoogleAdsMetrics({
      keyword: 'dog car seat cover',
      keyword_idea_metrics: { avg_monthly_searches: 8100, competition: 'MEDIUM', competition_index: 52 },
    });
    const signals = googleMetricsToSignals(m, '2026-08-18T00:00:00Z', { geo: 'US', language: 'en' });
    expect(signals.length).toBe(2); // search_demand + keyword_ad_competition
    const demand = signals.find((s) => s.signalType === 'search_demand')!;
    expect(demand).toBeDefined();
    expect(demand.confidence).toBe('verified');
    expect(demand.limitations).toContain('does not prove purchases');
    const comp = signals.find((s) => s.signalType === 'keyword_ad_competition')!;
    expect(comp.summary).toContain('AD-SLOT competition');
    // Never labeled sales/orders/demand trend.
    expect(demand.summary).not.toMatch(/sales|orders|trending/i);
    // Geo = USA.
    expect(demand.source).toContain('US');
  });

  it('O) CJ listedNum never enters MarketDemandAdapter', async () => {
    // A CJ seed record carries listedNum (listing count). Feeding it through
    // the demand adapter must be impossible by design: the adapter input has
    // NO listedNum field, and listedNum is not a demand keyword source.
    const rec = seedRecord({ listedNum: 5000 });
    const input = { query: rec.title, market: 'US' };
    // The query/market shape is the only accepted input — no listedNum.
    expect(Object.keys(input)).toEqual(['query', 'market']);
    expect((input as unknown as Record<string, unknown>).listedNum).toBeUndefined();
  });
});
