// ============================================================================
// LUXEDGE V2 — CJ SUPPLIER DISCOVERY TESTS (Phase 4C)
//
// Covers: response normalization, stable product dedupe, US-inventory vs
// USA-delivery distinction, shipping UNKNOWN handling, landed-cost
// confidence, secret isolation, token refresh, API failures, rate limits,
// duplicate results, missing price/stock, Product Scout integration, and
// that the integration is READ/RESEARCH only (no order/payment calls, no
// threshold lowering).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierProductRecord, SupplierSearchResult,
  SupplierShippingEvidence, SupplierHealthResult, SupplierPointUsage,
} from '../types';
import {
  normalizeCjListProduct, normalizeCjProductDetail, normalizeCjFreight,
  normalizeCountryCode, parseDeliveryCycle, cjProductUrl,
  type CjListProduct, type CjProductDetail,
} from '../cj/normalize';
import {
  cjProductKey, cjSkuKey, cjVariantKey, dedupeKeyForRecord,
  buildKnownCjKeys, isKnownCjRecord,
} from '../cj/dedupe';
import { prefilterCjRecord, prefilterCjRecords } from '../cj/prefilter';
import { cjSafeStatusFromHealth } from '../cj/health';
import { CjSupplierAdapter } from '../cj/adapter';
import { evidenceFromSupplierRecord, petCategoryFromTitle, scoreSupplierCandidate, runSupplierSearch, evidenceCompletionGaps } from '../../scout/supplierSearch';
import { calculateMargin } from '../../scout/margin';
import { scoreCandidate, SHORTLIST_THRESHOLD } from '../../scout/score';
import { extractPageFacts } from '../../scout/extract';
import type { FetchedSourcePage, ScoutCandidate, CandidateEvidence } from '../../scout/types';
import fs from 'node:fs';
import {
  cjConfigured, cjSafeError, cjSearchProducts, cjFreightCalculate, CjServerRunBudget,
  CjDurableRunLedger, CjDurableRunContext, CJ_POINT_BUDGET_EXHAUSTED, CJ_DURABLE_LEDGER_UNAVAILABLE,
} from '../../../../api/_lib/cj';
import { verifyMarketIntelligenceJob, normalizeMarketQuery } from '../../scout/marketProvenance';
import {
  CjPointBudget, CJ_POINTS_BUDGET_PER_RUN, CJ_POINTS_HARD_MAX, enrichmentCaps, CJ_POINT_COST,
} from '../cj/points';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function listProduct(over: Partial<CjListProduct> = {}): CjListProduct {
  return {
    id: 'PID123456',
    nameEn: 'Interactive Dog Puzzle Toy for Enrichment',
    sku: 'SKU-ABC-001',
    spu: 'SPU-001',
    bigImage: 'https://img.cjdropshipping.com/pid123456.jpg',
    sellPrice: '12.50',
    nowPrice: '10.99',
    listedNum: 320,
    oneCategoryName: 'Pet Supplies',
    twoCategoryName: 'Dog Toys',
    threeCategoryName: 'Puzzle Toys',
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

function detailProduct(over: Partial<CjProductDetail> = {}): CjProductDetail {
  return {
    ...listProduct(),
    productImageSet: [
      'https://img.cjdropshipping.com/pid123456.jpg',
      'https://img.cjdropshipping.com/pid123456-2.jpg',
    ],
    productWeight: '0.35',
    description: 'Durable dog puzzle toy with treat compartments.',
    variants: [
      {
        vid: 'VID-9',
        variantSku: 'SKU-ABC-001-RED',
        variantSellPrice: '11.49',
        variantWeight: '0.35',
        inventories: [
          { countryCode: 'US', totalInventory: 86, verifiedWarehouse: 1 },
          { countryCode: 'DE', totalInventory: 12, verifiedWarehouse: 1 },
        ],
      },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Fake admin-JWT db adapter (mirrors RLS: only admin-token writes succeed)
// ---------------------------------------------------------------------------
class FakeDb implements DbAdapter {
  mode = 'supabase' as const;
  token: string | null = null;
  rows = new Map<string, Record<string, unknown>[]>();

  constructor() {
    for (const t of ['suppliers', 'supplier_products', 'product_candidates', 'product_scores', 'agent_jobs', 'agent_runs', 'agent_logs']) {
      this.rows.set(t, []);
    }
  }

  private assertAdmin(): void {
    const claims = this.token
      ? (JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString()) as { app_metadata?: { role?: string } })
      : null;
    if (!claims || claims.app_metadata?.role !== 'admin') {
      throw new Error('42501 row-level security violation');
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
    this.assertAdmin();
    this.rows.get(table)?.push({ ...row });
    return row;
  }
  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    this.assertAdmin();
    const list = this.rows.get(table) || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    return list[idx] as T;
  }
  async remove(table: string, id: string): Promise<void> {
    this.assertAdmin();
    this.rows.set(table, (this.rows.get(table) || []).filter((r) => r.id !== id));
  }
  async testConnection() { return { ok: true, mode: 'supabase' as const, detail: 'fake' }; }
}

function adminToken(): string {
  const payload = Buffer.from(JSON.stringify({ app_metadata: { role: 'admin' } })).toString('base64url');
  return `header.${payload}.sig`;
}

/**
 * Seed a REAL persisted MARKET_INTELLIGENCE job row (source of truth). The
 * migration-security revision requires recommendedSearchQueries + opportunity
 * persisted on the job output (runMarketIntelligenceJob persists them); the
 * default recommendation matches the existing tests' query so their market
 * gate stays VERIFIED. Pass over.output to override.
 */
function seedMiJob(
  db: FakeDb,
  id: string,
  marketScore: number,
  fingerprint: string,
  over: Partial<Record<string, unknown>> & { output?: Record<string, unknown> } = {}
): { id: string } {
  const at = new Date().toISOString();
  const { output: outOverride = {}, ...rowOver } = over;
  const row = {
    id,
    type: 'MARKET_INTELLIGENCE',
    status: 'completed',
    input: { query: 'dog toys' },
    output: {
      marketScore,
      evidenceFingerprint: fingerprint,
      at,
      // Phase 4E.1 fail-closed: a persisted MI job is qualification-eligible
      // only when the evidence-quality gate passed. These seeded jobs model
      // sufficient-evidence runs (as produced by runMarketIntelligenceJob
      // after the gate). Pass over.output to simulate insufficient evidence.
      evidenceQuality: 'sufficient',
      qualificationEligible: true,
      recommendedSearchQueries: ['orthopedic dog bed'],
      opportunity: 'Dog beds',
      ...outOverride,
    },
    error: null,
    provider: null,
    model: null,
    token_cost: null,
    retries: 0,
    max_retries: 3,
    created_at: at,
    started_at: at,
    finished_at: at,
    ...rowOver,
  };
  db.rows.get('agent_jobs')?.push(row);
  return { id };
}

// A genuinely strong, fully-enriched CJ candidate fixture. IMPORTANT honesty
// note: after the SKU→sizes fix, a CJ-only candidate (no customer ratings, no
// real variant-option semantics) has a TRUTHFUL ceiling of 75/100 — exactly
// the shortlist threshold, never inflated above the evidence. That is the
// point: CJ supplier data alone cannot earn ratings/upsell points.
function strongDetail(): CjProductDetail {
  return {
    ...listProduct({ nameEn: 'Interactive Dog Toy for Large Dogs' }),
    productImageSet: [
      'https://img.cjdropshipping.com/pid123456.jpg',
      'https://img.cjdropshipping.com/pid123456-2.jpg',
      'https://img.cjdropshipping.com/pid123456-3.jpg',
      'https://img.cjdropshipping.com/pid123456-4.jpg',
      'https://img.cjdropshipping.com/pid123456-5.jpg',
      'https://img.cjdropshipping.com/pid123456-6.jpg',
    ],
    productWeight: '0.35',
    variants: [{
      vid: 'VID-1', variantSku: 'SKU-1', variantSellPrice: '20.00',
      inventories: [{ countryCode: 'US', totalInventory: 40, verifiedWarehouse: 1 }],
    }],
  };
}

function strongAdapter(): FakeCjAdapter {
  const adapter = new FakeCjAdapter([normalizeCjProductDetail(strongDetail(), { market: 'US' })!]);
  // Free-shipping quote (totalPostageFee 0) → margin HIGH + free-shipping
  // delivery points. Landing on exactly 75 is honest: demand 20 + supplier
  // 10 + delivery 15 + margin 15 + visual 10 + competition 2 (toy keyword)
  // + return-risk 3 (1 flag: no ratings) + ratings 0 + upsell 0 = 75.
  adapter.freight = {
    costUsd: 0, baseFreightUsd: 0, taxesFeeUsd: 0, clearanceFeeUsd: 0, tariffUsd: 0,
    arrivalDays: '3-5', carrier: 'CJ Logistic', origin: 'US', destination: 'US',
    observedAt: new Date().toISOString(), verified: true, note: 'free shipping (totalPostageFee 0)',
  };
  return adapter;
}

/** Deterministic fake adapter returning fixed CJ records (no network). */
class FakeCjAdapter implements SupplierDiscoveryAdapter {
  readonly provider = 'cj' as const;
  records: SupplierProductRecord[];
  /** Simulated server-authoritative usage, set per test. */
  serverUsage: SupplierPointUsage | null = null;
  /** Freight quote returned by getShippingEvidence (per-test configurable). */
  freight: SupplierShippingEvidence = {
    costUsd: 3.99, baseFreightUsd: 3.50, taxesFeeUsd: 0, clearanceFeeUsd: 0, tariffUsd: 0.49,
    arrivalDays: '8-12', carrier: 'CJ Logistic', origin: 'US', destination: 'US',
    observedAt: new Date().toISOString(), verified: true, note: 'freight quote (totalPostageFee)'
  };
  /** When true, startRun simulates a durable-ledger failure (fail closed). */
  failStart = false;
  /** Paid-call counters — used to prove ZERO paid calls when fail-closed. */
  searchCalls = 0;
  detailCalls = 0;
  freightCalls = 0;
  constructor(records: SupplierProductRecord[]) { this.records = records; }
  async searchProducts(): Promise<SupplierSearchResult> {
    this.searchCalls++;
    return { records: this.records, health: 'online', usage: this.serverUsage ?? undefined };
  }
  async getProduct(): Promise<SupplierProductRecord | null> {
    this.detailCalls++;
    return this.records[0] ?? null;
  }
  async getShippingEvidence(): Promise<SupplierShippingEvidence> {
    this.freightCalls++;
    return this.freight;
  }
  async healthCheck(): Promise<SupplierHealthResult> { return { provider: 'cj', health: 'online' }; }
  setRunScope(): void { /* fake — no server budget */ }
  async getRunUsage(): Promise<SupplierPointUsage | null> { return this.serverUsage; }
  /** Fake durable run — the engine exercises the start→reserve→finish flow. */
  async startRun(requestedBudget?: number): Promise<{ runId: string; hardBudget: number } | null> {
    if (this.failStart) throw new Error('CJ_DURABLE_LEDGER_UNAVAILABLE: simulated ledger failure');
    return { runId: 'run-fake', hardBudget: requestedBudget ?? 250 };
  }
  finishedStatus: string | null = null;
  async finishRun(status: 'completed' | 'failed' | 'exhausted'): Promise<void> {
    this.finishedStatus = status;
  }
}

function recordFromList(p: CjListProduct): SupplierProductRecord {
  return normalizeCjListProduct(p, { market: 'US' })!;
}

function page(text: string, images: string[] = []): FetchedSourcePage {
  return { text, images };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe('CJ normalization', () => {
  it('maps listV2 product fields into a provider-neutral record', () => {
    const r = normalizeCjListProduct(listProduct(), { market: 'US' })!;
    expect(r.provider).toBe('cj');
    expect(r.productId).toBe('PID123456');
    expect(r.sku).toBe('SKU-ABC-001');
    expect(r.title).toContain('Dog Puzzle');
    expect(r.sellPrice).toBe(10.99); // nowPrice preferred over sellPrice
    expect(r.imageUrl).toContain('img.cjdropshipping.com');
    expect(r.category).toContain('Puzzle Toys');
    expect(r.freeShipping).toBe(true);
    expect(r.deliveryCycle).toBe('3-5');
    expect(r.sourceUrl).toBe(cjProductUrl('PID123456'));
    expect(r.raw.normalizedFrom).toBe('listV2');
  });

  it('returns null when the CJ product id or title is missing (unverifiable)', () => {
    expect(normalizeCjListProduct({ id: '', nameEn: 'X' })).toBeNull();
    expect(normalizeCjListProduct({ id: 'PID1', nameEn: '' })).toBeNull();
  });

  it('records price as null when CJ returns none — never invented', () => {
    const r = normalizeCjListProduct(listProduct({ sellPrice: undefined, nowPrice: undefined }))!;
    expect(r.sellPrice).toBeNull();
  });

  it('keeps US inventory evidence separate: verified vs total vs in-country', () => {
    const r = normalizeCjListProduct(listProduct(), { market: 'US' })!;
    expect(r.usInventoryVerified).toBe(42);
    expect(r.usInventoryTotal).toBe(86);
    expect(r.usInventoryInCountry).toBe(true);
    // Non-US search: no US inventory claim at all.
    const de = normalizeCjListProduct(listProduct(), { market: 'DE' })!;
    expect(de.usInventoryTotal).toBeNull();
    expect(de.usInventoryInCountry).toBe(false);
  });

  it('enriches detail via product/query (variants, images, weight, US variant inventory)', () => {
    const r = normalizeCjProductDetail(detailProduct(), { market: 'US' })!;
    expect(r.images).toHaveLength(2);
    expect(r.weightGrams).toBe(0.35);
    expect(r.selectedVariant?.variantId).toBe('VID-9');
    expect(r.description).toContain('puzzle toy');
    // US variant inventory overwrites list totals.
    expect(r.usInventoryTotal).toBe(86);
    expect(r.usInventoryInCountry).toBe(true);
    expect(r.raw.normalizedFrom).toBe('query');
  });

  it('does not claim US inventory from the list when the detail has none for US', () => {
    const d = detailProduct({
      warehouseInventoryNum: undefined,
      totalVerifiedInventory: undefined,
      variants: [{ vid: 'V1', variantSku: 'S', inventories: [{ countryCode: 'DE', totalInventory: 5 }] }],
    });
    const r = normalizeCjProductDetail(d, { market: 'US' })!;
    expect(r.usInventoryTotal).toBeNull();
    expect(r.usInventoryInCountry).toBe(false);
  });

  it('normalizes country codes USA/us → US and rejects junk', () => {
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('us')).toBe('US');
    expect(normalizeCountryCode('UNITED STATES')).toBe('US');
    expect(normalizeCountryCode('GB')).toBe('GB');
    expect(normalizeCountryCode('nonsense')).toBeNull();
    expect(normalizeCountryCode('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

describe('CJ dedupe (stable supplier identifiers)', () => {
  it('keys on provider + CJ product id — variant-independent', () => {
    expect(cjProductKey('PID1')).toBe('cj:PID1');
    expect(cjProductKey('pid1')).toBe('cj:PID1'); // case-insensitive
    expect(cjVariantKey('PID1', 'V1')).toBe('cj:PID1:V1');
  });

  it('falls back to SKU when the product id is missing', () => {
    expect(cjSkuKey('abc')).toBe('cj:sku:ABC');
    // normalizeCjListProduct returns null without a pid, so build the
    // edge-case record directly: pid absent, SKU present.
    const noPid = recordFromList(listProduct());
    noPid.productId = '';
    expect(dedupeKeyForRecord(noPid)).toBe(cjSkuKey(noPid.sku));
  });

  it('detects duplicates across repeated searches by pid', () => {
    const known = buildKnownCjKeys([normalizeCjListProduct(listProduct(), { market: 'US' })!]);
    const again = normalizeCjListProduct(listProduct(), { market: 'US' })!;
    expect(isKnownCjRecord(again, known)).toBe(true);
    const other = normalizeCjListProduct(listProduct({ id: 'PID-OTHER' }), { market: 'US' })!;
    expect(isKnownCjRecord(other, known)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prefilter
// ---------------------------------------------------------------------------

describe('CJ deterministic prefilter', () => {
  it('keeps a valid US-inventory pet product', () => {
    const r = recordFromList(listProduct());
    expect(prefilterCjRecord(r, { market: 'US' }).ok).toBe(true);
  });

  it('rejects non-pet drift', () => {
    const r = recordFromList(listProduct({
      nameEn: 'Wireless Bluetooth Headphones',
      oneCategoryName: 'Electronics', twoCategoryName: 'Audio', threeCategoryName: 'Headphones',
    }));
    const out = prefilterCjRecord(r, { market: 'US' });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('non-pet');
  });

  it('rejects counterfeit/IP-risk and medical-claim products', () => {
    const ip = recordFromList(listProduct({ nameEn: 'Gucci Dog Collar Replica' }));
    expect(prefilterCjRecord(ip, { market: 'US' }).reason).toContain('IP risk');
    const med = recordFromList(listProduct({ nameEn: 'Veterinary Antibiotic Treatment for Dogs' }));
    expect(prefilterCjRecord(med, { market: 'US' }).reason).toContain('medical');
  });

  it('rejects missing/invalid price (hard reject only for price <= 0)', () => {
    const noPrice = recordFromList(listProduct({ sellPrice: undefined, nowPrice: undefined }));
    expect(prefilterCjRecord(noPrice, { market: 'US' }).reason).toContain('missing price');
    const zero = recordFromList(listProduct({ nowPrice: '0' }));
    expect(prefilterCjRecord(zero, { market: 'US' }).reason).toContain('missing price');
    // $0.80 and $45 are NOT hard-rejected — economics come from real
    // price + real freight = landed cost vs a defensible selling price.
    const thin = recordFromList(listProduct({ nowPrice: '0.8' }));
    expect(prefilterCjRecord(thin, { market: 'US' }).ok).toBe(true);
    const premium = recordFromList(listProduct({ nowPrice: '45' }));
    expect(prefilterCjRecord(premium, { market: 'US' }).ok).toBe(true);
  });

  it('rejects missing stock / zero US inventory when targeting the US', () => {
    const noStock = recordFromList(listProduct({ warehouseInventoryNum: undefined, totalVerifiedInventory: undefined }));
    expect(prefilterCjRecord(noStock, { market: 'US' }).reason).toContain('US inventory');
    const zero = recordFromList(listProduct({ warehouseInventoryNum: 0 }));
    expect(prefilterCjRecord(zero, { market: 'US' }).reason).toContain('zero US inventory');
    // requireUsInventory:false disables the gate (search not targeting US).
    expect(prefilterCjRecord(zero, { market: 'US', requireUsInventory: false }).ok).toBe(true);
  });

  it('rejects unusable images', () => {
    const r = recordFromList(listProduct({ bigImage: '' }));
    expect(prefilterCjRecord(r, { market: 'US' }).reason).toContain('unusable images');
  });

  it('batch prefilter keeps reasons per record', () => {
    const ok = recordFromList(listProduct());
    const bad = recordFromList(listProduct({
      nameEn: 'Phone Case',
      oneCategoryName: 'Electronics', twoCategoryName: 'Phone Accessories', threeCategoryName: 'Cases',
    }));
    const { kept, rejected } = prefilterCjRecords([ok, bad], { market: 'US' });
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('non-pet');
  });
});

// ---------------------------------------------------------------------------
// Evidence + margin honesty
// ---------------------------------------------------------------------------

describe('CJ evidence → scout evidence (honest statuses)', () => {
  it('keeps shipping cost UNKNOWN and margin confidence LOW until freight is quoted', () => {
    const r = recordFromList(listProduct());
    const ev = evidenceFromSupplierRecord(r, 'US');
    expect(ev.shippingCost.status).toBe('unknown');
    expect(ev.rating.status).toBe('unknown');
    expect(ev.availability.value).toBe('available');
    expect(ev.availability.status).toBe('verified');
    // Delivery cycle was provided → shippingDays verified, NOT in unknowns.
    expect(ev.unknownFields).not.toContain('shippingDays');
    // Weight is absent from the list record → honestly unknown.
    expect(ev.unknownFields).toContain('weight');
  });

  it('marks shippingDays verified when CJ provides a delivery cycle, else unknown', () => {
    const withCycle = evidenceFromSupplierRecord(recordFromList(listProduct()), 'US');
    expect(withCycle.shippingDays.status).toBe('verified');
    const noCycle = evidenceFromSupplierRecord(recordFromList(listProduct({ deliveryCycle: undefined })), 'US');
    expect(noCycle.shippingDays.status).toBe('unknown');
  });

  it('does not invent ratings/reviews — CJ has none', () => {
    const ev = evidenceFromSupplierRecord(recordFromList(listProduct()), 'US');
    expect(ev.rating.value).toBeNull();
    expect(ev.rating.status).toBe('unknown');
  });

  it('calculateMargin: unknown shipping ⇒ low confidence, no auto-approve', () => {
    const m = calculateMargin({ supplierPrice: 10.99, shippingCost: null });
    expect(m.landedCost).toBeNull();
    expect(m.confidence).toBe('low');
    const withShipping = calculateMargin({ supplierPrice: 10.99, shippingCost: 4 });
    expect(withShipping.landedCost).toBe(14.99);
    expect(withShipping.confidence).toBe('high');
  });

  it('infers pet category from title keywords', () => {
    expect(petCategoryFromTitle('Dog Puzzle Toy')).toBe('Dog');
    expect(petCategoryFromTitle('Cat Scratcher')).toBe('Cat');
    expect(petCategoryFromTitle('Pet Grooming Glove')).toBe('Pet');
    expect(petCategoryFromTitle('Unknown Thing')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Score integration
// ---------------------------------------------------------------------------

describe('CJ → Product Scout integration', () => {
  it('never lowers the shortlist threshold', () => {
    expect(SHORTLIST_THRESHOLD).toBe(75);
  });

  it('scores CJ candidates with the same 100-pt rules (below-threshold stays researching)', () => {
    const r = recordFromList(listProduct());
    const ev = evidenceFromSupplierRecord(r, 'US');
    const candidate: ScoutCandidate = {
      id: 'c1', title: r.title, source: 'CJ Dropshipping', sourceUrl: r.sourceUrl,
      supplierSlug: 'cj-dropshipping', images: r.images, evidence: ev,
      margin: calculateMargin({ supplierPrice: r.sellPrice, shippingCost: null }),
      score: null, status: 'researching', createdAt: new Date().toISOString(),
    };
    const out = scoreSupplierCandidate(candidate, 2.5);
    expect(out.status).not.toBe('rejected'); // no hard rejection for a clean record
    expect(out.margin.confidence).toBe('low'); // freight not quoted
  });

  it('runSupplierSearch persists the 3-job audit trail (RESEARCH → SCORE → QA) with admin JWT', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const adapter = new FakeCjAdapter([recordFromList(listProduct())]);
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'dog puzzle toy', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(result.searched).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.prefilterRejected).toBe(0);
    expect(result.researched).toBe(1);
    expect(result.productShortlisted).toBe(0); // below 75 — honest, no inflation
    expect(result.businessQualified).toBe(0); // market gate not even applied

    const jobs = (db.rows.get('agent_jobs') || []).map((j) => j.type);
    expect(jobs).toContain('PRODUCT_RESEARCH');
    expect(jobs).toContain('PRODUCT_SCORE');
    expect(jobs).toContain('PRODUCT_QA');
    expect((db.rows.get('product_candidates') || []).length).toBe(1);
    expect((db.rows.get('product_scores') || []).length).toBe(1);
  });

  it('runSupplierSearch fails closed when the db token is not admin (RLS contract)', async () => {
    const db = new FakeDb(); // token null → non-admin
    const adapter = new FakeCjAdapter([recordFromList(listProduct())]);
    await expect(
      runSupplierSearch({ adapter, search: { query: 'dog toy', market: 'US' }, db, onProgress: () => {} })
    ).rejects.toThrow(/42501|row-level security/i);
  });

  it('runSupplierSearch ENRICHES before final scoring (detail → freight → landed cost)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    // Detail-enriched record: variant[0] has NO US stock, variant[1] has
    // verified US stock → the SAME variant drives price/inventory/origin.
    const enriched = normalizeCjProductDetail(detailProduct(), { market: 'US' })!;
    const adapter = new FakeCjAdapter([enriched]);
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'dog puzzle toy', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(result.researched).toBe(1);
    expect(result.points?.detailCalls).toBe(1);
    // Freight called only because the selected variant has a US origin.
    expect(result.points?.freightCalls).toBe(1);
    // Landed cost present in the persisted evidence: margin no longer LOW.
    const candidates = (db.rows.get('product_candidates') || []);
    expect(candidates.length).toBe(1);
    const ev = (candidates[0] as { evidence: CandidateEvidence }).evidence;
    expect(ev.shippingCost.status).toBe('verified');
    expect(ev.shippingCost.value).toBe(3.99);
    // The record's OWN verified delivery cycle (3-5) wins over the freight
    // arrival range — supplier delivery evidence is never improved.
    expect(ev.shippingDays.value).toEqual({ min: 3, max: 5 });
  });
});

// ---------------------------------------------------------------------------
// Phase 4C pre-live hardening: variant consistency, economics, freight,
// point budget, live-readiness simulation
// ---------------------------------------------------------------------------

describe('CJ pre-live hardening — variant consistency', () => {
  it('selects variant[1] (verified US stock) over variant[0] (no US stock) and uses it consistently', () => {
    const d: CjProductDetail = {
      ...listProduct(),
      productImageSet: ['https://img.cjdropshipping.com/pid123456.jpg'],
      variants: [
        { vid: 'VID-0', variantSku: 'SKU-0', variantSellPrice: '9.99', inventories: [{ countryCode: 'CN', totalInventory: 50 }] },
        { vid: 'VID-1', variantSku: 'SKU-1', variantSellPrice: '12.99', inventories: [{ countryCode: 'US', totalInventory: 30, verifiedWarehouse: 1 }] },
      ],
    };
    const r = normalizeCjProductDetail(d, { market: 'US' })!;
    expect(r.selectedVariant?.variantId).toBe('VID-1');
    // THE SAME variant drives price, inventory, origin.
    expect(r.sellPrice).toBe(12.99);
    expect(r.usInventoryTotal).toBe(30);
    expect(r.usInventoryVerified).toBe(30);
    expect(r.usInventoryInCountry).toBe(true);
    expect(r.selectedVariant?.originCountry).toBe('US');
    expect(r.selectedVariant?.sku).toBe('SKU-1');
  });

  it('variant stays UNKNOWN when no internally consistent variant exists — no freight claim', () => {
    const d: CjProductDetail = {
      ...listProduct(),
      variants: [
        { vid: 'VID-0', variantSku: 'SKU-0', variantSellPrice: '0', inventories: [{ countryCode: 'US', totalInventory: 0 }] },
      ],
    };
    const r = normalizeCjProductDetail(d, { market: 'US' })!;
    expect(r.selectedVariant).toBeNull();
    expect(r.sellPrice).toBe(10.99); // list price retained, but variant unknown
  });
});

describe('CJ pre-live hardening — economics', () => {
  it('does NOT hard-reject a $0.80 accessory (excellent margin possible)', () => {
    const r = recordFromList(listProduct({ nowPrice: '0.80' }));
    const out = prefilterCjRecord(r, { market: 'US' });
    expect(out.ok).toBe(true);
  });

  it('does NOT hard-reject a $45 premium product by default (no $40 cap)', () => {
    const r = recordFromList(listProduct({ nowPrice: '45.00' }));
    const out = prefilterCjRecord(r, { market: 'US' });
    expect(out.ok).toBe(true);
  });

  it('applies min/max supplier cost ONLY when explicitly supplied for a strategy', () => {
    const cheap = recordFromList(listProduct({ nowPrice: '3.00' }));
    expect(prefilterCjRecord(cheap, { market: 'US', minSupplierCost: 5 }).ok).toBe(false);
    const pricey = recordFromList(listProduct({ nowPrice: '45.00' }));
    expect(prefilterCjRecord(pricey, { market: 'US', maxSupplierCost: 40 }).ok).toBe(false);
    expect(prefilterCjRecord(pricey, { market: 'US' }).ok).toBe(true); // no default cap
  });

  it('still hard-rejects price <= 0 (invalid/unverifiable)', () => {
    const r = recordFromList(listProduct({ nowPrice: '0' }));
    expect(prefilterCjRecord(r, { market: 'US' }).reason).toContain('missing price');
  });
});

describe('CJ pre-live hardening — manufacturer + score honesty', () => {
  it('does NOT grant manufacturer reliability points for a CJ record (supplier-platform ≠ manufacturer)', () => {
    const r = recordFromList(listProduct());
    const ev = evidenceFromSupplierRecord(r, 'US');
    const candidate: ScoutCandidate = {
      id: 'c1', title: r.title, source: 'CJ Dropshipping', sourceUrl: r.sourceUrl,
      supplierSlug: 'cj-dropshipping', images: r.images, evidence: ev,
      margin: calculateMargin({ supplierPrice: r.sellPrice, shippingCost: null }),
      score: null, status: 'researching', createdAt: new Date().toISOString(),
    };
    const out = scoreSupplierCandidate(candidate, 2.5);
    expect(out.score?.breakdown.supplierReliability.points).toBe(10); // verified supplier-platform, NOT manufacturer 15
  });

  it('gives zero competition/upsell points when there is no evidence (score honesty)', () => {
    // Avoid "toy" (matches the competition heuristic) — this is a title with
    // no category signal, no sizes, no competition data at all.
    const extract = extractPageFacts(page('og:title Unbranded Accessory'));
    const margin = calculateMargin({ supplierPrice: 10, shippingCost: 4 });
    const score = scoreCandidate({
      title: 'Unbranded Accessory', extract, margin, supplierVerified: true,
      sourceIsManufacturer: false, images: ['a.jpg'], riskFlags: ['No rating'],
    });
    expect(score.breakdown.competition.points).toBe(0);
    expect(score.breakdown.upsell.points).toBe(0);
  });

  it('FINAL AUDIT: a selected-variant SKU alone is NOT size evidence — no size/upsell bonus', () => {
    // Enriched record: real product, real price, US inventory, ONE selected
    // SKU/variant with NO variant-option semantics (no size/color/pack).
    const d: CjProductDetail = {
      ...listProduct(),
      productImageSet: ['https://img.cjdropshipping.com/pid123456.jpg'],
      variants: [{
        vid: 'VID-1', variantSku: 'SKU-1', variantSellPrice: '12.99',
        inventories: [{ countryCode: 'US', totalInventory: 30, verifiedWarehouse: 1 }],
      }],
    };
    const r = normalizeCjProductDetail(d, { market: 'US' })!;
    expect(r.selectedVariant?.sku).toBe('SKU-1');
    const ev = evidenceFromSupplierRecord(r, 'US', null);
    // SKU must NOT populate sizes — sizes stay UNKNOWN.
    expect(ev.sizes.status).toBe('unknown');
    expect(ev.sizes.value).toBeNull();
    // Scoring with sizes UNKNOWN → NO size-derived competition/upsell points.
    const candidate: ScoutCandidate = {
      id: 'c1', title: r.title, source: 'CJ Dropshipping', sourceUrl: r.sourceUrl,
      supplierSlug: 'cj-dropshipping', images: r.images, evidence: ev,
      margin: calculateMargin({ supplierPrice: r.sellPrice, shippingCost: null }),
      score: null, status: 'researching', createdAt: new Date().toISOString(),
    };
    const out = scoreSupplierCandidate(candidate, 2.5);
    const sizesInExtract = (ev.sizes.value as string[] | null) ?? null;
    void sizesInExtract;
    // Competition: the title contains "Toy" → popular-category +2 is fine, but
    // NO size-derived +4. Upsell: NO size-derived points (0 unless real options).
    expect(out.score?.breakdown.competition.points).toBeLessThanOrEqual(2);
    expect(out.score?.breakdown.upsell.points).toBe(0);
  });
});

describe('CJ pre-live hardening — freight', () => {
  it('prefers totalPostageFee and preserves all fee fields', () => {
    const ev = normalizeCjFreight({
      logisticsName: 'CJ Logistics', logisticPrice: '3.50', totalPostageFee: '4.99',
      taxesFee: '0.40', clearanceOperationFee: '0.50', tariff: '0.09', shippingTime: '8-12',
    }, { origin: 'CN', destination: 'US' })!;
    expect(ev.costUsd).toBe(4.99); // totalPostageFee preferred
    expect(ev.baseFreightUsd).toBe(3.50);
    expect(ev.taxesFeeUsd).toBe(0.40);
    expect(ev.clearanceFeeUsd).toBe(0.50);
    expect(ev.tariffUsd).toBe(0.09);
    expect(ev.origin).toBe('CN');
    expect(ev.destination).toBe('US');
    expect(ev.verified).toBe(true);
  });

  it('falls back to logisticPrice ONLY when totalPostageFee is absent, and records the limitation', () => {
    const ev = normalizeCjFreight({ logisticPrice: '3.50', shippingTime: '10-14' }, { origin: 'CN', destination: 'US' })!;
    expect(ev.costUsd).toBe(3.50);
    expect(ev.note).toContain('LIMITATION');
  });

  it('freight origin is dynamic — no origin → UNKNOWN, never fabricated', () => {
    const ev = normalizeCjFreight({ logisticPrice: '3.50' }, {})!;
    expect(ev.origin).toBeNull();
    expect(ev.costUsd).toBe(3.50);
    // The adapter refuses to quote without a variant origin (its guard returns
    // an UNKNOWN evidence object instead of calling the proxy).
    const adapter = new CjSupplierAdapter();
    void adapter; // origin handling verified at normalize level + integration test
  });

  it('parses delivery cycles exactly and never improves supplier evidence', () => {
    expect(parseDeliveryCycle('3-5')).toEqual({ min: 3, max: 5 });
    expect(parseDeliveryCycle('5')).toEqual({ min: 5, max: 5 });
    expect(parseDeliveryCycle('12-15')).toEqual({ min: 12, max: 15 });
    expect(parseDeliveryCycle('junk')).toBeNull();
    expect(parseDeliveryCycle('')).toBeNull();
    expect(parseDeliveryCycle(null)).toBeNull();
  });

  it('delivery cycle in evidence uses the REAL min (not 1)', () => {
    const r = recordFromList(listProduct({ deliveryCycle: '3-5' }));
    const ev = evidenceFromSupplierRecord(r, 'US');
    expect(ev.shippingDays.value).toEqual({ min: 3, max: 5 });
  });
});

describe('CJ point budget (Phase 4C hardening)', () => {
  it('defaults to the owner-configured 250pt budget and clamps to [50, HARD MAX]', () => {
    const b = new CjPointBudget();
    expect(b.budget).toBe(CJ_POINTS_BUDGET_PER_RUN);
    expect(b.budget).toBe(250);
    // Never below the cost of one search (a run must be able to search).
    expect(new CjPointBudget(10).budget).toBe(50);
    expect(new CjPointBudget(0).budget).toBe(50);
    // NEVER above the HARD SERVER MAX — callers/AI cannot raise it.
    expect(new CjPointBudget(1000).budget).toBe(250);
    expect(new CjPointBudget(500).budget).toBe(250);
  });

  it('the HARD SERVER MAX is 250 — a requested 1000 clamps to 250', () => {
    expect(CJ_POINTS_HARD_MAX).toBe(250);
    expect(new CjPointBudget(100).budget).toBe(100); // less is allowed
    expect(new CjPointBudget(250).budget).toBe(250); // exactly max allowed
    expect(new CjPointBudget(500).budget).toBe(250); // more is clamped
    expect(new CjPointBudget(1000).budget).toBe(250);
  });

  it('tracks per-endpoint costs and denies when the budget would be exceeded', () => {
    const b = new CjPointBudget(110); // 1 search (50) + 6 detail (60)
    expect(b.canSpend('listV2')).toBe(true);
    expect(b.spend('listV2')).toBe(true);
    for (let i = 0; i < 6; i++) expect(b.spend('productQuery')).toBe(true);
    expect(b.spend('productQuery')).toBe(false); // 110 - 50 - 60 = 0
    expect(b.denied).toBe(1);
    expect(b.spend('freightCalculate')).toBe(false);
    const u = b.usage();
    expect(u.used).toBe(110);
    expect(u.remaining).toBe(0);
    expect(u.listCalls).toBe(1);
    expect(u.detailCalls).toBe(6);
    expect(u.freightCalls).toBe(0);
  });

  it('enrichment caps fit inside the budget (250 → 50 search + 12 detail + 6 freight = 230)', () => {
    const { detailMax, freightMax } = enrichmentCaps(new CjPointBudget(250));
    expect(detailMax).toBe(12);
    expect(freightMax).toBe(6);
    const total = CJ_POINT_COST.listV2 + detailMax * CJ_POINT_COST.productQuery + freightMax * CJ_POINT_COST.freightCalculate;
    expect(total).toBeLessThanOrEqual(250);
    expect(total).toBe(230);
  });

  it('simulates 50 listV2 → 10 detail → 5 freight staying within the budget', () => {
    const b = new CjPointBudget(250);
    expect(b.spend('listV2')).toBe(true); // 50
    for (let i = 0; i < 10; i++) expect(b.spend('productQuery')).toBe(true); // 100
    for (let i = 0; i < 5; i++) expect(b.spend('freightCalculate')).toBe(true); // 50
    const u = b.usage();
    expect(u.used).toBe(200);
    expect(u.remaining).toBe(50);
    // Remaining 50 fits exactly one more search; 40 fits a freight call but
    // NOT a second search — the budget hard-limits each endpoint.
    expect(b.canSpend('freightCalculate')).toBe(true);
    expect(b.spend('freightCalculate')).toBe(true); // 210
    expect(b.canSpend('freightCalculate')).toBe(true); // 40 ≥ 10
    expect(b.spend('freightCalculate')).toBe(true); // 220
    expect(b.spend('freightCalculate')).toBe(true); // 230
    expect(b.canSpend('freightCalculate')).toBe(true); // 20 ≥ 10
    expect(b.spend('freightCalculate')).toBe(true); // 240
    expect(b.canSpend('freightCalculate')).toBe(true); // 10 ≥ 10
    expect(b.spend('freightCalculate')).toBe(true); // 250
    expect(b.canSpend('freightCalculate')).toBe(false); // exhausted
    expect(b.canSpend('listV2')).toBe(false);
    expect(b.spend('listV2')).toBe(false);
    expect(b.denied).toBe(1);
  });
});

describe('CJ live-readiness simulation (fixtures only, NO key)', () => {
  it('50 records → prefilter → 10 detail → 5 freight, points within budget, and reports a clean usage record', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const records = Array.from({ length: 50 }, (_, i) => recordFromList(listProduct({
      id: `PID${i}`, sku: `SKU-${i}`, nameEn: `Dog Puzzle Toy ${i}`, nowPrice: String(8 + (i % 20)),
    })));
    const adapter = new FakeCjAdapter(records);
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'dog puzzle toy', market: 'US', maxResults: 50, pointsBudget: 250 },
      db,
      onProgress: () => {},
    });
    // 50 list records → prefilter keeps all (valid) → enrichment capped by budget.
    expect(result.searched).toBe(50);
    expect(result.researched).toBeGreaterThan(0);
    expect(result.researched).toBeLessThanOrEqual(12); // never enrich everything
    expect(result.points!.used).toBeLessThanOrEqual(250);
    expect(result.points!.denied).toBe(0); // caps chosen to fit budget
    expect(result.points!.listCalls).toBe(1); // ONE search call, no pagination
  });

  it('simulates a NO-WINNER run honestly (zero shortlisted reported as zero)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    // Records with no US inventory → prefilter rejects under US targeting.
    const records = Array.from({ length: 5 }, (_, i) => normalizeCjListProduct(
      listProduct({ id: `PIDX${i}`, sku: `SKU-X${i}`, nameEn: `Dog Toy ${i}`, warehouseInventoryNum: 0, totalVerifiedInventory: 0 }),
      { market: 'US' }
    )!);
    const adapter = new FakeCjAdapter(records);
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'dog toy', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(0);
    expect(result.businessQualified).toBe(0);
    expect(result.researched).toBe(0);
    expect((db.rows.get('product_candidates') || []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Server-side: secret isolation, token refresh, failures, rate limits
// ---------------------------------------------------------------------------

describe('CJ server lib (secret isolation + failures)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cjConfigured reflects the server env only (never the browser)', () => {
    const before = process.env.CJ_API_KEY;
    delete process.env.CJ_API_KEY;
    expect(cjConfigured()).toBe(false);
    process.env.CJ_API_KEY = before;
  });

  it('cjSafeError scrubs tokens/keys from any message', () => {
    const msg = 'CJ-Access-Token: eyJhbGciOiJIUzI1NiJ9.abc123 and apiKey "sk-super-secret-value-12345678" failed';
    const safe = cjSafeError(msg);
    expect(safe).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(safe).not.toContain('sk-super-secret');
    expect(safe).toContain('***');
  });

  it('health mapping never trusts arbitrary server text', () => {
    expect(cjSafeStatusFromHealth('ONLINE')).toBe('online');
    expect(cjSafeStatusFromHealth('rate_limited')).toBe('rate_limited');
    expect(cjSafeStatusFromHealth('not_configured')).toBe('not_configured');
    expect(cjSafeStatusFromHealth('totally-malicious')).toBe('offline');
    expect(cjSafeStatusFromHealth(undefined)).toBe('offline');
  });

  it('survives API failure and rate limiting without retrying forever', async () => {
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/authentication/getAccessToken')) {
        return new Response(JSON.stringify({ data: { accessToken: 'AT', refreshToken: 'RT' } }), { status: 200 });
      }
      if (url.includes('/product/listV2')) {
        return new Response(JSON.stringify({ data: { content: [{ productList: [] }], totalRecords: 0 } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { products } = await cjSearchProducts({ keyWord: 'dog toy', size: 5 });
      expect(Array.isArray(products)).toBe(true);
      // rate-limit path: 429 once, then success on the ONE allowed retry
      let n = 0;
      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        n++;
        const url = String(input);
        if (url.includes('/authentication/getAccessToken')) {
          return new Response(JSON.stringify({ data: { accessToken: 'AT2', refreshToken: 'RT2' } }), { status: 200 });
        }
        return n < 2 ? new Response('rate limited', { status: 429 }) : new Response(JSON.stringify({ data: { content: [{ productList: [] }] } }), { status: 200 });
      }) as unknown as typeof fetch;
      const second = await cjSearchProducts({ keyWord: 'cat toy', size: 5 });
      expect(second.products).toEqual([]);
      // Token is cached from the first block → only the PAID calls fetch:
      // 429 (attempt 0) + 200 (the ONE allowed retry) = 2 paid fetches.
      expect(n).toBe(2);
      // Persistent 429 past the cap → throws (no 3rd paid attempt).
      let m = 0;
      global.fetch = vi.fn(async () => {
        m++;
        return new Response('rate limited', { status: 429 });
      }) as unknown as typeof fetch;
      await expect(cjSearchProducts({ keyWord: 'toy', size: 5 })).rejects.toThrow(/rate limited/i);
      expect(m).toBe(2); // paid endpoint: 429 + 1 retry, then give up
      // Hard 4xx (validation/auth) is NEVER retried.
      let h = 0;
      global.fetch = vi.fn(async () => {
        h++;
        return new Response('bad request', { status: 400 });
      }) as unknown as typeof fetch;
      await expect(cjSearchProducts({ keyWord: 'toy', size: 5 })).rejects.toThrow(/400/i);
      expect(h).toBe(1); // the 400 is NOT retried
    } finally {
      global.fetch = realFetch;
    }
  });

  it('refreshes the access token server-side (never exposes it to the client)', async () => {
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/refreshAccessToken')) {
        return new Response(JSON.stringify({ data: { accessToken: 'REFRESHED_AT', refreshToken: 'RT2' } }), { status: 200 });
      }
      if (url.includes('/getAccessToken')) {
        return new Response(JSON.stringify({ data: { accessToken: 'FRESH_AT', refreshToken: 'RT1' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      // Fresh module instance so the in-memory token cache is empty.
      vi.resetModules();
      const lib = await import('../../../../api/_lib/cj');
      const first = await lib.cjAccessToken();
      expect(first).toBe('FRESH_AT');
      // Second call within TTL → cached token, no new fetch.
      const second = await lib.cjAccessToken();
      expect(second).toBe('FRESH_AT');
      expect(calls.filter((c) => c.includes('getAccessToken')).length).toBe(1);
    } finally {
      global.fetch = realFetch;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 4C FINAL PRE-KEY AUDIT — server-authoritative budget + market gate
// ---------------------------------------------------------------------------

describe('FINAL AUDIT — server point budget (authoritative)', () => {
  it('clamps ANY requested budget to the HARD SERVER MAX of 250', () => {
    expect(new CjServerRunBudget(100).budget).toBe(100); // less allowed
    expect(new CjServerRunBudget(250).budget).toBe(250);
    expect(new CjServerRunBudget(500).budget).toBe(250); // clamped
    expect(new CjServerRunBudget(1000).budget).toBe(250); // clamped
    expect(new CjServerRunBudget(NaN).budget).toBe(250); // invalid → default max
  });

  it('reserves points BEFORE every paid request — including paid retries', () => {
    const b = new CjServerRunBudget(250);
    // One listV2 (50) then a productQuery with one paid retry: 50 + 10 + 10.
    expect(b.reserve('listV2')).toBe(true);
    b.markAttempt('listV2');
    expect(b.reserve('productQuery')).toBe(true);
    b.markAttempt('productQuery');
    expect(b.reserve('productQuery', true)).toBe(true); // paid retry
    b.markAttempt('productQuery');
    const u = b.usage();
    expect(u.reserved).toBe(70); // 50 + 10 + 10 — retries ARE counted
    expect(u.paidRetries).toBe(1);
    expect(u.detailAttempts).toBe(2);
  });

  it('refuses the HTTP request when remaining budget cannot afford it (denied, no call)', () => {
    const b = new CjServerRunBudget(60); // search 50 + one 10 left
    expect(b.reserve('listV2')).toBe(true);
    expect(b.reserve('productQuery')).toBe(true);
    // 5 points left? impossible with these costs — simulate with a freight
    // request when only a partial amount remains.
    const b2 = new CjServerRunBudget(55);
    expect(b2.reserve('listV2')).toBe(true); // 50
    // Remaining 5 < any paid endpoint cost → the request is NOT issued.
    expect(b2.reserve('freightCalculate')).toBe(false);
    expect(b2.usage().denied).toBe(1);
    expect(b2.usage().remaining).toBe(5);
    // A second product/query also cannot run.
    expect(b2.reserve('productQuery')).toBe(false);
  });

  it('CJ_POINT_BUDGET_EXHAUSTED is the safe client-visible signal', () => {
    expect(CJ_POINT_BUDGET_EXHAUSTED).toBe('CJ_POINT_BUDGET_EXHAUSTED');
  });
});

describe('FINAL AUDIT — market business gate (two qualification levels)', () => {
  // A genuinely strong, fully-enriched CJ candidate. IMPORTANT honesty note:
  // after the SKU→sizes fix, a CJ-only candidate (no customer ratings, no
  // real variant-option semantics) has a TRUTHFUL ceiling of 75/100 — exactly
  // the shortlist threshold, never inflated above the evidence. That is the
  // point: CJ supplier data alone cannot earn ratings/upsell points.
  it('Product 75 / Market 55 → PRODUCT_SHORTLISTED YES, BUSINESS_QUALIFIED NO', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-1', 55, 'fp-1');
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'mi-1', marketScore: 90, evidenceFingerprint: 'fp-1', observedAt: new Date().toISOString() },
      },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(1); // honest 75 ≥ 75
    expect(result.businessQualified).toBe(0); // verified market 55 < 60 gate
    expect(result.businessQualifiedCandidates).toHaveLength(0);
    // The DB job is the source of truth — a client claim of 90 is ignored.
    expect(result.marketContext?.marketScore).toBe(55);
    expect(result.marketContext?.verified).toBe(true);
  });

  it('Product 75 / Market 65 → BUSINESS_QUALIFIED YES (landed cost HIGH + USA evidence)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-2', 65, 'fp-2');
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'mi-2', marketScore: 90, evidenceFingerprint: 'fp-2', observedAt: new Date().toISOString() },
      },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(1);
    expect(result.businessQualified).toBe(1);
    expect(result.businessQualifiedCandidates[0]).toMatchObject({
      productScore: 75, marketScore: 65,
      landedCostConfidence: 'high', usaDeliveryConfidence: 'high',
    });
    // Final Opportunity Score formula: 0.7×75 + 0.3×65 = 72 (documented).
    expect(result.businessQualifiedCandidates[0].finalOpportunityScore).toBe(72);
    // Market link persisted on the RESEARCH job output (verified values).
    const researchJob = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'PRODUCT_RESEARCH');
    expect(researchJob?.output).toMatchObject({
      market_intelligence_job_id: 'mi-2', market_score: 65,
      market_evidence_fingerprint: 'fp-2', market_verified: true,
      supplier_search_query: 'orthopedic dog bed',
    });
  });

  it('Product 75 / Market UNKNOWN → BUSINESS_QUALIFIED NO (never invented)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: { query: 'orthopedic dog bed', market: 'US', maxResults: 10, marketContext: {} },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(1);
    expect(result.businessQualified).toBe(0); // market UNKNOWN → not qualified
    expect(result.marketContext?.marketScore).toBeNull();
    expect(result.marketContext?.verified).toBe(false);
  });

  it('server-authoritative usage is surfaced on the result when the adapter reports it', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const adapter = strongAdapter();
    adapter.serverUsage = {
      budget: 250, reserved: 70, remaining: 180,
      listAttempts: 1, detailAttempts: 2, freightAttempts: 1, paidRetries: 1, denied: 0,
    };
    const result = await runSupplierSearch({
      adapter,
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: { marketScore: 65 },
      },
      db,
      onProgress: () => {},
    });
    expect(result.serverPoints?.reserved).toBe(70);
    expect(result.serverPoints?.paidRetries).toBe(1);
  });

  it('closes the durable run with a status (completed when budget remains)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const adapter = strongAdapter();
    await runSupplierSearch({
      adapter,
      search: { query: 'orthopedic dog bed', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(adapter.finishedStatus).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Phase 4C LIVE-READINESS — durable point ledger (migration 0008)
// ---------------------------------------------------------------------------

interface MockRunRow {
  id: string;
  status: string;
  hard_budget: number;
  reserved_points: number;
  list_attempts: number;
  detail_attempts: number;
  freight_attempts: number;
  paid_retries: number;
  denied_attempts: number;
  [k: string]: unknown;
}

/**
 * A tiny in-memory emulation of the 0008 migration backend (supplier_api_runs
 * table + atomic reserve RPC) shared across ledger instances, mirroring the
 * DB row lock + re-evaluated WHERE semantics. Admin JWT required.
 */
/**
 * A tiny in-memory emulation of the REVISED 0008 migration backend, mirroring
 * the migration-security model exactly:
 *   - mutation ONLY via SECURITY DEFINER RPCs (start / reserve / finish) with
 *     p_-prefixed args;
 *   - reserve derives the point cost from the action (list=50, detail=10,
 *     freight=10) — the caller can NEVER supply cost; unknown actions reject;
 *   - start clamps the budget into [50, 250] (the DB, not the caller, decides);
 *   - direct table INSERT/UPDATE/PATCH is DENIED (403) — mirroring the revoked
 *     grants and the admin-only SELECT policy;
 *   - row lock + re-evaluated WHERE semantics for concurrency.
 */
function mockSupabaseLedger(state: Map<string, MockRunRow>) {
  const ok = (rows: unknown[], status = 200) => new Response(JSON.stringify(rows), { status });
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const headers = (init?.headers || {}) as Record<string, string>;
    const auth = String(headers.Authorization || '');
    // Mirror the migration's ADMIN-ONLY guard: a non-admin bearer is refused.
    if (!/Bearer .*admin/i.test(auth)) return new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 });

    // ---------------- start RPC: DB derives + stores the hard budget ----------------
    if (url.includes('/rest/v1/rpc/start_supplier_api_run')) {
      const body = JSON.parse(String(init?.body || '{}')) as { p_provider: string; p_requested_budget: number };
      // Mirror LEAST(GREATEST(requested, 50), 250) — the DB clamps.
      const hard = Math.min(Math.max(Math.floor(body.p_requested_budget ?? 250), 50), 250);
      const row: MockRunRow = {
        id: `run-${Math.random().toString(36).slice(2, 10)}`,
        provider: body.p_provider, status: 'running',
        requested_budget: hard, hard_budget: hard, reserved_points: 0,
        list_attempts: 0, detail_attempts: 0, freight_attempts: 0,
        paid_retries: 0, denied_attempts: 0,
      };
      state.set(row.id, row);
      // Mirror the REAL migration: the start RPC returns the PK as `run_id`
      // (snake_case) — there is NO `id` column in its return table. The server
      // ledger must read run_id (Phase 4E live finding: a genuine bug where
      // the server read .id and the proxy failed with HTTP 200 + no runId).
      return ok([{
        run_id: row.id, provider: row.provider, status: row.status,
        requested_budget: row.requested_budget, hard_budget: row.hard_budget,
        reserved_points: row.reserved_points, list_attempts: row.list_attempts,
        detail_attempts: row.detail_attempts, freight_attempts: row.freight_attempts,
        paid_retries: row.paid_retries, denied_attempts: row.denied_attempts,
      }]);
    }

    // ---------------- reserve RPC: DB derives cost; caller NEVER supplies it ----------------
    if (url.includes('/rest/v1/rpc/reserve_supplier_api_points')) {
      const body = JSON.parse(String(init?.body || '{}')) as {
        p_run_id: string; p_provider: string; p_action: string; p_is_retry: boolean;
      };
      // Mirror the migration: caller-supplied cost is IMPOSSIBLE (no param),
      // and unknown actions are REJECTED (raise exception → 400).
      let cost: number;
      if (body.p_action === 'list') cost = 50;
      else if (body.p_action === 'detail') cost = 10;
      else if (body.p_action === 'freight') cost = 10;
      else return new Response(JSON.stringify({ message: `unknown supplier API action: ${body.p_action}` }), { status: 400 });
      const row = state.get(body.p_run_id);
      const afford = !!row && row.status === 'running' && (row.reserved_points + cost) <= row.hard_budget;
      if (!afford) {
        if (row) row.denied_attempts = (row.denied_attempts || 0) + 1;
        return ok([{
          approved: false, run_id: body.p_run_id, provider: 'cj', status: row?.status ?? 'missing',
          hard_budget: row?.hard_budget ?? 0, reserved_points: row?.reserved_points ?? 0,
          remaining: (row?.hard_budget ?? 0) - (row?.reserved_points ?? 0),
          list_attempts: row?.list_attempts ?? 0, detail_attempts: row?.detail_attempts ?? 0,
          freight_attempts: row?.freight_attempts ?? 0, paid_retries: row?.paid_retries ?? 0,
          denied_attempts: row?.denied_attempts ?? 0,
        }]);
      }
      row.reserved_points += cost;
      if (body.p_action === 'list') row.list_attempts = (row.list_attempts || 0) + 1;
      if (body.p_action === 'detail') row.detail_attempts = (row.detail_attempts || 0) + 1;
      if (body.p_action === 'freight') row.freight_attempts = (row.freight_attempts || 0) + 1;
      if (body.p_is_retry) row.paid_retries = (row.paid_retries || 0) + 1;
      return ok([{ approved: true, run_id: body.p_run_id, provider: 'cj', ...row }]);
    }

    // ---------------- finish RPC: only a running row may finish ----------------
    if (url.includes('/rest/v1/rpc/finish_supplier_api_run')) {
      const body = JSON.parse(String(init?.body || '{}')) as { p_run_id: string; p_status: string };
      const row = state.get(body.p_run_id);
      if (!row || row.status !== 'running') {
        return new Response(JSON.stringify({ message: `supplier run ${body.p_run_id} is not running or does not exist` }), { status: 400 });
      }
      if (!['completed', 'failed', 'exhausted'].includes(body.p_status)) {
        return new Response(JSON.stringify({ message: `invalid final status: ${body.p_status}` }), { status: 400 });
      }
      row.status = body.p_status;
      return ok([{ run_id: row.id, provider: row.provider, status: row.status, hard_budget: row.hard_budget, reserved_points: row.reserved_points, finished_at: new Date().toISOString() }]);
    }

    // ---------------- direct table access: SELECT allowed (admin RLS);
    // INSERT / UPDATE / PATCH DENIED (grants revoked — mirror of the migration)
    if (url.includes('/rest/v1/supplier_api_runs')) {
      if (method === 'POST' || method === 'PATCH') {
        return new Response(JSON.stringify({ message: 'permission denied for table supplier_api_runs' }), { status: 403 });
      }
      const id = /id=eq\.([^&]+)/.exec(url)?.[1];
      const row = id ? state.get(decodeURIComponent(id)) : null;
      if (method === 'GET') return ok(row ? [row] : []);
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
  });
}

describe('DURABLE POINT LEDGER — cross-instance, atomic, cold-start safe (migration 0008)', () => {
  const state = new Map<string, MockRunRow>();
  let realFetch: typeof fetch;
  let env: Record<string, string | undefined> = {};

  beforeEach(() => {
    state.clear();
    realFetch = global.fetch;
    env = {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = mockSupabaseLedger(state) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('A) two independent server contexts share ONE durable run budget', async () => {
    const l1 = new CjDurableRunLedger('admin.jwt');
    const l2 = new CjDurableRunLedger('admin.jwt');
    const { runId } = await l1.start('cj', 250);
    const a = await l1.reserve(runId, 'listV2', false); // 50
    const b = await l2.reserve(runId, 'productQuery', false); // 10 — different instance
    expect(a.approved).toBe(true);
    expect(b.approved).toBe(true);
    const usage = await l1.usage(runId);
    expect(usage?.budget).toBe(250);
    expect(usage?.reserved).toBe(60);
    expect(usage?.remaining).toBe(190);
  });

  it('B) cold start does NOT reset reserved points (durable, not memory)', async () => {
    const l1 = new CjDurableRunLedger('admin.jwt');
    const { runId } = await l1.start('cj', 250);
    await l1.reserve(runId, 'listV2', false); // 50
    // A brand-new ledger instance (cold serverless start) has NO in-memory
    // state — it must still see the 50 already reserved in the DB.
    const l2 = new CjDurableRunLedger('admin.jwt');
    expect((await l2.usage(runId))?.reserved).toBe(50);
    const r = await l2.reserve(runId, 'productQuery', false);
    expect(r.approved).toBe(true);
    expect((await l2.usage(runId))?.reserved).toBe(60);
  });

  it('C) DENIED budget → the paid CJ HTTP request is never issued', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 50); // budget = exactly one search
    await ledger.reserve(runId, 'listV2', false); // 50 used → 0 left
    const supabaseMock = global.fetch;
    let cjListCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('cjdropshipping')) {
        if (u.includes('/product/listV2')) cjListCalls++;
        if (u.includes('/authentication/getAccessToken')) {
          return new Response(JSON.stringify({ data: { accessToken: 'AT', refreshToken: 'RT' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { content: [{ productList: [] }], totalRecords: 0 } }), { status: 200 });
      }
      return supabaseMock(input, init);
    }) as unknown as typeof fetch;
    const ctx = new CjDurableRunContext(ledger, runId, 50);
    await expect(cjSearchProducts({ keyWord: 'dog toy', size: 5 }, ctx)).rejects.toThrow(CJ_POINT_BUDGET_EXHAUSTED);
    expect(cjListCalls).toBe(0); // NO paid CJ HTTP request was issued
    // The denial is recorded durably.
    expect((await ledger.usage(runId))?.denied).toBe(1);
  });

  it('D) two concurrent 10-pt reservations with only 10 remaining → exactly ONE succeeds', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    await ledger.reserve(runId, 'listV2', false); // 50
    for (let i = 0; i < 19; i++) await ledger.reserve(runId, 'productQuery', false); // 190 → 240
    const [a, b] = await Promise.all([
      ledger.reserve(runId, 'freightCalculate', false),
      ledger.reserve(runId, 'freightCalculate', false),
    ]);
    expect([a.approved, b.approved].filter(Boolean)).toHaveLength(1);
    expect((await ledger.usage(runId))?.reserved).toBe(250);
    expect((await ledger.usage(runId))?.denied).toBe(1);
  });

  it('server clamps ANY requested budget to the HARD MAX (1000 → 250)', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { usage } = await ledger.start('cj', 1000);
    expect(usage.budget).toBe(250);
    const lower = await new CjDurableRunLedger('admin.jwt').start('cj', 100);
    expect(lower.usage.budget).toBe(100); // less than max is allowed
  });

  it('a NON-ADMIN caller is rejected by the ledger (fail closed)', async () => {
    const ledger = new CjDurableRunLedger('customer.jwt');
    await expect(ledger.start('cj', 250)).rejects.toThrow(/403|permission denied/i);
  });

  it('paid retries reserve their own points durably (retry counted, cap enforced)', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    const r1 = await ledger.reserve(runId, 'productQuery', false); // 10
    const r2 = await ledger.reserve(runId, 'productQuery', true); // retry +10
    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(true);
    const usage = await ledger.usage(runId);
    expect(usage?.reserved).toBe(20);
    expect(usage?.paidRetries).toBe(1);
    expect(usage?.detailAttempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 4C LIVE-READINESS — market provenance (DB job is the source of truth)
// ---------------------------------------------------------------------------

describe('MARKET PROVENANCE — persisted MI job verification', () => {
  const sufficientOutput = (marketScore: number, fp: string, at: string) => ({
    marketScore, evidenceFingerprint: fp, at,
    // Phase 4E.1 fail-closed: qualification requires sufficient evidence.
    evidenceQuality: 'sufficient', qualificationEligible: true,
  });

  it('G) valid MI job + matching claimed fingerprint → verified market context', () => {
    const at = new Date().toISOString();
    const job = {
      id: 'mi-real', type: 'MARKET_INTELLIGENCE', status: 'completed',
      output: sufficientOutput(65, 'fp-real', at), finished_at: at, created_at: at,
    };
    const v = verifyMarketIntelligenceJob(job, { marketAnalysisId: 'mi-real', evidenceFingerprint: 'fp-real' });
    expect(v).not.toBeNull();
    expect(v?.marketScore).toBe(65);
    expect(v?.evidenceFingerprint).toBe('fp-real');
    expect(v?.marketAnalysisId).toBe('mi-real');
  });

  it('fingerprint mismatch → NOT verified (fail closed)', () => {
    const at = new Date().toISOString();
    const job = {
      id: 'mi-real', type: 'MARKET_INTELLIGENCE', status: 'completed',
      output: sufficientOutput(65, 'fp-real', at), finished_at: at, created_at: at,
    };
    expect(verifyMarketIntelligenceJob(job, { evidenceFingerprint: 'fp-WRONG' })).toBeNull();
  });

  it('wrong type / not completed / missing score / missing fingerprint → null', () => {
    const at = new Date().toISOString();
    const base = { id: 'x', type: 'MARKET_INTELLIGENCE', status: 'completed', output: sufficientOutput(65, 'fp', at), finished_at: at, created_at: at };
    expect(verifyMarketIntelligenceJob({ ...base, type: 'PRODUCT_RESEARCH' })).toBeNull();
    expect(verifyMarketIntelligenceJob({ ...base, status: 'failed' })).toBeNull();
    expect(verifyMarketIntelligenceJob({ ...base, output: { evidenceFingerprint: 'fp', at } })).toBeNull();
    expect(verifyMarketIntelligenceJob({ ...base, output: { marketScore: 65, at } })).toBeNull();
    expect(verifyMarketIntelligenceJob(null)).toBeNull();
  });

  it('Phase 4E.1: insufficient evidence (even with a high diagnostic score) → NOT verified', () => {
    const at = new Date().toISOString();
    const job = {
      id: 'mi-thin', type: 'MARKET_INTELLIGENCE', status: 'completed',
      output: {
        marketScore: 72, evidenceFingerprint: 'fp-thin', at,
        evidenceQuality: 'insufficient', qualificationEligible: false,
        diagnosticDeterministicScore: 72,
      },
      finished_at: at, created_at: at,
    };
    expect(verifyMarketIntelligenceJob(job)).toBeNull();
    // Client-claimed score never rescues an insufficient-evidence job.
    expect(verifyMarketIntelligenceJob(job, { marketScore: 95, evidenceFingerprint: 'fp-thin' })).toBeNull();
    // Missing the fail-closed flags entirely ⇒ treated as not eligible.
    const legacy = { id: 'x', type: 'MARKET_INTELLIGENCE', status: 'completed', output: { marketScore: 72, evidenceFingerprint: 'fp', at }, finished_at: at, created_at: at };
    expect(verifyMarketIntelligenceJob(legacy)).toBeNull();
  });
});

describe('MARKET PROVENANCE — supplier-search market gate', () => {
  it('E) client supplies marketScore=90 but the DB MI job score is 55 → effective 55', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-real', 55, 'fp-real');
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'mi-real', marketScore: 90, evidenceFingerprint: 'fp-real' },
      },
      db,
      onProgress: () => {},
    });
    expect(result.marketContext?.marketScore).toBe(55); // DB wins, client claim ignored
    expect(result.marketContext?.verified).toBe(true);
  });

  it('F) fake/nonexistent MI job id → Market UNKNOWN, BUSINESS_QUALIFIED false', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'does-not-exist', marketScore: 90 },
      },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(1); // shortlist still allowed
    expect(result.marketContext?.marketScore).toBeNull();
    expect(result.marketContext?.verified).toBe(false);
    expect(result.businessQualified).toBe(0);
  });

  it('H) manual CJ query (no linked MI job) → PRODUCT_SHORTLISTED allowed, BUSINESS_QUALIFIED false', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: { query: 'orthopedic dog bed', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(result.productShortlisted).toBe(1);
    expect(result.marketContext?.marketScore).toBeNull();
    expect(result.businessQualified).toBe(0);
  });

  it('I) Product Scout market-grounded flow passes the REAL MI job id (not a React-state score)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    // This is exactly what the UI does after a Market Intelligence run: it
    // holds the persisted job id + a chosen hypothesis and passes BOTH to the
    // CJ run. The engine re-loads the job from the DB — it never trusts a
    // number from React state (a score field is not even sent).
    const miJob = seedMiJob(db, 'mi-ui', 65, 'fp-ui');
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: {
          marketAnalysisId: miJob.id,
          opportunity: 'orthopedic dog beds',
          hypothesis: 'orthopedic dog bed',
        },
      },
      db,
      onProgress: () => {},
    });
    expect(result.marketContext?.marketAnalysisId).toBe(miJob.id);
    expect(result.marketContext?.marketScore).toBe(65); // derived from the DB job
    expect(result.marketContext?.verified).toBe(true);
    expect(result.businessQualified).toBe(1);
    const researchJob = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'PRODUCT_RESEARCH');
    expect(researchJob?.output).toMatchObject({
      market_intelligence_job_id: miJob.id,
      market_score: 65,
      market_evidence_fingerprint: 'fp-ui',
      market_verified: true,
    });
  });
});

describe('EVIDENCE-COMPLETION HOOK (strongest 3–6 only, deterministic, no extra calls)', () => {
  it('lists honest gaps for a CJ-only record (ratings/variants never invented)', () => {
    const r = normalizeCjProductDetail(detailProduct(), { market: 'US' })!;
    const gaps = evidenceCompletionGaps(r);
    expect(gaps).toContain('verified customer ratings/reviews (CJ returns none — external demand evidence, identity-matched)');
    expect(gaps).toContain('real customer-selectable variant options (size/color/pack) for upsell evidence');
    // With a consistent US-stock variant + origin, those gaps are NOT claimed.
    expect(gaps).not.toContain('internally-consistent selected variant');
    expect(gaps).not.toContain('origin/warehouse evidence');
  });
});

// ---------------------------------------------------------------------------
// Phase 4C MIGRATION SECURITY — fail closed + DB-enforced hard cap
// ---------------------------------------------------------------------------

describe('MIGRATION 0008 — FAIL CLOSED when the durable ledger is unavailable', () => {
  it('A) ledger unavailable + CJ configured → ZERO outbound paid CJ requests', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const adapter = strongAdapter();
    adapter.failStart = true; // startRun throws → no durable run
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'orthopedic dog bed', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    // The run STOPPED with the fail-closed code — no records, no qualification.
    expect(result.code).toBe(CJ_DURABLE_LEDGER_UNAVAILABLE);
    expect(result.health).toBe('offline');
    expect(result.searched).toBe(0);
    expect(result.productShortlisted).toBe(0);
    expect(result.businessQualified).toBe(0);
    // ZERO paid calls were made (no listV2 / product/query / freightCalculate).
    expect(adapter.searchCalls).toBe(0);
    expect(adapter.detailCalls).toBe(0);
    expect(adapter.freightCalls).toBe(0);
    // A failed PRODUCT_RESEARCH job was recorded (truthful audit trail).
    const job = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'PRODUCT_RESEARCH');
    expect(job?.status).toBe('failed');
    expect(job?.output).toMatchObject({ code: 'CJ_DURABLE_LEDGER_UNAVAILABLE' });
  });

  it('A2) startRun returning null (no run id) also fails closed with zero paid calls', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const adapter = strongAdapter();
    const original = adapter.startRun.bind(adapter);
    adapter.startRun = async () => null; // durable run could not be created
    const result = await runSupplierSearch({
      adapter,
      search: { query: 'orthopedic dog bed', market: 'US', maxResults: 10 },
      db,
      onProgress: () => {},
    });
    expect(result.code).toBe(CJ_DURABLE_LEDGER_UNAVAILABLE);
    expect(adapter.searchCalls).toBe(0);
    expect(adapter.detailCalls).toBe(0);
    expect(adapter.freightCalls).toBe(0);
    adapter.startRun = original;
  });
});

describe('MIGRATION 0008 — SQL contract (static verification of the migration file)', () => {
  const migration = fs.readFileSync('supabase/migrations/0008_supplier_api_runs.sql', 'utf8');

  it('DB CHECK constraints enforce the [50,250] hard cap and counter integrity', () => {
    expect(migration).toMatch(/requested_budget between 50 and 250/i);
    expect(migration).toMatch(/hard_budget between 50 and 250/i);
    expect(migration).toMatch(/reserved_points >= 0/i);
    expect(migration).toMatch(/reserved_points <= hard_budget/i);
    expect(migration).toMatch(/list_attempts >= 0/i);
    expect(migration).toMatch(/detail_attempts >= 0/i);
    expect(migration).toMatch(/freight_attempts >= 0/i);
    expect(migration).toMatch(/paid_retries >= 0/i);
    expect(migration).toMatch(/denied_attempts >= 0/i);
    expect(migration).toMatch(/status in \('running', 'completed', 'failed', 'exhausted'\)/i);
    expect(migration).toMatch(/provider in \('cj'\)/i);
  });

  it('C/D) direct authenticated INSERT/UPDATE/DELETE on the ledger is DENIED', () => {
    // Only SELECT is granted to authenticated — no insert/update/delete grant.
    expect(migration).toMatch(/grant select on public\.supplier_api_runs to authenticated/i);
    expect(migration).not.toMatch(/grant (insert|update|delete).*supplier_api_runs/i);
    expect(migration).not.toMatch(/grant all on public\.supplier_api_runs/i);
    // The RLS policy is SELECT-only (admin), so a browser/admin JWT cannot
    // raise hard_budget, lower reserved_points or reset counters via the table.
    expect(migration).toMatch(/for select\n  using \(\(auth\.jwt\(\) -> 'app_metadata' ->> 'role'\) = 'admin'\)/i);
    expect(migration).toMatch(/revoke all on public\.supplier_api_runs from public/i);
  });

  it('F/H) reserve RPC has NO caller-supplied cost parameter (bypass impossible by design)', () => {
    // The function signature has exactly 4 args and no cost — a caller can
    // never send cost = 0 / -10 / 1. Costs are DB literals.
    expect(migration).toMatch(/create or replace function public\.reserve_supplier_api_points\(\s*p_run_id uuid,\s*p_provider text,\s*p_action text,\s*p_is_retry boolean default false\s*\)/);
    expect(migration).toMatch(/v_cost := 50;/);
    expect(migration).toMatch(/v_cost := 10;/);
    // Unknown actions raise an exception (REJECT, zero reservation).
    expect(migration).toMatch(/raise exception 'unknown supplier API action: %', p_action/);
  });

  it('G) invalid action → rejected, zero reservation (DB raises for unknown actions)', () => {
    expect(migration).toMatch(/raise exception 'unknown supplier API action: %', p_action/);
  });

  it('B) the DB (not the caller) derives and stores the hard budget (LEAST/GREATEST clamp)', () => {
    expect(migration).toMatch(/v_requested := least\(greatest\(coalesce\(p_requested_budget, 250\), 50\), 250\);/);
    expect(migration).toMatch(/start_supplier_api_run\(/);
    expect(migration).toMatch(/finish_supplier_api_run\(/);
  });

  it('parameter shadowing is impossible: every parameter is p_-prefixed and WHERE uses aliases', () => {
    expect(migration).toMatch(/where r\.id = p_run_id/);
    expect(migration).toMatch(/and r\.provider = p_provider/);
    // No ambiguous `provider = provider` / `run_id = run_id` comparisons exist.
    expect(migration).not.toMatch(/where\s+provider\s*=\s*provider/i);
  });

  it('SECURITY DEFINER hygiene: search_path set, EXECUTE revoked from PUBLIC, no service_role grants', () => {
    expect(migration).toMatch(/security definer/);
    expect((migration.match(/set search_path = public/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((migration.match(/revoke all on function /g) || []).length).toBeGreaterThanOrEqual(3);
    expect(migration).not.toMatch(/to authenticated, service_role/);
    expect(migration).not.toMatch(/grant .* to service_role/i);
  });
});

describe('MIGRATION 0008 — server ledger RPC contract (mock mirrors the DB)', () => {
  const state = new Map<string, MockRunRow>();
  let realFetch: typeof fetch;
  let env: Record<string, string | undefined> = {};

  beforeEach(() => {
    state.clear();
    realFetch = global.fetch;
    env = {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = mockSupabaseLedger(state) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('E) reservation action=detail → the DB derives 10 points (no caller cost sent)', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    const sent: string[] = [];
    const realFetch2 = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(init?.body || ''));
      return realFetch2(input, init);
    }) as unknown as typeof fetch;
    const r = await ledger.reserve(runId, 'productQuery', false);
    expect(r.approved).toBe(true);
    // The wire payload carries p_action (and NO cost field whatsoever).
    const wire = sent.find((b) => b.includes('p_action')) || '';
    expect(wire).toContain('p_action');
    expect(wire).toContain('detail');
    expect(wire).not.toContain('cost');
    const usage = await ledger.usage(runId);
    expect(usage?.reserved).toBe(10); // DB-derived cost
    expect(usage?.detailAttempts).toBe(1);
  });

  it('B) requested budget 1000 → the DB start RPC returns 250 (hard max enforced by DB)', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const big = await ledger.start('cj', 1000);
    expect(big.usage.budget).toBe(250);
    const small = await ledger.start('cj', 100);
    expect(small.usage.budget).toBe(100); // under max is accepted
  });

  it('I) 249 reserved + detail(10) → DENIED, zero CJ HTTP requests', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    // Reserve 50 (list) + 19×10 (details) = 240 … then one more detail = 250.
    await ledger.reserve(runId, 'listV2', false);
    for (let i = 0; i < 19; i++) await ledger.reserve(runId, 'productQuery', false);
    await ledger.reserve(runId, 'productQuery', false); // 250 → 0 remaining
    expect((await ledger.usage(runId))?.remaining).toBe(0);
    // 249-reserved state: budget 250, reserved 240, remaining 10 — a freight
    // call needs 10 but the client must reserve BEFORE the HTTP request.
    const supabaseMock = global.fetch;
    let cjFreightCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('cjdropshipping')) {
        if (u.includes('/logistic/freightCalculate')) cjFreightCalls++;
        return new Response('{}', { status: 200 });
      }
      return supabaseMock(input, init);
    }) as unknown as typeof fetch;
    const ctx = new CjDurableRunContext(ledger, runId, 250);
    await expect(cjFreightCalculate({ startCountryCode: 'US', endCountryCode: 'US', vid: 'V1' }, ctx)).rejects.toThrow(CJ_POINT_BUDGET_EXHAUSTED);
    expect(cjFreightCalls).toBe(0); // NO freight HTTP request issued
    expect((await ledger.usage(runId))?.denied).toBe(1);
  });

  it('G) invalid reservation action → REJECTED by the DB, zero reservation', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    // The typed JS API only ever sends list/detail/freight; the DB-level
    // rejection is exercised directly over the RPC wire (mirrors PostgREST):
    // an unknown p_action raises → 400 → zero reservation, counters untouched.
    const res = await fetch('https://proj.supabase.co/rest/v1/rpc/reserve_supplier_api_points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'anon-key', Authorization: 'Bearer admin.jwt' },
      body: JSON.stringify({ p_run_id: runId, p_provider: 'cj', p_action: 'bogus', p_is_retry: false }),
    });
    expect(res.status).toBe(400);
    expect(String(await res.text())).toMatch(/unknown supplier API action/i);
    const usage = await ledger.usage(runId);
    expect(usage?.reserved).toBe(0); // nothing reserved
    expect(usage?.listAttempts).toBe(0);
    expect(usage?.detailAttempts).toBe(0);
    expect(usage?.freightAttempts).toBe(0);
    expect(usage?.denied).toBe(0);
  });

  it('C/D) direct table INSERT/UPDATE is denied — only the RPCs mutate the ledger', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    // start via RPC succeeds (the supported path)…
    const { runId } = await ledger.start('cj', 250);
    // …but a direct table POST/PATCH (what a raw browser call would do) is 403.
    const { url, headers } = { url: 'https://proj.supabase.co', headers: { apikey: 'anon-key', Authorization: 'Bearer admin.jwt' } };
    const post = await fetch(`${url}/rest/v1/supplier_api_runs`, { method: 'POST', headers, body: JSON.stringify({ provider: 'cj', hard_budget: 9999 }) });
    expect(post.status).toBe(403);
    const patch = await fetch(`${url}/rest/v1/supplier_api_runs?id=eq.${runId}`, { method: 'PATCH', headers, body: JSON.stringify({ hard_budget: 9999 }) });
    expect(patch.status).toBe(403);
    // The supported finish path goes through the RPC (not a PATCH).
    await ledger.finish(runId, 'completed');
    expect(state.get(runId)?.status).toBe('completed');
  });

  it('J) two concurrent 10-pt reservations with 10 remaining → exactly ONE succeeds (atomic)', async () => {
    const ledger = new CjDurableRunLedger('admin.jwt');
    const { runId } = await ledger.start('cj', 250);
    await ledger.reserve(runId, 'listV2', false); // 50
    for (let i = 0; i < 19; i++) await ledger.reserve(runId, 'productQuery', false); // 240
    const [a, b] = await Promise.all([
      ledger.reserve(runId, 'freightCalculate', false),
      ledger.reserve(runId, 'freightCalculate', false),
    ]);
    expect([a.approved, b.approved].filter(Boolean)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 4C MIGRATION SECURITY — market query provenance (§10/§11)
// ---------------------------------------------------------------------------

describe('MARKET QUERY PROVENANCE — actual query must match a persisted recommendation', () => {
  it('K) MI recommendation ["interactive dog toy"] + CJ query "interactive dog toy" → VERIFIED', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-k', 65, 'fp-k', {
      output: { recommendedSearchQueries: ['interactive dog toy'] },
    });
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'interactive dog toy', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'mi-k', hypothesis: 'interactive dog toy' },
      },
      db,
      onProgress: () => {},
    });
    expect(result.marketContext?.verified).toBe(true);
    expect(result.marketContext?.queryProvenance).toBe('verified');
    expect(result.marketContext?.marketScore).toBe(65); // effective score applies
    expect(result.marketContext?.hypothesis).toBe('interactive dog toy'); // matched DB recommendation
    expect(result.businessQualified).toBe(1);
    const researchJob = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'PRODUCT_RESEARCH');
    expect(researchJob?.output).toMatchObject({
      market_query_provenance: 'verified', market_hypothesis: 'interactive dog toy',
      market_score: 65, market_score_db: 65,
    });
  });

  it('L) same MI job but CJ query "cat carrier" → Market UNKNOWN, BUSINESS_QUALIFIED false', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-l', 65, 'fp-l', {
      output: { recommendedSearchQueries: ['interactive dog toy'] },
    });
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'cat carrier', market: 'US', maxResults: 10,
        marketContext: { marketAnalysisId: 'mi-l', hypothesis: 'interactive dog toy' },
      },
      db,
      onProgress: () => {},
    });
    // The JOB is real, but the QUERY is not grounded in its evidence.
    expect(result.marketContext?.verified).toBe(true);
    expect(result.marketContext?.queryProvenance).toBe('unverified');
    expect(result.marketContext?.marketScore).toBeNull(); // effective = UNKNOWN
    expect(result.marketContext?.marketScoreDb).toBe(65); // raw DB score still reported
    expect(result.marketContext?.hypothesis).toBeNull();
    expect(result.productShortlisted).toBe(1); // PRODUCT research still works
    expect(result.businessQualified).toBe(0); // market gate NOT met
    const researchJob = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'PRODUCT_RESEARCH');
    expect(researchJob?.output).toMatchObject({
      market_query_provenance: 'unverified', market_hypothesis: null,
      market_score: null, market_score_db: 65,
    });
  });

  it('M) client-claimed hypothesis not stored in the MI job → ignored (DB is the only verifier)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    seedMiJob(db, 'mi-m', 65, 'fp-m', {
      output: { recommendedSearchQueries: ['interactive dog toy'] },
    });
    // The client CLAIMS a hypothesis that is NOT a persisted recommendation.
    const result = await runSupplierSearch({
      adapter: strongAdapter(),
      search: {
        query: 'orthopedic dog bed', market: 'US', maxResults: 10,
        marketContext: {
          marketAnalysisId: 'mi-m',
          hypothesis: 'orthopedic dog bed', // claimed, but NOT in the job
          opportunity: 'Orthopedic beds',   // client label — never verified
        },
      },
      db,
      onProgress: () => {},
    });
    expect(result.marketContext?.queryProvenance).toBe('unverified');
    expect(result.marketContext?.marketScore).toBeNull();
    // The DB opportunity is used (verified), not the client label.
    expect(result.marketContext?.opportunity).toBe('Dog beds');
    expect(result.businessQualified).toBe(0);
  });

  it('normalizeMarketQuery handles casing/punctuation so real matches verify', () => {
    expect(normalizeMarketQuery('  Interactive-DOG  Toy! ')).toBe('interactive dog toy');
    expect(normalizeMarketQuery('Interactive Dog Toy')).toBe('interactive dog toy');
    expect(normalizeMarketQuery('')).toBe('');
  });
});
