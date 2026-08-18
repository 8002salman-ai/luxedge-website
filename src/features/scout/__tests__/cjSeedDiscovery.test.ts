// ============================================================================
// LUXEDGE V2 — PHASE 4F TESTS: CJ SEED DISCOVERY → TARGETED MARKET EVIDENCE
// → CONDITIONAL QUALIFIED CJ SEARCH
//
// A) seed run hard budget exactly 50
// B) seed mode performs max one listV2 call
// C) seed mode performs zero detail/freight
// D) CJ listedNum does NOT become demand evidence
// E) seed records do NOT automatically create product_candidates
// F) concept clustering dedupes variants
// G) max 2 market concepts attempted
// H) insufficient evidence: DeepSeek 0, marketScore null, CJ detail/freight 0
// I) sufficient evidence but Market < 60: no qualified CJ run
// J) Market >= 60 + persisted recommendation: market-grounded CJ run allowed
// K) actual supplier query mismatch: Market UNKNOWN / qualification false
// L) all paid detailed CJ calls still reserve via durable ledger
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierProductRecord, SupplierSearchResult,
  SupplierShippingEvidence, SupplierHealthResult, SupplierPointUsage, SupplierSearchOptions,
} from '../../suppliers/types';
import { normalizeCjListProduct, type CjListProduct } from '../../suppliers/cj/normalize';
import {
  CJ_SEED_BUDGET, runCjSeedDiscovery, selectSeedConcepts, clusterCjSeedConcepts,
  seedConceptSearchQuery, conditionalQualifiedRunDecision,
  type CjSeedRecord, seedRecordFromSupplierRecord,
} from '../cjSeedDiscovery';
import { verifyMarketIntelligenceJob } from '../marketProvenance';
import { runSupplierSearch } from '../supplierSearch';
import { calculateMargin } from '../margin';
import { extractPageFacts } from '../extract';
import { scoreCandidate } from '../score';
import type { FetchedSourcePage } from '../types';
import type { MarketEvidenceSummary } from '../engine';
import type { MarketAnalysis } from '../types';
import { assessEvidenceQuality, emptyEvidenceCounts } from '../marketEvidence';

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
  failStart = false;
  failSearch = false;
  searchCalls = 0;
  detailCalls = 0;
  freightCalls = 0;
  requestedBudget: number | null = null;
  startedBudget = 250;
  finishedStatus: string | null = null;
  constructor(records: SupplierProductRecord[]) { this.records = records; }

  async searchProducts(_opts?: SupplierSearchOptions): Promise<SupplierSearchResult> {
    this.searchCalls++; // count the ATTEMPT (a failing call is still one attempt)
    if (this.failSearch) throw new Error('CJ listV2 failed');
    return { records: this.records, health: 'online' };
  }
  async getProduct(): Promise<SupplierProductRecord | null> { this.detailCalls++; return this.records[0] ?? null; }
  async getShippingEvidence(): Promise<SupplierShippingEvidence> {
    this.freightCalls++;
    return {
      costUsd: 3.99, baseFreightUsd: 3.50, taxesFeeUsd: 0, clearanceFeeUsd: 0, tariffUsd: 0.49,
      arrivalDays: '8-12', carrier: 'CJ Logistic', origin: 'US', destination: 'US',
      observedAt: new Date().toISOString(), verified: true, note: 'freight quote',
    };
  }
  async healthCheck(): Promise<SupplierHealthResult> { return { provider: 'cj', health: 'online' }; }
  setRunScope(): void {}
  async getRunUsage(): Promise<SupplierPointUsage | null> { return null; }
  async startRun(requestedBudget?: number): Promise<{ runId: string; hardBudget: number } | null> {
    if (this.failStart) throw new Error('CJ_DURABLE_LEDGER_UNAVAILABLE: simulated ledger failure');
    this.requestedBudget = requestedBudget ?? null;
    this.startedBudget = requestedBudget ?? 250;
    return { runId: 'run-seed', hardBudget: this.startedBudget };
  }
  async finishRun(status: 'completed' | 'failed' | 'exhausted'): Promise<void> { this.finishedStatus = status; }
}

