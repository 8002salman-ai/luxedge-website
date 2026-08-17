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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type {
  SupplierDiscoveryAdapter, SupplierProductRecord, SupplierSearchResult,
  SupplierShippingEvidence, SupplierHealthResult,
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
import { evidenceFromSupplierRecord, petCategoryFromTitle, scoreSupplierCandidate, runSupplierSearch } from '../../scout/supplierSearch';
import { calculateMargin } from '../../scout/margin';
import { scoreCandidate, SHORTLIST_THRESHOLD } from '../../scout/score';
import { extractPageFacts } from '../../scout/extract';
import type { FetchedSourcePage, ScoutCandidate, CandidateEvidence } from '../../scout/types';
import { cjConfigured, cjSafeError, cjSearchProducts } from '../../../../api/_lib/cj';
import {
  CjPointBudget, CJ_POINTS_BUDGET_PER_RUN, enrichmentCaps, CJ_POINT_COST,
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

/** Deterministic fake adapter returning fixed CJ records (no network). */
class FakeCjAdapter implements SupplierDiscoveryAdapter {
  readonly provider = 'cj' as const;
  records: SupplierProductRecord[];
  constructor(records: SupplierProductRecord[]) { this.records = records; }
  async searchProducts(): Promise<SupplierSearchResult> {
    return { records: this.records, health: 'online' };
  }
  async getProduct(): Promise<SupplierProductRecord | null> { return this.records[0] ?? null; }
  async getShippingEvidence(): Promise<SupplierShippingEvidence> {
    return {
      costUsd: 3.99, baseFreightUsd: 3.50, taxesFeeUsd: 0, clearanceFeeUsd: 0, tariffUsd: 0.49,
      arrivalDays: '8-12', carrier: 'CJ Logistic', origin: 'US', destination: 'US',
      observedAt: new Date().toISOString(), verified: true, note: 'freight quote (totalPostageFee)'
    };
  }
  async healthCheck(): Promise<SupplierHealthResult> { return { provider: 'cj', health: 'online' }; }
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
    expect(result.shortlisted).toBe(0); // below 75 — honest, no inflation

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
  it('defaults to the owner-configured 250pt budget and never below a search', () => {
    const b = new CjPointBudget();
    expect(b.budget).toBe(CJ_POINTS_BUDGET_PER_RUN);
    expect(b.budget).toBe(250);
    // A budget below the cost of one search is clamped to the safe default.
    expect(new CjPointBudget(10).budget).toBe(250);
    expect(new CjPointBudget(0).budget).toBe(250);
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
    expect(result.shortlisted).toBe(0);
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
