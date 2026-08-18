// ============================================================================
// LUXEDGE V2 — PHASE 4D MARKET EVIDENCE UPGRADE TESTS
//
// Covers: exact-product-page selection (diversity + caps), the evidence pack
// builder (fetch only selected pages, honest counts), the evidence-quality
// gate (pass/fail with exact missing reasons, configurable thresholds), the
// engine gating DeepSeek OFF on thin packs, extracts raising the deterministic
// score, persisted evidence metadata, and the no-op MarketDemandAdapter.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type { FetchedSourcePage, PageExtract } from '../types';
import { extractPageFacts } from '../extract';
import {
  selectEvidencePages, buildMarketEvidencePack, assessEvidenceQuality, countExtractEvidence,
  DEFAULT_EVIDENCE_QUALITY, type EvidenceCounts,
} from '../marketEvidence';
import { NoopMarketDemandAdapter, collectDemandSignals } from '../marketDemand';
import { runMarketIntelligenceJob } from '../engine';

// ---------------------------------------------------------------------------
// Fake admin-JWT db adapter (mirrors RLS: only admin-token writes succeed)
// ---------------------------------------------------------------------------
class FakeDb implements DbAdapter {
  mode = 'supabase' as const;
  token: string | null = null;
  rows = new Map<string, Record<string, unknown>[]>();
  constructor() {
    for (const t of ['agent_jobs', 'agent_runs', 'agent_logs']) this.rows.set(t, []);
  }
  private assertAdmin(): void {
    const claims = this.token
      ? (JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString()) as { app_metadata?: { role?: string } })
      : null;
    if (!claims || claims.app_metadata?.role !== 'admin') throw new Error('42501 row-level security violation');
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
  async remove(): Promise<void> { /* not used */ }
  async testConnection() { return { ok: true, mode: 'supabase' as const, detail: 'fake' }; }
}

function adminToken(): string {
  const payload = Buffer.from(JSON.stringify({ app_metadata: { role: 'admin' } })).toString('base64url');
  return `header.${payload}.sig`;
}

function page(title: string, price: number | null, availability: 'available' | 'unavailable' | 'unknown', rating?: number): FetchedSourcePage {
  return {
    text: `${title}\n${price !== null ? `Price: $${price.toFixed(2)}` : ''}\n${availability === 'available' ? 'In Stock' : availability === 'unavailable' ? 'Out of Stock' : ''}\n${rating ? `${rating} out of 5 stars` : ''}\n$0.00 shipping\nShips in 3-5 days\nMade in USA`,
    images: ['https://img.test/1.jpg'],
  };
}