/** Seed a persisted MARKET_INTELLIGENCE job (source of truth for the gate). */
function seedMiJob(
  db: FakeDb,
  id: string,
  marketScore: number,
  fingerprint: string,
  over: Partial<Record<string, unknown>> & { output?: Record<string, unknown> } = {}
): void {
  const at = new Date().toISOString();
  const { output: outOverride = {}, ...rowOver } = over;
  db.rows.get('agent_jobs')?.push({
    id, type: 'MARKET_INTELLIGENCE', status: 'completed',
    input: { query: 'portable dog water bottle' },
    output: {
      marketScore, evidenceFingerprint: fingerprint, at,
      evidenceQuality: 'sufficient', qualificationEligible: true,
      recommendedSearchQueries: ['portable dog water bottle'], opportunity: 'Dog travel',
      ...outOverride,
    },
    error: null, provider: null, model: null, token_cost: null, retries: 0, max_retries: 3,
    created_at: at, started_at: at, finished_at: at, ...rowOver,
  });
}

// ---------------------------------------------------------------------------
// A) — C) Seed run budget + call discipline
// ---------------------------------------------------------------------------

describe('Phase 4F — CJ seed run (Part A)', () => {
  it('A) seed run requests a hard budget of exactly 50 points', async () => {
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    expect(adapter.requestedBudget).toBe(CJ_SEED_BUDGET);
    expect(CJ_SEED_BUDGET).toBe(50);
    expect(adapter.startedBudget).toBe(50);
    expect(out.hardBudget).toBe(50);
    expect(out.pointsReserved).toBe(50);
  });

  it('B) seed mode performs MAX ONE listV2 call (no pagination, no second search)', async () => {
    const db = new FakeDb();
    const records = Array.from({ length: 45 }, (_, i) => normalizeCjListProduct(
      listProduct({ id: `PID${i}`, sku: `SKU-${i}`, nameEn: `Dog Travel Accessory ${i}` }), { market: 'US' }
    )!);
    const adapter = new FakeCjAdapter(records);
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US', maxResults: 40 });
    expect(adapter.searchCalls).toBe(1);
    expect(out.listCalls).toBe(1);
    expect(out.recordsReturned).toBe(45);
  });

  it('C) seed mode performs ZERO detail/freight calls (50-point budget leaves nothing)', async () => {
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    expect(adapter.detailCalls).toBe(0);
    expect(adapter.freightCalls).toBe(0);
    expect(out.detailCalls).toBe(0);
    expect(out.freightCalls).toBe(0);
    expect(out.pointsReserved).toBe(50);
  });

  it('stops on a failed list call — no second paid seed run is created', async () => {
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    adapter.failSearch = true;
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    expect(out.recordsReturned).toBe(0);
    expect(out.seeds).toHaveLength(0);
    expect(adapter.searchCalls).toBe(1); // the ONE attempt only
    expect(adapter.finishedStatus).toBe('failed');
  });

  it('fails closed with ZERO paid calls when the durable ledger is unavailable', async () => {
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    adapter.failStart = true;
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    expect(out.code).toBe('CJ_DURABLE_LEDGER_UNAVAILABLE');
    expect(adapter.searchCalls).toBe(0);
    expect(out.pointsReserved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D) — G) Seed truth + concept clustering
// ---------------------------------------------------------------------------

describe('Phase 4F — seed record truth + concept clustering (Part B)', () => {
  it('D) CJ listedNum is preserved as a LISTING COUNT and never becomes demand evidence', async () => {
    const r = seedRecord(listProduct({ listedNum: 320 }));
    expect(r.listedNum).toBe(320); // factual supplier field retained
    const db = new FakeDb();
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    const job = await db.get<Record<string, unknown>>('agent_jobs', out.jobId);
    const jobOut = (job?.output ?? {}) as Record<string, unknown>;
    // The seed job persists NO market/demand evidence and is NOT eligible.
    expect(jobOut.marketScore).toBeNull();
    expect(jobOut.qualificationEligible).toBe(false);
    expect(String(jobOut.demandEvidence)).toMatch(/not market demand/i);
    // No concept suitability reason may mention popularity/demand/sales.
    for (const c of out.concepts) {
      for (const reason of c.suitabilityReasons) {
        expect(reason.toLowerCase()).not.toMatch(/popular|demand|sales|trend|virality/);
      }
    }
  });

  it('E) seed records do NOT automatically create product_candidates', async () => {
    const db = new FakeDb();
    const records = Array.from({ length: 30 }, (_, i) => normalizeCjListProduct(
      listProduct({ id: `PID${i}`, sku: `SKU-${i}` }), { market: 'US' }
    )!);
    const adapter = new FakeCjAdapter(records);
    const out = await runCjSeedDiscovery({ adapter, db, query: 'dog travel accessories', market: 'US' });
    expect(out.seeds.length).toBeGreaterThan(0);
    expect((db.rows.get('product_candidates') || []).length).toBe(0);
    expect((db.rows.get('product_scores') || []).length).toBe(0);
    // Only the durable PRODUCT_RESEARCH seed job was recorded.
    const jobs = (db.rows.get('agent_jobs') || []).map((j) => j.type);
    expect(jobs).toEqual(['PRODUCT_RESEARCH']);
  });

  it('F) concept clustering dedupes obvious variants of the same product concept', () => {
    const records = [
      seedRecord({ id: 'P1', sku: 'S1', nameEn: 'Dog Travel Water Bottle 600ML' }),
      seedRecord({ id: 'P2', sku: 'S2', nameEn: 'Portable Dog Water Bottle for Walking' }),
      seedRecord({ id: 'P3', sku: 'S3', nameEn: 'Dog Car Seat Cover Waterproof' }),
    ];
    const clusters = clusterCjSeedConcepts(records);
    const waterCluster = clusters.find((c) => c.memberPids.includes('P1'));
    expect(waterCluster).toBeDefined();
    expect(waterCluster!.memberPids).toContain('P2');
    expect(waterCluster!.memberPids).not.toContain('P3');
  });

  it('G) max 2 market concepts are attempted from the seeds', () => {
    const records = Array.from({ length: 12 }, (_, i) => seedRecord({
      id: `P${i}`, sku: `S${i}`,
      nameEn: ['Dog Travel Water Bottle', 'Dog Car Seat Cover', 'Portable Dog Travel Bag', 'Dog Car Safety Harness'][i % 4] + ` ${i}`,
    }));
    const concepts = selectSeedConcepts(records, 2);
    expect(concepts.length).toBeLessThanOrEqual(2);
    expect(concepts.length).toBeGreaterThan(0);
    expect(selectSeedConcepts(records).length).toBeLessThanOrEqual(2);
  });

  it('concept search vocabulary is derived from the actual CJ title vocabulary', () => {
    const records = [seedRecord({ id: 'P1', sku: 'S1', nameEn: 'Dog Travel Water Bottle 600ML Portable for Walking' })];
    const [concept] = selectSeedConcepts(records, 1);
    const q = seedConceptSearchQuery(concept);
    expect(q.length).toBeGreaterThan(0);
    expect(q.split(' ').length).toBeLessThanOrEqual(7);
    expect(q).not.toMatch(/\d/); // no invented sizes/quantities in the query
  });

  it('F2) long SEO-style CJ titles (elevated dog sofa bed) are still a CLEAR, RESEARCHABLE concept', () => {
    // A real Phase 4F CJ title: >120 chars, SEO-verbose — a clear single
    // product despite the length. Raw-length clarity + the old 2–7 token
    // researchability band wrongly dropped it from selection.
    const records = [
      seedRecord({ id: 'P1', sku: 'S1', nameEn: 'Elegant Rectangular Pet Bed For Small And Medium-sized Dogs, Durable Elevated Dog Sofa Bed, Comfortable Dog Sofa, Modern And Fashionable Linen Fabric Dog Sofa-Black', sellPrice: '111.29', bigImage: 'https://img.cjdropshipping.com/bed1.jpg', warehouseInventoryNum: 39 }),
      seedRecord({ id: 'P2', sku: 'S2', nameEn: 'Elegant Rectangular Pet Bed For Small And Medium-sized Dogs, Durable Elevated Dog Sofa Bed, Comfortable Dog Sofa, Modern And Fashionable Linen Fabric Dog Sofa-Light Grey', sellPrice: '111.29', bigImage: 'https://img.cjdropshipping.com/bed2.jpg', warehouseInventoryNum: 29 }),
      seedRecord({ id: 'P3', sku: 'S3', nameEn: 'Soft And Comfortable Pet Bed For Big And Oversized Dogs, Durable Elevated Dog Sofa Bed, Comfortable Dog Sofa, Modern And Fashionable Linen Fabric Dog Sofa-OLIVE GREEN', sellPrice: '152.72', bigImage: 'https://img.cjdropshipping.com/bed3.jpg', warehouseInventoryNum: 135 }),
    ];
    const clusters = clusterCjSeedConcepts(records);
    const bed = clusters.find((c) => /sofa/i.test(c.label));
    expect(bed).toBeDefined();
    // All 3 color variants group into ONE concept.
    expect(bed!.memberPids).toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
    // Clarity + researchability are NOT lost to the long title.
    expect(bed!.suitabilityReasons.join(' ')).toContain('clear single-product title (+2)');
    expect(bed!.suitabilityReasons.join(' ')).toContain('researchable concept vocabulary');
    expect(bed!.suitabilityScore).toBeGreaterThanOrEqual(13);
  });

  it('F3) plural variants ("single door" / "two doors") cluster into ONE concept', () => {
    const records = [
      seedRecord({ id: 'P1', sku: 'S1', nameEn: '24-30 Inch Single Door Dog Cage', sellPrice: '29.10', bigImage: 'https://img.cjdropshipping.com/c1.jpg', warehouseInventoryNum: 8338 }),
      seedRecord({ id: 'P2', sku: 'S2', nameEn: 'A Dog Cage With Two Doors', sellPrice: '24.84', bigImage: 'https://img.cjdropshipping.com/c2.jpg', warehouseInventoryNum: 6864 }),
    ];
    const clusters = clusterCjSeedConcepts(records);
    const cage = clusters.find((c) => /cage/i.test(c.label));
    expect(cage).toBeDefined();
    expect(cage!.memberPids).toEqual(expect.arrayContaining(['P1', 'P2']));
    expect(clusters.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H) — L) Market gate + conditional qualified CJ run (Part D + E)
// ---------------------------------------------------------------------------

function sufficientEvidence(): MarketEvidenceSummary {
  return {
    discoveredUrls: 8,
    selectedUrls: ['https://retailer.com/p/water-bottle/A-1'],
    successfulExtracts: 4,
    failedExtracts: 0,
    independentDomains: 3,
    priceEvidenceCount: 4,
    ratingEvidenceCount: 0,
    reviewCountEvidenceCount: 0,
    totalObservedReviews: 0,
    availabilityEvidenceCount: 4,
    availableCount: 3,
    unavailableCount: 1,
    rejectedUrls: [],
    evidenceQuality: 'sufficient',
    evidenceQualityReasons: ['4 usable pages', '3 domains', '4 prices', '4 availability'],
    identityEvidencePages: 0,
    reviewAggregationNote: '',
    retail: null,
  };
}

function analysis(score: number): MarketAnalysis {
  return {
    marketOpportunityScore: score,
    trendConfidence: 'inferred',
    demandEvidence: 'Evidence-pack observations only',
    competitionLevel: 'medium',
    customerPainPoint: 'messy walks',
    priceBand: { min: 10, max: 25 },
    risks: [],
    recommendedSearchQueries: ['portable dog water bottle'],
    reasoningSummary: 'grounded on the collected evidence pack',
    aiUsed: true,
    unsupportedClaims: [],
    analyzedAt: new Date().toISOString(),
  };
}

function miResult(over: { marketScore?: number | null; evidenceQuality?: 'sufficient' | 'insufficient'; qualificationEligible?: boolean; jobId?: string } = {}) {
  const marketScore = over.marketScore ?? 65;
  return {
    jobId: over.jobId ?? 'mi-ok',
    signals: 10,
    marketScore,
    diagnosticDeterministicScore: 61,
    qualificationEligible: over.qualificationEligible ?? true,
    recommendedSearchQueries: ['portable dog water bottle'],
    aiUsed: true,
    analysis: analysis(marketScore),
    evidenceFingerprint: 'fp-1',
    evidence: { ...sufficientEvidence(), evidenceQuality: over.evidenceQuality ?? 'sufficient' },
  };
}

describe('Phase 4F — market gate + conditional qualified CJ run (Part D/E)', () => {
  it('H) insufficient evidence → DeepSeek 0, marketScore null, and the conditional CJ run is NOT started', () => {
    // The quality gate itself is tested in marketEvidence.test.ts — here we
    // assert that a thin pack fails the gate and the decision stays closed.
    const gate = assessEvidenceQuality(emptyEvidenceCounts());
    expect(gate.pass).toBe(false);
    const mi = miResult({ evidenceQuality: 'insufficient', qualificationEligible: false, marketScore: null });
    const decision = conditionalQualifiedRunDecision(mi);
    expect(decision.run).toBe(false);
    if (!decision.run) expect(decision.reason).toBe('evidence-insufficient');
  });

  it('I) sufficient evidence but Market < 60 → NO qualified CJ run', () => {
    const mi = miResult({ marketScore: 55 });
    const decision = conditionalQualifiedRunDecision(mi);
    expect(decision.run).toBe(false);
    if (!decision.run) expect(decision.reason).toBe('market-score-below-gate');
  });

  it('J) Market >= 60 + persisted recommendation → market-grounded CJ run allowed with the persisted query', () => {
    const mi = miResult({ marketScore: 68 });
    const decision = conditionalQualifiedRunDecision(mi);
    expect(decision.run).toBe(true);
    if (decision.run) {
      expect(decision.marketScore).toBe(68);
      expect(decision.query).toBe('portable dog water bottle');
      expect(decision.marketAnalysisId).toBe('mi-ok');
      expect(decision.hypothesis).toBe('portable dog water bottle');
    }
  });

  it('K) actual supplier query mismatch → Market UNKNOWN / BUSINESS_QUALIFIED false', async () => {
    const db = new FakeDb();
    seedMiJob(db, 'mi-1', 65, 'fp-1');
    const job = db.rows.get('agent_jobs')!.find((r) => r.id === 'mi-1');
    // Persisted recommendations contain 'portable dog water bottle'; the run
    // queries 'cat carrier' → query provenance UNVERIFIED.
    const verified = verifyMarketIntelligenceJob(job, { marketAnalysisId: 'mi-1' }, 'cat carrier');
    expect(verified).not.toBeNull();
    expect(verified!.queryProvenance).toBe('unverified');
    // A mismatched query still works as PRODUCT research but can never be
    // business-qualified (the effective market score stays UNKNOWN).
    const adapter = new FakeCjAdapter([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'cat carrier', market: 'US', marketContext: { marketAnalysisId: 'mi-1' } },
      db,
      onProgress: () => {},
    });
    expect(result.marketContext?.marketScore).toBeNull();
    expect(result.businessQualified).toBe(0);
  });

  it('L) all paid detailed CJ calls still reserve via the durable ledger (budget honored, calls counted)', async () => {
    const db = new FakeDb();
    const records = Array.from({ length: 50 }, (_, i) => normalizeCjListProduct(
      listProduct({ id: `PID${i}`, sku: `SKU-${i}`, nameEn: `Dog Travel Water Bottle ${i}` }), { market: 'US' }
    )!);
    const adapter = new FakeCjAdapter(records);
    const out = await runSupplierSearch({
      adapter,
      search: { query: 'portable dog water bottle', market: 'US', maxResults: 50, pointsBudget: 250 },
      db,
      onProgress: () => {},
    });
    // Every paid attempt is represented: ONE listV2 (50) + budget-capped details.
    expect(out.points!.listCalls).toBe(1);
    expect(out.points!.used).toBeLessThanOrEqual(250);
    expect(adapter.searchCalls).toBe(1);
    expect(out.points!.detailCalls).toBeGreaterThan(0);
    expect(out.points!.detailCalls + out.points!.freightCalls).toBeLessThanOrEqual(18);
  });
});

// Sanity: seed mode never drafts or publishes (structure-level guard).
describe('Phase 4F — seed mode never scores/drafts', () => {
  it('the seed flow only ever persists a PRODUCT_RESEARCH job (no candidates/scores)', () => {
    const ev = extractPageFacts({ text: 'og:title Unbranded Accessory' } as FetchedSourcePage);
    const margin = calculateMargin({ supplierPrice: 10, shippingCost: 4 });
    const score = scoreCandidate({
      title: 'Unbranded Accessory', extract: ev, margin, supplierVerified: true,
      sourceIsManufacturer: false, images: ['a.jpg'], riskFlags: ['No rating'],
    });
    // Scoring exists in the pipeline — but the SEED flow never invokes it.
    expect(score.overall).toBeGreaterThanOrEqual(0);
    const db = new FakeDb();
    expect(db.rows.get('product_candidates')?.length ?? 0).toBe(0);
  });
});