const productPages: string[] = [
  'https://retailer1.com/product/dog-travel-bag',
  'https://retailer2.com/products/cat-grooming-glove',
  'https://manufacturer.com/product/senior-dog-ramp',
  'https://retailer3.com/item/dog-water-bottle',
  'https://retailer1.com/product/another-toy',
  'https://retailer4.com/p/portable-pet-bowl',
  'https://retailer2.com/products/pet-carrier',
  'https://retailer5.com/dp/seat-cover',
  'https://retailer6.com/gp/dog-bed',
  'https://retailer7.com/product/food-storage',
];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('selectEvidencePages (Phase 4D)', () => {
  it('prefers exact product pages and caps at maxPages (6-8)', () => {
    const urls = [
      'https://shop.com/category/dog-toys',
      'https://shop.com/search?q=dog',
      'https://shop.com/collections/dog',
      'https://retailer1.com/product/a',
      'https://retailer2.com/products/b',
      'https://retailer3.com/item/c',
      'https://retailer4.com/p/d',
      'https://retailer5.com/dp/e',
      'https://retailer6.com/gp/f',
      'https://retailer7.com/product/g',
      'https://retailer8.com/products/h',
      'https://retailer9.com/item/i',
      'https://retailer10.com/product/j',
    ];
    const selected = selectEvidencePages(urls, 8);
    expect(selected).toHaveLength(8); // cap honored
    // No category/search/collection pages survive.
    expect(selected.some((u) => u.includes('/category/') || u.includes('/search?') || u.includes('/collections/'))).toBe(false);
    // All are exact product-style pages.
    expect(selected.every((u) => /(\/product[s]?\/|\/item(s)?\/|\/p\/|\/dp\/|\/gp\/)/.test(u))).toBe(true);
  });

  it('rejects retailer search/browse and listicle pages (live discovery lesson)', () => {
    const urls = [
      'https://www.amazon.com/dog-toys/s?k=dog+toys',            // Amazon search
      'https://www.amazon.com/dogs-toys-gifts-games-plush/b?node=2975413011', // Amazon browse
      'https://www.chewy.com/b/toys-315',                         // Chewy browse
      'https://www.target.com/c/dog-toys-supplies-pets/-/N-5xt3f',// Target browse
      'https://www.mickeyspetsupplies.com/product-category/made-in-usa/dog-toys',
      'https://wedogy.com/dog-toy-brands-in-the-usa',             // listicle
      'https://www.catclaws.com/14-usa-cat-toys',                 // listicle
      'https://shop.com/blog/best-dog-toys-2024',                 // blog ranking
      'https://allamerican.org/lists/cat-toys',                   // listicle
      'https://www.gocattoys.com/made-in-the-usa',                // brand collection page
      'https://retailer1.com/product/real-dog-travel-bag',        // real product
      'https://retailer2.com/dp/real-cat-carrier',                // real product
    ];
    const selected = selectEvidencePages(urls, 8);
    expect(selected).toEqual([
      'https://retailer1.com/product/real-dog-travel-bag',
      'https://retailer2.com/dp/real-cat-carrier',
    ]);
  });

  it('dedupes by canonical host+path and prefers domain diversity', () => {
    const selected = selectEvidencePages([
      'https://Retailer1.com/product/a',
      'https://www.retailer1.com/product/a',   // same canonical
      'https://retailer1.com/product/a?utm=x', // same path, query stripped
      'https://retailer1.com/product/b',        // same host, different product — allowed
      'https://retailer2.com/product/c',
    ], 8);
    const hosts = selected.map((u) => new URL(u).hostname.replace(/^www\./, '').toLowerCase());
    expect(new Set(hosts).size).toBeGreaterThanOrEqual(2);
    // Canonical duplicates removed.
    expect(selected.filter((u) => u.includes('/product/a')).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Evidence pack builder
// ---------------------------------------------------------------------------

describe('buildMarketEvidencePack (Phase 4D)', () => {
  it('fetches only the selected exact pages and counts evidence honestly', async () => {
    const fetchPage = vi.fn(async (url: string): Promise<FetchedSourcePage> => {
      const i = productPages.indexOf(url);
      if (i === -1) throw new Error('not selected');
      return page(`Product ${i}`, 10 + i, 'available', i < 4 ? 4.5 : undefined);
    });
    const pack = await buildMarketEvidencePack({ urls: productPages, fetchPage, maxPages: 8 });
    // Only the 8 strongest exact product pages were fetched (no category pages).
    expect(fetchPage).toHaveBeenCalledTimes(8);
    expect(pack.selectedUrls).toHaveLength(8);
    expect(pack.extracts.length).toBe(8);
    expect(pack.failedUrls).toHaveLength(0);
    expect(pack.counts.usablePages).toBe(8);
    expect(pack.counts.priceEvidenceCount).toBe(8);
    expect(pack.counts.ratingEvidenceCount).toBe(4); // only 4 pages carry ratings
    expect(pack.counts.availabilityEvidenceCount).toBe(8);
    expect(pack.independentDomains).toBeGreaterThanOrEqual(3);
  });

  it('records fetched-but-unextractable pages honestly (no fabrication)', async () => {
    const fetchPage = vi.fn(async (url: string): Promise<FetchedSourcePage> => {
      if (url.includes('/product/blocked')) throw new Error('blocked');
      return { text: 'garbage with no product title', images: [] };
    });
    const pack = await buildMarketEvidencePack({
      urls: ['https://retailer1.com/product/blocked', 'https://retailer2.com/products/ok'],
      fetchPage,
    });
    expect(pack.failedUrls).toHaveLength(2);
    expect(pack.extracts).toHaveLength(0);
    expect(pack.counts.failedExtracts).toBe(2);
    expect(pack.counts.usablePages).toBe(0);
    expect(pack.counts.priceEvidenceCount).toBe(0);
  });

  it('countExtractEvidence derives price/rating/availability from extracts only', () => {
    const extracts = [
      { title: 'A', extract: extractPageFacts(page('A', 12.99, 'available', 4.5)) },
      { title: 'B', extract: extractPageFacts(page('B', null, 'unavailable')) },
      { title: 'C', extract: extractPageFacts(page('C', 8.5, 'available')) },
    ];
    const c = countExtractEvidence(extracts);
    expect(c.priceEvidenceCount).toBe(2);
    expect(c.ratingEvidenceCount).toBe(1);
    expect(c.availabilityEvidenceCount).toBe(2);
    expect(c.usablePages).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Evidence-quality gate
// ---------------------------------------------------------------------------

describe('assessEvidenceQuality (Phase 4D)', () => {
  const good: EvidenceCounts = {
    usablePages: 6, attemptedPages: 8, successfulExtracts: 6, failedExtracts: 2,
    independentDomains: 4, priceEvidenceCount: 5, ratingEvidenceCount: 3, availabilityEvidenceCount: 5,
  };

  it('passes with sufficient evidence and reports the pack contents', () => {
    const a = assessEvidenceQuality(good);
    expect(a.pass).toBe(true);
    expect(a.missing).toHaveLength(0);
    expect(a.reasons.join(' ')).toContain('6 usable exact product pages');
    expect(a.reasons.join(' ')).toContain('4 independent domains');
  });

  it('fails with EXACT missing evidence reasons (no free points)', () => {
    const a = assessEvidenceQuality({ ...good, usablePages: 2, priceEvidenceCount: 1, availabilityEvidenceCount: 0, independentDomains: 1 });
    expect(a.pass).toBe(false);
    expect(a.missing).toContain('only 2 usable exact product pages (need >= 4)');
    expect(a.missing).toContain('only 1 independent source domains (need >= 3)');
    expect(a.missing).toContain('price evidence on 1 products (need >= 3)');
    expect(a.missing).toContain('availability evidence on 0 products (need >= 3)');
  });

  it('respects configurable thresholds (conservative defaults, not business truth)', () => {
    const strict = assessEvidenceQuality(good, { minPages: 8, minDomains: 5, minPriceEvidence: 6, minAvailabilityEvidence: 6, minRatingEvidence: 0 });
    expect(strict.pass).toBe(false);
    expect(strict.missing.length).toBeGreaterThan(0);
    const loose = assessEvidenceQuality({ ...good, usablePages: 4, independentDomains: 3, priceEvidenceCount: 3, availabilityEvidenceCount: 3, ratingEvidenceCount: 0 });
    expect(loose.pass).toBe(true); // DEFAULT thresholds exactly met
    expect(DEFAULT_EVIDENCE_QUALITY).toEqual({ minPages: 4, minDomains: 3, minPriceEvidence: 3, minAvailabilityEvidence: 3, minRatingEvidence: 0 });
  });
});

// ---------------------------------------------------------------------------
// Engine: quality gate before DeepSeek + persistence
// ---------------------------------------------------------------------------

describe('runMarketIntelligenceJob evidence gate (Phase 4D)', () => {
  it('MARKET EVIDENCE INSUFFICIENT → DEEPSEEK CALL = NO (aiCall never invoked), aiUsed=false', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const aiCall = vi.fn(async () => { throw new Error('should never be called'); });
    const fetchPage = vi.fn(async () => page('Lone Product', 20, 'available', 4.5));
    const result = await runMarketIntelligenceJob({
      query: 'pet enrichment',
      market: 'US',
      db,
      discover: async () => ({ query: 'pet enrichment', rawLinks: [], urls: ['https://retailer1.com/product/only-one'], duplicates: 0, filtered: 0 }),
      fetchPage,
      aiCall,
    });
    expect(aiCall).not.toHaveBeenCalled(); // gate blocked DeepSeek
    expect(result.aiUsed).toBe(false);
    expect(result.evidence.evidenceQuality).toBe('insufficient');
    expect(result.evidence.evidenceQualityReasons.some((r) => r.includes('only 1 usable exact product pages'))).toBe(true);
    // Persisted metadata reflects the thin pack.
    const job = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'MARKET_INTELLIGENCE');
    const out = job?.output as Record<string, unknown> | undefined;
    expect(out?.evidenceQuality).toBe('insufficient');
    expect(out?.discoveredUrls).toBe(1);
    expect(out?.selectedUrls).toEqual(['https://retailer1.com/product/only-one']);
    expect(out?.priceEvidenceCount).toBe(1);
    expect(out?.availabilityEvidenceCount).toBe(1);
  });

  it('sufficient evidence pack → DeepSeek called and persisted metadata recorded', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const aiCall = vi.fn(async () => JSON.stringify({
      marketOpportunityScore: 72, trendConfidence: 'inferred', demandEvidence: 'evidence', competitionLevel: 'medium',
      customerPainPoint: null, priceBand: { min: 5, max: 40 }, risks: [], recommendedSearchQueries: ['dog travel bag'],
      reasoningSummary: 'grounded',
    }));
    const fetchPage = vi.fn(async (url: string): Promise<FetchedSourcePage> => {
      const i = productPages.indexOf(url);
      if (i === -1) throw new Error('not selected');
      return page(`Product ${i}`, 8 + i, 'available', i < 5 ? 4.5 : undefined);
    });
    const result = await runMarketIntelligenceJob({
      query: 'dog travel accessories',
      market: 'US',
      db,
      discover: async () => ({ query: 'dog travel accessories', rawLinks: [], urls: productPages, duplicates: 0, filtered: 0 }),
      fetchPage,
      aiCall,
    });
    expect(aiCall).toHaveBeenCalledTimes(1); // gate passed → ONE DeepSeek call
    expect(result.aiUsed).toBe(true);
    expect(result.evidence.evidenceQuality).toBe('sufficient');
    expect(result.evidence.independentDomains).toBeGreaterThanOrEqual(3);
    const job = (db.rows.get('agent_jobs') || []).find((j) => j.type === 'MARKET_INTELLIGENCE');
    const out = job?.output as Record<string, unknown> | undefined;
    expect(out?.evidenceQuality).toBe('sufficient');
    expect(out?.independentDomains).toBeGreaterThanOrEqual(3);
    expect(out?.successfulExtracts).toBe(8);
    expect(out?.aiUsed).toBe(true);
  });

  it('extracts raise the deterministic score (price/rating/availability participate)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    // Discovery-only vs with extracts: the discovery-only run has no price
    // band, no ratings, no availability → strictly lower score.
    const run = (extracts: { title: string; extract: PageExtract }[] | undefined, urls: string[]) =>
      runMarketIntelligenceJob({
        query: 'dog travel accessories',
        market: 'US',
        db,
        discover: async () => ({ query: 'dog travel accessories', rawLinks: [], urls, duplicates: 0, filtered: 0 }),
        extracts,
        aiCall: async () => { throw new Error('not configured'); },
      });
    const richExtracts = Array.from({ length: 6 }, (_, i) => ({ title: `Product ${i}`, extract: extractPageFacts(page(`Product ${i}`, 9 + i, 'available', 4.5)) }));
    const thin = await run(undefined, ['https://r1.com/product/a']);
    const rich = await run(richExtracts, ['https://r1.com/product/a', 'https://r2.com/product/b', 'https://r3.com/product/c', 'https://r4.com/product/d', 'https://r5.com/product/e', 'https://r6.com/product/f']);
    // Deterministic market score must be strictly higher with price/rating/availability evidence.
    expect(rich.marketScore ?? 0).toBeGreaterThan(thin.marketScore ?? 100);
    expect(rich.evidence.priceEvidenceCount).toBe(6);
    expect(rich.evidence.ratingEvidenceCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Demand adapter (future hook — no credentials in Phase 4D)
// ---------------------------------------------------------------------------

describe('MarketDemandAdapter (Phase 4D §9-§10)', () => {
  it('no-op adapter returns zero signals and never blocks the pipeline', async () => {
    const adapter = new NoopMarketDemandAdapter();
    expect(adapter.configured).toBe(false);
    const signals = await collectDemandSignals(adapter, { query: 'dog toys', market: 'US' });
    expect(signals).toEqual([]);
  });

  it('unconfigured/undefined adapter contributes nothing', async () => {
    expect(await collectDemandSignals(undefined, { query: 'x', market: 'US' })).toEqual([]);
    expect(await collectDemandSignals(null, { query: 'x', market: 'US' })).toEqual([]);
  });

  it('a failing demand adapter never breaks the deterministic pipeline (returns [])', async () => {
    const failing = { provider: 'google', configured: true, getDemandSignals: async () => { throw new Error('down'); } };
    expect(await collectDemandSignals(failing, { query: 'x', market: 'US' })).toEqual([]);
  });
});
