// ============================================================================
// LUXEDGE V2 — PRODUCT SCOUT TESTS (Phase 4A)
//
// Covers: 100-point scoring, hard rejection filters, unknown-evidence
// handling, margin calculation, duplicate detection, supplier normalization,
// candidate persistence (admin-JWT db adapter), approval transitions and
// owner-only admin mutations (RLS-level: anon/customer cannot write).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import { slugify, hostOf, canonicalDomain, supplierFromUrl, dedupeKey, findDuplicate, parsePrice, parseReviewCount, parseRating } from '../normalize';
import { calculateMargin, marginAllowsAutoApprove } from '../margin';
import { applyRejectFilters, collectRiskFlags } from '../reject';
import { scoreCandidate, SCORE_WEIGHTS, SHORTLIST_THRESHOLD } from '../score';
import { extractPageFacts } from '../extract';
import { runScoutResearch, qaCandidate, runMarketIntelligenceJob } from '../engine';
import type { MarketDemandAdapter } from '../marketDemand';
import { persistCandidate, persistScore, ensureSupplier, createProductDraft, queueHermesFallback, publishProductDraft } from '../persist';
import { decodeRedirectUrl, extractLinks, isLikelyProductPage, cleanUrl, dedupeUrls, buildSearchUrl, buildQueries, discoverUrls } from '../discover';
import { signalsFromDiscovery, scoreMarketOpportunity, finalOpportunityScore, parseMarketAnalysis, runMarketIntelligence } from '../market';
import { DEFAULT_AUTONOMY_CONFIG, evaluateAutonomy, pushAttentionItem, loadAttentionItems, resolveAttentionItem, attentionForCandidate } from '../autonomy';
import { evidenceFingerprint, cacheGet, cachePut, clearAiCache, candidateEvidenceKey, aiPrefilter, makeAiBudget } from '../aiCost';
import { qaListing, buildDeterministicListing, generateListingDraft, parseListingJson } from '../listing';
import type { FetchedSourcePage, ScoutCandidate, AutonomyConfig } from '../types';

// ---------------------------------------------------------------------------
// Fake admin-JWT db adapter (mirrors RLS: only admin-token writes succeed)
// ---------------------------------------------------------------------------
class FakeDb implements DbAdapter {
  mode = 'supabase' as const;
  token: string | null = null;
  rows = new Map<string, Record<string, unknown>[]>();
  inserts: { table: string; row: Record<string, unknown> }[] = [];
  updates: { table: string; id: string; patch: Record<string, unknown> }[] = [];

  constructor() {
    this.rows.set('suppliers', []);
    this.rows.set('supplier_products', []);
    this.rows.set('product_candidates', []);
    this.rows.set('product_scores', []);
    this.rows.set('agent_jobs', []);
    this.rows.set('agent_runs', []);
    this.rows.set('agent_logs', []);
    this.rows.set('products', []);
    this.rows.set('product_images', []);
    this.rows.set('categories', [{ id: 'cat-pet-toys', name: 'Pet Toys', slug: 'pet-toys' }]);
  }

  private assertAdmin(): void {
    // RLS contract: writes require the admin JWT role claim.
    const claims = this.token ? (JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString()) as { app_metadata?: { role?: string } }) : null;
    if (!claims || claims.app_metadata?.role !== 'admin') {
      throw new Error('42501 row-level security violation');
    }
  }

  async list<T>(table: string): Promise<T[]> {
    return [...(this.rows.get(table) || [])] as T[];
  }
  async get<T>(table: string, id: string): Promise<T | null> {
    return ((this.rows.get(table) || []).find((r) => r.id === id) as T) || null;
  }
  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    return ((this.rows.get(table) || []).find((r) => r[column] === value) as T) || null;
  }
  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    this.assertAdmin();
    this.rows.get(table)?.push({ ...row });
    this.inserts.push({ table, row: { ...row } });
    return row;
  }
  async insertRaw<T>(table: string, row: T): Promise<T> {
    this.assertAdmin();
    this.rows.get(table)?.push({ ...(row as Record<string, unknown>) });
    this.inserts.push({ table, row: { ...(row as Record<string, unknown>) } });
    return row;
  }
  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.updateBy(table, 'id', id, patch);
  }
  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    this.assertAdmin();
    const list = this.rows.get(table) || [];
    const idx = list.findIndex((r) => r[column] === value);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    this.updates.push({ table, id: value, patch: { ...patch } });
    return list[idx] as T;
  }
  async remove(table: string, id: string): Promise<void> {
    this.assertAdmin();
    this.rows.set(table, (this.rows.get(table) || []).filter((r) => r.id !== id));
  }
  async testConnection() {
    return { ok: true, mode: 'supabase' as const, detail: 'fake' };
  }
}

function adminToken(): string {
  // { app_metadata: { role: 'admin' } } — signed payload shape only used by
  // the fake adapter's RLS simulation; real JWTs come from Supabase.
  const payload = Buffer.from(JSON.stringify({ app_metadata: { role: 'admin' } })).toString('base64url');
  return `header.${payload}.sig`;
}

function buyerToken(): string {
  const payload = Buffer.from(JSON.stringify({ app_metadata: { role: 'buyer' } })).toString('base64url');
  return `header.${payload}.sig`;
}

function page(text: string, images: string[] = []): FetchedSourcePage {
  return { text, images };
}

describe('normalize', () => {
  it('slugifies titles', () => {
    expect(slugify('KONG Classic Dog Toy')).toBe('kong-classic-dog-toy');
    expect(slugify('')).toBe('item');
  });

  it('derives host + supplier from URL', () => {
    expect(hostOf('https://www.kongcompany.com/kong-classic/')).toBe('kongcompany.com');
    const s = supplierFromUrl('https://www.chewy.com/dp/123');
    expect(s.name).toBe('Chewy');
    expect(s.baseUrl).toBe('https://chewy.com');
  });

  it('canonical domain merges www and non-www variants of the same supplier', () => {
    expect(canonicalDomain('https://www.kongcompany.com/kong-classic/')).toBe('kongcompany.com');
    expect(canonicalDomain('https://kongcompany.com/kong-extreme/')).toBe('kongcompany.com');
    expect(canonicalDomain('https://www.chewy.com/dp/1')).toBe('chewy.com');
  });

  it('builds stable dedupe keys and finds duplicates', () => {
    const k1 = dedupeKey('https://www.kongcompany.com/kong-classic/', 'KONG Classic');
    const k2 = dedupeKey('https://www.kongcompany.com/kong-classic/', 'KONG Classic Dog Toy');
    expect(k1).toBe(k2);
    const dup = findDuplicate(k1, [{ dedupeKey: k1, title: 'KONG Classic' }]);
    expect(dup).toBe('KONG Classic');
  });

  it('parses prices, ratings and review counts', () => {
    expect(parsePrice('$12.99')).toBe(12.99);
    expect(parsePrice('US$ 1,299.00')).toBe(1299);
    expect(parsePrice('no price here')).toBeNull();
    expect(parseRating('4.8 out of 5')).toBe(4.8);
    expect(parseRating('4.8/5')).toBe(4.8);
    expect(parseReviewCount('1,234 reviews')).toBe(1234);
    expect(parseReviewCount('none')).toBeNull();
  });
});

describe('margin', () => {
  it('computes landed cost and margin when shipping is known', () => {
    const m = calculateMargin({ supplierPrice: 10, shippingCost: 4 });
    expect(m.landedCost).toBe(14);
    expect(m.proposedLuxedgePrice).toBe(34.99);
    expect(m.grossMarginDollars).toBe(20.99);
    expect(m.grossMarginPct).toBeCloseTo(0.5999, 3);
    expect(m.confidence).toBe('high');
    expect(marginAllowsAutoApprove(m)).toBe(true);
  });

  it('keeps confidence low when shipping is unknown (no silent estimates)', () => {
    const m = calculateMargin({ supplierPrice: 10, shippingCost: null });
    expect(m.landedCost).toBeNull();
    expect(m.proposedLuxedgePrice).toBeNull();
    expect(m.confidence).toBe('low');
    expect(marginAllowsAutoApprove(m)).toBe(false);
    expect(m.notes.some((n) => n.includes('UNKNOWN'))).toBe(true);
  });

  it('never auto-approves a thin margin', () => {
    const m = calculateMargin({ supplierPrice: 20, shippingCost: 12, markup: 1.3 }); // landed 32 → 41.99 → 24%
    expect(marginAllowsAutoApprove(m)).toBe(false);
    const healthy = calculateMargin({ supplierPrice: 20, shippingCost: 12 }); // landed 32 → 79.99 → 60%
    expect(marginAllowsAutoApprove(healthy)).toBe(true);
  });
});

describe('hard rejection filters', () => {
  const base = (title: string) => {
    const extract = extractPageFacts(page(`og:title ${title}\nPrice: $12.99\nin stock\nMade in USA`));
    const margin = calculateMargin({ supplierPrice: 12.99, shippingCost: 4 });
    return { title, extract, margin, images: ['https://img/x.jpg'] };
  };

  it('rejects counterfeit/IP-risk titles', () => {
    const r = applyRejectFilters(base('Luxury Dog Bed — Inspired by Fendi'));
    expect(r?.reason).toContain('counterfeit');
  });

  it('rejects medical/veterinary claims without evidence', () => {
    const r = applyRejectFilters(base('Dog Supplement That Cures Arthritis'));
    expect(r?.reason).toContain('medical');
  });

  it('rejects dangerous/regulated and battery/fire products', () => {
    expect(applyRejectFilters(base('Shock Collar for Dogs'))?.reason).toContain('dangerous');
    expect(applyRejectFilters(base('Lithium Battery Heated Vest'))?.reason).toContain('battery');
  });

  it('rejects unavailable products and missing prices/images', () => {
    const noPrice = extractPageFacts(page('og:title Quiet Toy\nout of stock'));
    const margin = calculateMargin({ supplierPrice: null, shippingCost: null });
    const r = applyRejectFilters({ title: 'Quiet Toy', extract: noPrice, margin, images: [] });
    expect(r).not.toBeNull();
  });

  it('records risk flags without auto-rejecting a healthy candidate', () => {
    const input = base('KONG Classic Dog Toy');
    expect(applyRejectFilters(input)).toBeNull();
    const flags = collectRiskFlags(input);
    expect(Array.isArray(flags)).toBe(true);
  });
});

describe('scoring (100 points)', () => {
  const goodExtract = () => {
    const e = extractPageFacts(page(
      'og:title Orthopedic Dog Bed\nPrice: $39.99\nin stock\nFree Shipping\nships within 3-5 business days\n4.8 out of 5\n1,200 reviews\nMade in USA\nSizes: S, M, L'
    ));
    e.images = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'];
    return e;
  };

  it('uses the exact required weights summing to 100', () => {
    expect(SCORE_WEIGHTS.demand).toBe(20);
    expect(SCORE_WEIGHTS.supplierReliability).toBe(15);
    expect(SCORE_WEIGHTS.usaDelivery).toBe(15);
    expect(SCORE_WEIGHTS.profitMargin).toBe(15);
    expect(SCORE_WEIGHTS.ratingsEvidence).toBe(10);
    expect(SCORE_WEIGHTS.visualViral).toBe(10);
    expect(SCORE_WEIGHTS.competition).toBe(5);
    expect(SCORE_WEIGHTS.upsell).toBe(5);
    expect(SCORE_WEIGHTS.returnRisk).toBe(5);
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores a fully-evidenced candidate above the shortlist threshold', () => {
    const extract = goodExtract();
    const margin = calculateMargin({ supplierPrice: 39.99, shippingCost: 4 });
    const score = scoreCandidate({
      title: 'Orthopedic Dog Bed', extract, margin, supplierVerified: true,
      sourceIsManufacturer: true, images: extract.images, riskFlags: [],
    });
    expect(score.overall).toBeGreaterThanOrEqual(SHORTLIST_THRESHOLD);
    expect(score.breakdown.profitMargin.points).toBe(15);
    expect(score.breakdown.ratingsEvidence.points).toBeGreaterThan(0);
    expect(score.breakdown.visualViral.points).toBe(10);
  });

  it('gives zero points where evidence is unavailable', () => {
    const extract = extractPageFacts(page('og:title Mystery Toy'));
    const margin = calculateMargin({ supplierPrice: null, shippingCost: null });
    const score = scoreCandidate({
      title: 'Mystery Toy', extract, margin, supplierVerified: false,
      sourceIsManufacturer: false, images: [], riskFlags: ['Availability unverified', 'No rating'],
    });
    expect(score.breakdown.supplierReliability.points).toBe(0);
    expect(score.breakdown.profitMargin.points).toBe(0);
    expect(score.breakdown.ratingsEvidence.points).toBe(0);
    expect(score.breakdown.visualViral.points).toBe(0);
    expect(score.overall).toBeLessThan(SHORTLIST_THRESHOLD);
  });

  it('caps every criterion at its max', () => {
    const extract = goodExtract();
    const margin = calculateMargin({ supplierPrice: 5, shippingCost: 2 });
    const score = scoreCandidate({
      title: 'Orthopedic Dog Bed', extract, margin, supplierVerified: true,
      sourceIsManufacturer: true, images: extract.images, riskFlags: [],
    });
    for (const [k, c] of Object.entries(score.breakdown)) {
      expect(c.points).toBeLessThanOrEqual(c.max);
      expect(SCORE_WEIGHTS[k]).toBe(c.max);
    }
  });
});

describe('discovery (autonomous mode)', () => {
  it('decodes DuckDuckGo /l/ redirects into the real target', () => {
    expect(decodeRedirectUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-classic%2F&rut=x')).toBe('https://www.kongcompany.com/kong-classic/');
    expect(decodeRedirectUrl('https://www.kongcompany.com/kong-classic/')).toBe('https://www.kongcompany.com/kong-classic/');
  });

  it('extracts links from markdown and HTML search results', () => {
    const links = extractLinks('[KONG Classic](https://www.kongcompany.com/kong-classic/) <a href="https://www.petco.com/shop/en/petcostore/product/kong">x</a>');
    expect(links).toContain('https://www.kongcompany.com/kong-classic/');
    expect(links).toContain('https://www.petco.com/shop/en/petcostore/product/kong');
  });

  it('classifies product pages vs category/search/blog pages', () => {
    expect(isLikelyProductPage('https://www.kongcompany.com/kong-classic/')).toBe(true);
    expect(isLikelyProductPage('https://www.chewy.com/dp/193158')).toBe(true);
    expect(isLikelyProductPage('https://www.kongcompany.com/dog-toys/')).toBe(false); // category
    expect(isLikelyProductPage('https://html.duckduckgo.com/html/?q=dog+toys')).toBe(false); // search
    expect(isLikelyProductPage('https://www.chewy.com/blog/posts/10-best-toys')).toBe(false); // blog
    expect(isLikelyProductPage('https://www.kongcompany.com/')).toBe(false); // domain root
  });

  it('cleans tracking params and dedupes URLs by host+path', () => {
    const a = cleanUrl('https://www.kongcompany.com/kong-classic/?utm_source=x&utm_medium=y');
    expect(a).toBe('https://www.kongcompany.com/kong-classic');
    const { urls, duplicates } = dedupeUrls([
      'https://www.kongcompany.com/kong-classic/',
      'https://kongcompany.com/kong-classic/',
      'https://www.kongcompany.com/kong-extreme/',
    ]);
    expect(duplicates).toBe(1);
    expect(urls.length).toBe(2);
  });

  it('builds a search URL with market/category/cost bias', () => {
    const u = buildSearchUrl({ query: 'dog toys', market: 'USA', category: 'dog', maxSupplierCost: 20 });
    expect(u).toContain(encodeURIComponent('dog toys'));
    expect(u).toContain('duckduckgo.com');
  });

  it('discovers product URLs from a fake search response, filtering and deduping', async () => {
    const fakeFetch = async () => [
      '[KONG Classic](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-classic%2F&rut=1)',
      '[KONG Classic dup](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-classic%2F&rut=2)',
      '[KONG Extreme](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-extreme%2F&rut=3)',
      '[Dog Toys Category](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fdog-toys%2F&rut=4)',
    ].join('\n');
    const r = await discoverUrls({ query: 'KONG Classic dog toy', maxResults: 10 }, fakeFetch);
    expect(r.urls).toContain('https://www.kongcompany.com/kong-classic');
    expect(r.urls).toContain('https://www.kongcompany.com/kong-extreme');
    expect(r.urls.some((u) => u.includes('dog-toys'))).toBe(false); // category filtered
    expect(r.duplicates).toBe(1); // the dup classic link
    expect(r.warning).toBeUndefined();
  });

  it('expands a generic category query into concrete product-type searches', async () => {
    const fakeFetch = async (url: string) => {
      const q = decodeURIComponent(url.split('q=')[1] || '');
      if (q.includes('dog toy')) {
        return '[KONG Classic](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-classic%2F&rut=1)';
      }
      if (q.includes('cat toy')) {
        return '[Frisco Cat Toy](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chewy.com%2Ffrisco-bird-cat-toy%2Fdp%2F193158&rut=2)';
      }
      return '[Homepage](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chewy.com%2F&rut=3)'; // filtered as root
    };
    const r = await discoverUrls({ query: 'pet accessories', market: 'USA', maxResults: 25 }, fakeFetch);
    expect(r.urls).toContain('https://www.kongcompany.com/kong-classic');
    expect(r.urls).toContain('https://www.chewy.com/frisco-bird-cat-toy/dp/193158');
    expect(r.urls.some((u) => u === 'https://www.chewy.com')).toBe(false); // root filtered
    expect(r.duplicates).toBe(0);
  });

  it('reports a warning when the search endpoint is unreachable', async () => {
    const r = await discoverUrls({ query: 'dog toys' }, async () => { throw new Error('no proxy'); });
    expect(r.warning).toContain('no proxy');
    expect(r.urls.length).toBe(0);
  });

  it('falls through to the next search source when the primary is down (resilience)', async () => {
    // Primary (DuckDuckGo) throws; the chain must try Mojeek and return its results.
    const fetchRaw = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo.com')) throw new Error('DDG down');
      if (url.includes('mojeek.com')) {
        return '[KONG Classic](https://www.kongcompany.com/kong-classic/) — durable natural rubber dog toy for chewing and fetch.';
      }
      throw new Error('unexpected source');
    });
    const r = await discoverUrls({ query: 'KONG Classic dog toy', maxResults: 10 }, fetchRaw);
    expect(r.urls).toContain('https://www.kongcompany.com/kong-classic');
    expect(r.source).toBe('mojeek');
    expect(r.warning).toContain('DuckDuckGo HTML');
  });

  it('uses the third source when the first two fail — a single outage never kills discovery', async () => {
    const fetchRaw = vi.fn(async (url: string) => {
      if (url.includes('duckduckgo.com')) throw new Error('DDG down');
      if (url.includes('mojeek.com')) throw new Error('Mojeek down');
      if (url.includes('startpage.com')) {
        return '[KONG Classic](https://www.kongcompany.com/kong-classic/) — durable natural rubber dog toy for chewing and fetch.';
      }
      throw new Error('unexpected source');
    });
    const r = await discoverUrls({ query: 'KONG Classic dog toy', maxResults: 10 }, fetchRaw);
    expect(r.urls).toContain('https://www.kongcompany.com/kong-classic');
    expect(r.source).toBe('startpage');
  });

  it('reports which source produced the results when the primary works', async () => {
    const fetchRaw = vi.fn(async () =>
      '[KONG Classic](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kongcompany.com%2Fkong-classic%2F&rut=1)'
    );
    const r = await discoverUrls({ query: 'KONG Classic dog toy', maxResults: 10 }, fetchRaw);
    expect(r.source).toBe('duckduckgo');
  });

  it('PHASE 4J — single door dog cage is searched as itself, never expanded to generic dog toy/cat toy', async () => {
    const queries = buildQueries({ query: 'single door dog cage', market: 'US' });
    expect(queries).toEqual(['single door dog cage US']);
    // The specific query is the ONLY search — it must never be replaced by
    // unrelated generic QUERY_EXPANSIONS (Phase 4I regression: `cage` was
    // missing from the product-noun list so the seed query degraded into
    // dog-toy/cat-toy searches).
    for (const q of queries) {
      expect(q).not.toMatch(/dog toy/);
      expect(q).not.toMatch(/cat toy/);
    }
  });

  it('PHASE 4J — other CJ-seeded concept nouns also search as themselves', () => {
    for (const q of ['dog playpen indoor fence', 'dog crate furniture wheel', 'pet dog seat belt leash adjustable', 'cute cat blanket dog pet mat']) {
      const queries = buildQueries({ query: q });
      expect(queries.length).toBe(1);
      expect(queries[0]).toBe(q);
    }
  });

  it('PHASE 4K — structural guarantee: pet + >=3 significant tokens is a specific query even without a listed noun', () => {
    // The Phase 4K fresh pool proved the noun-list approach is whack-a-mole:
    // "dog grooming bath tub stainless steel" (no listed noun at the time)
    // was expanded into dog-toy/cat-toy searches. The guarantee must be
    // STRUCTURAL: a pet keyword + a concrete phrase is never generic.
    for (const q of [
      'dog grooming bath tub stainless steel',
      '2 in 1 pet nail clipper with led light',
      'dog grooming supplies',
      'luxury small dog bed hidden storage',
    ]) {
      const queries = buildQueries({ query: q });
      expect(queries.length).toBe(1);
      expect(queries[0]).toBe(q);
      expect(q).not.toMatch(/dog toy/);
      expect(q).not.toMatch(/cat toy/);
    }
  });

  it('PHASE 4K — short generic phrases still expand (pet accessories / dog toys / pet supplies)', () => {
    // A 1-2 token pet phrase is a generic category, not a specific product.
    expect(buildQueries({ query: 'pet accessories' })).toEqual(expect.arrayContaining(['dog toy', 'cat toy', 'dog bed']));
    expect(buildQueries({ query: 'dog toys' })).toEqual(expect.arrayContaining(['dog toy', 'cat toy']));
    expect(buildQueries({ query: 'pet supplies' })).toEqual(expect.arrayContaining(['dog toy', 'cat toy']));
  });

  it('PHASE 4J — a genuinely generic category query still expands (no regression)', () => {
    expect(buildQueries({ query: 'pet accessories' })).toEqual(
      expect.arrayContaining(['dog toy', 'cat toy', 'dog bed'])
    );
  });
});

describe('extractPageFacts', () => {
  it('extracts only facts present in the page', () => {
    const e = extractPageFacts(page('og:title KONG Classic\nPrice: $11.96\nin stock\nFree Shipping\nships within 3-5 days\n4.8 out of 5\n1,200 reviews\nMade in USA'));
    expect(e.title).toContain('KONG Classic');
    expect(e.price).toBe(11.96);
    expect(e.availability).toBe('available');
    expect(e.freeShipping).toBe(true);
    expect(e.shippingDays).toEqual({ min: 3, max: 5 });
    expect(e.rating).toBe(4.8);
    expect(e.reviewCount).toBe(1200);
    expect(e.origin).toContain('USA');
  });

  it('keeps missing facts unknown (no invention)', () => {
    const e = extractPageFacts(page('some random text without product markers'));
    expect(e.price).toBeNull();
    expect(e.availability).toBe('unknown');
    expect(e.shippingDays).toBeNull();
    expect(e.rating).toBeNull();
  });
});

describe('researchUrl + runScoutResearch pipeline', () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
    (db as unknown as { setAccessToken: (t: string | null) => void }).setAccessToken = (t: string | null) => { db.token = t; };
  });

  const IMGS = ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg', 'https://img/4.jpg'];
  const fetchOk = vi.fn(async (url: string) => {
    if (url.includes('chewy')) return page('og:title Chewy Pet Toy\nPrice: $14.99\nin stock\nFree Shipping\n4.6 out of 5\nMade in USA\nSizes: S, M', IMGS);
    if (url.includes('bad')) return page('nothing useful here');
    return page('og:title Generic Pet Toy\nPrice: $9.99\nin stock', IMGS);
  });

  it('queues a Hermes page-read fallback when EVERY url fails automated fetch', async () => {
    db.token = adminToken();
    const fetchAllFail = vi.fn(async () => { throw new Error('all proxies down'); });
    await runScoutResearch({
      urls: ['https://www.chewy.com/dp/1', 'https://www.chewy.com/dp/2'],
      db: db as unknown as DbAdapter,
      fetchPage: fetchAllFail,
    });
    const jobs = db.rows.get('agent_jobs') as { type: string; status: string; provider: string | null; input: Record<string, unknown> }[];
    const queued = jobs.filter((j) => j.status === 'queued' && j.provider === 'hermes');
    expect(queued.length).toBe(1);
    expect((queued[0].input as Record<string, unknown>).stage).toBe('page-read');
    expect((queued[0].input as Record<string, unknown>).urls).toEqual(['https://www.chewy.com/dp/1', 'https://www.chewy.com/dp/2']);
  });

  it('does NOT queue a Hermes page-read fallback when some URLs survived', async () => {
    db.token = adminToken();
    await runScoutResearch({
      urls: ['https://www.chewy.com/dp/1', 'https://www.chewy.com/dp/zz-bad'],
      db: db as unknown as DbAdapter,
      fetchPage: fetchOk,
    });
    const jobs = db.rows.get('agent_jobs') as { status: string; provider: string | null }[];
    expect(jobs.some((j) => j.status === 'queued' && j.provider === 'hermes')).toBe(false);
  });

  it('creates a candidate + score + three durable jobs (RESEARCH → SCORE → QA)', async () => {
    db.token = adminToken();
    const result = await runScoutResearch({
      urls: ['https://www.chewy.com/dp/1'],
      db: db as unknown as DbAdapter,
      fetchPage: fetchOk,
    });
    expect(result.researched).toBe(1);
    expect(db.rows.get('product_candidates')?.length).toBe(1);
    expect(db.rows.get('product_scores')?.length).toBe(1);
    const jobs = db.rows.get('agent_jobs') as { type: string; status: string }[];
    expect(jobs.length).toBe(3);
    expect(jobs.map((j) => j.type)).toEqual(['PRODUCT_RESEARCH', 'PRODUCT_SCORE', 'PRODUCT_QA']);
    expect(jobs.every((j) => j.status === 'completed')).toBe(true);
    expect(db.rows.get('agent_runs')?.length).toBeGreaterThanOrEqual(3);
    const cand = db.rows.get('product_candidates')?.[0] as { status: string; evidence: { unknownFields: string[] } };
    expect(cand.status).toBe('qualified');
    expect(cand.evidence.unknownFields).not.toContain('price');
    expect(cand.evidence.unknownFields).toContain('shippingDays'); // no invented delivery
  });

  it('deduplicates identical source URLs in one run', async () => {
    db.token = adminToken();
    const result = await runScoutResearch({
      urls: ['https://www.chewy.com/dp/1', 'https://www.chewy.com/dp/1'],
      db: db as unknown as DbAdapter,
      fetchPage: fetchOk,
    });
    expect(result.researched).toBe(1);
    expect(db.rows.get('product_candidates')?.length).toBe(1);
  });

  it('skips unverifiable sources without fabricating a candidate', async () => {
    db.token = adminToken();
    const result = await runScoutResearch({
      urls: ['https://bad.example/product'],
      db: db as unknown as DbAdapter,
      fetchPage: fetchOk,
    });
    expect(result.researched).toBe(0);
    expect(result.failed).toBe(1);
    expect(db.rows.get('product_candidates')?.length).toBe(0);
  });

  it('rejects risky titles during the SCORE phase', async () => {
    db.token = adminToken();
    const risky = vi.fn(async () => page('og:title Replica Gucci Dog Collar\nPrice: $5.99\nin stock', IMGS));
    const result = await runScoutResearch({
      urls: ['https://x.example/p1'],
      db: db as unknown as DbAdapter,
      fetchPage: risky,
    });
    expect(result.rejected).toBe(1);
    const cand = db.rows.get('product_candidates')?.[0] as { status: string; rejection_reason: string };
    expect(cand.status).toBe('rejected');
    expect(cand.rejection_reason).toContain('counterfeit');
  });

  it('QA flags shortlisted candidates with incomplete evidence and passes complete ones', () => {
    const complete: ScoutCandidate = {
      id: 'a', title: 'KONG Classic', source: 'KONG', sourceUrl: 'https://x', supplierSlug: 'kong',
      images: ['https://img/1.jpg', 'https://img/2.jpg'],
      evidence: {
        sourceUrl: 'https://x', observedAt: 't',
        title: { status: 'verified', value: 'KONG Classic' },
        supplierPrice: { status: 'verified', value: 11.96 },
        shippingCost: { status: 'inferred', value: 0, note: 'Free shipping' },
        shippingDays: { status: 'verified', value: { min: 3, max: 5 } },
        availability: { status: 'verified', value: 'available' },
        images: { status: 'verified', value: ['https://img/1.jpg', 'https://img/2.jpg'] },
        rating: { status: 'unknown', value: null },
        origin: { status: 'verified', value: 'USA' },
        category: { status: 'inferred', value: 'Dog' },
        sizes: { status: 'unknown', value: null },
        unknownFields: [], riskNotes: [],
      },
      margin: { supplierPrice: 11.96, shippingCost: 0, landedCost: 11.96, proposedLuxedgePrice: 29.99, grossMarginDollars: 18.03, grossMarginPct: 0.6, confidence: 'high', notes: [] },
      score: { overall: 80, weights: {}, breakdown: {}, explanation: 'ok' },
      status: 'qualified', createdAt: 't',
    };
    const ok = qaCandidate(complete);
    expect(ok.passed).toBe(true);
    expect(ok.issues.length).toBe(0);

    const incomplete: ScoutCandidate = {
      ...complete,
      id: 'b', title: 'Unknown Toy',
      evidence: {
        ...complete.evidence,
        supplierPrice: { status: 'unknown', value: null },
        shippingCost: { status: 'unknown', value: null },
        shippingDays: { status: 'unknown', value: null },
        images: { status: 'unknown', value: [] },
        unknownFields: ['price', 'shippingDays', 'images'],
      },
      margin: { supplierPrice: null, shippingCost: null, landedCost: null, proposedLuxedgePrice: null, grossMarginDollars: null, grossMarginPct: null, confidence: 'low', notes: [] },
    };
    const bad = qaCandidate(incomplete);
    expect(bad.passed).toBe(false);
    expect(bad.issues.some((i) => i.includes('price'))).toBe(true);
    expect(bad.issues.some((i) => i.includes('LOW'))).toBe(true);
  });
});

describe('persistence + admin-only mutations', () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it('enforces admin-only writes (RLS simulation)', async () => {
    db.token = null; // anonymous
    await expect(ensureSupplier(db as unknown as DbAdapter, { name: 'X', slug: 'x', baseUrl: 'https://x' })).rejects.toThrow('row-level security');
    db.token = buyerToken(); // authenticated customer
    await expect(db.insert('product_candidates', { id: '1' })).rejects.toThrow('row-level security');
    db.token = adminToken(); // admin
    await expect(db.insert('product_candidates', { id: '1', title: 'T', source: 'S', source_url: 'u', images: [], status: 'researching', created_at: 't', updated_at: 't' })).resolves.toBeTruthy();
  });

  it('queues a Hermes fallback job (search stage) with the audit marker', async () => {
    db.token = adminToken();
    const id = await queueHermesFallback(db as unknown as DbAdapter, 'search', { query: 'dog toys', market: 'USA' });
    expect(id).toBeTruthy();
    const jobs = db.rows.get('agent_jobs') as unknown[];
    expect(jobs.length).toBe(1);
    const job = jobs[0] as Record<string, unknown>;
    expect(job.type).toBe('PRODUCT_RESEARCH');
    expect(job.status).toBe('queued');
    expect(job.provider).toBe('hermes');
    expect((job.input as Record<string, unknown>).hermesQueue).toBe(true);
    expect((job.input as Record<string, unknown>).stage).toBe('search');
    expect((job.input as Record<string, unknown>).query).toBe('dog toys');
  });

  it('queues a Hermes fallback job for the page-read stage with the failed URLs', async () => {
    db.token = adminToken();
    const id = await queueHermesFallback(db as unknown as DbAdapter, 'page-read', { urls: ['https://x.com/p/1', 'https://x.com/p/2'], jobId: 'j1', reason: 'all proxies down' });
    expect(id).toBeTruthy();
    const job = (db.rows.get('agent_jobs') as unknown[])[0] as Record<string, unknown>;
    expect((job.input as Record<string, unknown>).stage).toBe('page-read');
    expect(((job.input as Record<string, unknown>).urls as string[]).length).toBe(2);
    expect((job.input as Record<string, unknown>).reason).toContain('proxies');
  });

  it('never throws when the queue write itself fails — the pipeline continues', async () => {
    db.token = null; // anonymous → RLS blocks the insert
    const id = await queueHermesFallback(db as unknown as DbAdapter, 'ai-analysis', { query: 'x' });
    expect(id).toBeNull(); // graceful degradation, no throw
  });

  it('does not duplicate suppliers across www / non-www base URLs', async () => {
    db.token = adminToken();
    const first = await ensureSupplier(db as unknown as DbAdapter, { name: 'KONG Company', slug: 'kong-company', baseUrl: 'https://www.kongcompany.com' });
    // Same real supplier discovered via the non-www domain (engine's supplierFromUrl strips www):
    const second = await ensureSupplier(db as unknown as DbAdapter, { name: 'Kongcompany', slug: 'kongcompany-com', baseUrl: 'https://kongcompany.com' });
    expect(second.id).toBe(first.id);
    expect((db.rows.get('suppliers') as unknown[]).length).toBe(1);
  });

  it('persists a candidate, score and supplier with admin token', async () => {
    db.token = adminToken();
    const sup = await ensureSupplier(db as unknown as DbAdapter, { name: 'KONG Company', slug: 'kong-company', baseUrl: 'https://www.kongcompany.com' });
    expect(sup.id).toBeTruthy();
    const cand = await persistCandidate(db as unknown as DbAdapter, {
      supplierProductId: null,
      title: 'KONG Classic',
      source: 'KONG Company',
      sourceUrl: 'https://www.kongcompany.com/kong-classic/',
      images: ['https://img/1.jpg'],
      evidence: {
        sourceUrl: 'https://www.kongcompany.com/kong-classic/',
        observedAt: '2026-01-01T00:00:00Z',
        title: { status: 'verified', value: 'KONG Classic' },
        supplierPrice: { status: 'verified', value: 11.96 },
        shippingCost: { status: 'unknown', value: null },
        shippingDays: { status: 'verified', value: { min: 3, max: 5 } },
        availability: { status: 'verified', value: 'available' },
        images: { status: 'verified', value: ['https://img/1.jpg'] },
        rating: { status: 'unknown', value: null },
        origin: { status: 'verified', value: 'USA' },
        category: { status: 'inferred', value: 'Dog' },
        sizes: { status: 'unknown', value: null },
        unknownFields: [],
        riskNotes: [],
      },
      status: 'qualified',
    });
    expect(cand.existing).toBe(false);
    await persistScore(db as unknown as DbAdapter, cand.id, {
      overall: 80,
      weights: {},
      breakdown: { demand: { points: 20, max: 20, note: 'x' } },
      explanation: 'ok',
    });
    expect(db.rows.get('product_scores')?.length).toBe(1);
  });

  it('creates a product DRAFT (never published) honoring legacy columns', async () => {
    db.token = adminToken();
    const catId = await (async () => {
      const { findCategoryId } = await import('../persist');
      return findCategoryId(db as unknown as DbAdapter, 'Pet Toys');
    })();
    expect(catId).toBe('cat-pet-toys');
    const res = await createProductDraft(db as unknown as DbAdapter, {
      title: 'KONG Classic Dog Toy',
      slug: 'kong-classic-dog-toy',
      categoryId: catId,
      price: 11.96,
      compareAtPrice: null,
      costPrice: 11.96,
      landedCost: 11.96,
      grossMargin: null,
      images: ['https://img/1.jpg'],
      shortDesc: 'Durable rubber toy',
      sourceUrl: 'https://www.kongcompany.com/kong-classic/',
      supplierName: 'KONG Company',
      scoreOverall: 82,
    });
    expect(res.existing).toBe(false);
    const prod = db.rows.get('products')?.[0] as Record<string, unknown>;
    expect(prod.status).toBe('draft'); // never published automatically
    expect(prod.currency).toBe('USD');
    expect(prod.title).toBe('KONG Classic Dog Toy');
    expect(db.rows.get('product_images')?.length).toBe(1);
  });

  it('publishes a scout draft to the live storefront (active + COMMERCE_READY + audit)', async () => {
    db.token = adminToken();
    const { id } = await createProductDraft(db as unknown as DbAdapter, {
      title: 'KONG Classic Dog Toy',
      slug: 'kong-classic-dog-toy',
      categoryId: null,
      price: 11.96,
      compareAtPrice: null,
      costPrice: 11.96,
      landedCost: 11.96,
      grossMargin: null,
      images: ['https://img/1.jpg'],
      shortDesc: 'Durable rubber toy',
      sourceUrl: 'https://www.kongcompany.com/kong-classic/',
      supplierName: 'KONG Company',
      scoreOverall: 82,
      supplierProductId: 'sp-1',
    });
    const res = await publishProductDraft(db as unknown as DbAdapter, {
      productId: id,
      candidateId: 'c1',
      candidateTitle: 'KONG Classic Dog Toy',
      scoreOverall: 82,
      channel: 'owner',
    });
    expect(res.published).toBe(true);
    expect(res.reason).toBe('live');
    const prod = db.rows.get('products')?.[0] as Record<string, unknown>;
    expect(prod.status).toBe('active'); // storefront filter: published|active
    expect(prod.published_at).toBeTruthy();
    expect(prod.commerce_readiness).toBe('COMMERCE_READY');
    const ev = prod.product_source_evidence as Record<string, unknown>;
    expect(ev.status).toBe('published');
    expect(ev.publishedVia).toBe('owner');
    expect(ev.supplierProductId).toBe('sp-1'); // CJ provenance preserved
    const jobs = db.rows.get('agent_jobs') || [];
    expect(jobs.some((j) => j.type === 'PRODUCT_PUBLISH' && j.status === 'completed')).toBe(true);
  });

  it('publish is idempotent: already-active products stay live without a second audit job', async () => {
    db.token = adminToken();
    const { id } = await createProductDraft(db as unknown as DbAdapter, {
      title: 'X', slug: 'x', categoryId: null, price: 5, compareAtPrice: null,
      costPrice: 5, landedCost: 5, grossMargin: null, images: ['https://img/1.jpg'],
      shortDesc: '', sourceUrl: 'https://s', supplierName: 'S', scoreOverall: null,
    });
    await publishProductDraft(db as unknown as DbAdapter, { productId: id, candidateId: null, candidateTitle: 'X', scoreOverall: null, channel: 'owner' });
    const res2 = await publishProductDraft(db as unknown as DbAdapter, { productId: id, candidateId: null, candidateTitle: 'X', scoreOverall: null, channel: 'auto' });
    expect(res2.published).toBe(true);
    expect(res2.reason).toBe('already-live');
    const jobs = db.rows.get('agent_jobs') || [];
    expect(jobs.filter((j) => j.type === 'PRODUCT_PUBLISH').length).toBe(1);
  });

  it('publish of a missing product returns missing without throwing or auditing', async () => {
    db.token = adminToken();
    const res = await publishProductDraft(db as unknown as DbAdapter, {
      productId: 'nope', candidateId: null, candidateTitle: 'X', scoreOverall: null, channel: 'owner',
    });
    expect(res.published).toBe(false);
    expect(res.reason).toBe('missing');
    expect((db.rows.get('agent_jobs') || []).length).toBe(0);
  });

  it('publish honors the admin-JWT RLS contract (anon writes rejected)', async () => {
    // db.token stays null (anon) — the products update must throw.
    db.rows.set('products', [{ id: 'p1', status: 'draft' }]);
    await expect(
      publishProductDraft(db as unknown as DbAdapter, { productId: 'p1', candidateId: null, candidateTitle: 'X', scoreOverall: null, channel: 'owner' })
    ).rejects.toThrow('row-level security');
  });

  it('approval transitions are explicit owner actions only', async () => {
    db.token = adminToken();
    await db.insert('product_candidates', { id: 'c1', title: 'T', source: 'S', source_url: 'u', images: [], status: 'researching', created_at: 't', updated_at: 't' });
    // Owner approves:
    await db.update<{ id: string; status: string }>('product_candidates', 'c1', { status: 'approved' });
    expect((db.rows.get('product_candidates')?.[0] as { status: string }).status).toBe('approved');
    // No engine/DB path ever sets 'published' from a candidate:
    const engine = await import('../engine');
    expect(String(engine.runScoutResearch)).not.toContain("status: 'published'");
    expect(String(engine.researchUrl)).not.toContain("status: 'published'");
  });
});

// ---------------------------------------------------------------------------
// Phase 4B — Market Intelligence + Guarded Autonomy
// ---------------------------------------------------------------------------

describe('market intelligence (Phase 4B)', () => {
  const signals = () => [
    {
      id: 's1', signalType: 'search_pattern', source: 'DuckDuckGo', sourceUrl: 'https://html.duckduckgo.com/',
      observedAt: 't', summary: 'Query "dog toys" (USA) surfaced 18 product-page URLs (2 duplicates dropped, 3 non-product pages filtered).',
      confidence: 'verified' as const, limitations: 'Snapshot',
    },
    {
      id: 's2', signalType: 'competition', source: 'DuckDuckGo', sourceUrl: '',
      observedAt: 't', summary: '6 distinct retailer/manufacturer domains appeared for "dog toys" — competitive market.',
      confidence: 'inferred' as const, limitations: 'Rough proxy',
    },
    {
      id: 's3', signalType: 'price_range', source: 'Researched pages', sourceUrl: '',
      observedAt: 't', summary: 'Observed supplier-price range $8.99–$49.99 across 18 products (avg $21.00).',
      confidence: 'verified' as const, limitations: 'Snapshot',
    },
    {
      id: 's4', signalType: 'rating_evidence', source: 'Researched pages', sourceUrl: '',
      observedAt: 't', summary: '12 of 18 researched pages carried rating/review evidence.',
      confidence: 'verified' as const, limitations: 'Own ratings',
    },
    {
      id: 's5', signalType: 'availability', source: 'Researched pages', sourceUrl: '',
      observedAt: 't', summary: '15 of 18 researched pages showed positive availability.',
      confidence: 'verified' as const, limitations: 'Point-in-time',
    },
  ];

  it('normalizes discovery results into durable market signals with statuses', () => {
    const s = signalsFromDiscovery({ query: 'dog toys', market: 'USA', maxResults: 20 }, { query: 'dog toys', rawLinks: [], urls: ['https://a.com/p1', 'https://b.com/p2'], duplicates: 2, filtered: 3 }, 't');
    expect(s.length).toBeGreaterThanOrEqual(2);
    // Phase 4E: search-breadth signal is honest market-supply visibility.
    const pattern = s.find((x) => x.signalType === 'search_breadth');
    expect(pattern?.confidence).toBe('verified');
    expect(pattern?.summary).toContain('2 product-page URLs');
    expect(pattern?.summary).toContain('NOT sales or demand');
    expect(pattern?.limitations.length).toBeGreaterThan(0);
  });

  it('scores market opportunity from signals only (no invention)', () => {
    const r = scoreMarketOpportunity({ signals: signals(), category: 'Dog' });
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.supplyVisibility.points).toBe(30); // 18 URLs — market-supply visibility
    expect(r.breakdown.demand).toBe(r.breakdown.supplyVisibility); // @deprecated compat alias (same criterion)
    expect(r.breakdown.competition.points).toBe(6); // 6 domains = saturated
    expect(r.explanation).toContain('Market opportunity');
  });

  it('gives zero market points when there is no evidence', () => {
    const r = scoreMarketOpportunity({ signals: [], category: null });
    expect(r.score).toBe(0);
  });

  it('computes the final opportunity score with the documented 70/30 formula', () => {
    const f = finalOpportunityScore(80, 60);
    expect(f.productWeight).toBe(0.7);
    expect(f.marketWeight).toBe(0.3);
    expect(f.overall).toBe(Math.round(80 * 0.7 + 60 * 0.3)); // 74
    expect(f.formula).toContain('70%');
  });

  it('validates AI structured output and rejects malformed responses', () => {
    const good = parseMarketAnalysis('{"marketOpportunityScore": 78, "trendConfidence": "inferred", "demandEvidence": "18 URLs surfaced", "competitionLevel": "high", "customerPainPoint": "toys wear out fast", "priceBand": {"min": 8, "max": 50}, "risks": ["x"], "recommendedSearchQueries": ["a"], "reasoningSummary": "evidence only"}');
    expect(good?.marketOpportunityScore).toBe(78);
    expect(good?.competitionLevel).toBe('high');
    const bad = parseMarketAnalysis('not json at all');
    expect(bad).toBeNull();
    const outOfRange = parseMarketAnalysis('{"marketOpportunityScore": 500, "trendConfidence": "madeup", "competitionLevel": "madeup"}');
    expect(outOfRange?.marketOpportunityScore).toBe(100); // clamped
    expect(outOfRange?.trendConfidence).toBe('unknown');
  });

  it('drops unsupported AI claims (evidence grounding) and falls back to deterministic when DeepSeek is missing', async () => {
    const det = { score: 62, explanation: 'deterministic', breakdown: {} };
    // Missing-key path: the injected aiCall throws → deterministic used, aiUsed false.
    const fallback = await runMarketIntelligence({ signals: signals(), category: 'Dog' }, det, async () => { throw new Error('not configured'); });
    expect(fallback.aiUsed).toBe(false);
    expect(fallback.marketOpportunityScore).toBe(62);
    expect(fallback.unsupportedClaims.length).toBeGreaterThan(0);
    // Grounding path: AI proposes a pain point with no evidence → dropped + recorded.
    const grounded = await runMarketIntelligence({ signals: [], category: null }, det, async () => JSON.stringify({ marketOpportunityScore: 90, trendConfidence: 'verified', demandEvidence: 'Big demand', competitionLevel: 'low', customerPainPoint: 'dogs are sad', priceBand: null, risks: [], recommendedSearchQueries: [], reasoningSummary: 'x' }));
    expect(grounded.aiUsed).toBe(true);
    expect(grounded.customerPainPoint).toBeNull(); // dropped — no supporting evidence
    expect(grounded.unsupportedClaims.some((c) => c.includes('customerPainPoint'))).toBe(true);
  });
});

describe('guarded autonomy (Phase 4B)', () => {
  const makeCandidate = (over: Partial<ScoutCandidate>): ScoutCandidate => ({
    id: 'c', title: 'KONG Classic', source: 'KONG', sourceUrl: 'https://www.kongcompany.com/kong-classic/', supplierSlug: 'kong',
    images: ['https://img/1.jpg'],
    evidence: {
      sourceUrl: 'https://www.kongcompany.com/kong-classic/', observedAt: 't',
      title: { status: 'verified', value: 'KONG Classic' },
      supplierPrice: { status: 'verified', value: 11.96 },
      shippingCost: { status: 'inferred', value: 0, note: 'Free shipping' },
      shippingDays: { status: 'verified', value: { min: 3, max: 5 } },
      availability: { status: 'verified', value: 'available' },
      images: { status: 'verified', value: ['https://img/1.jpg'] },
      rating: { status: 'unknown', value: null },
      origin: { status: 'verified', value: 'USA' },
      category: { status: 'inferred', value: 'Dog' },
      sizes: { status: 'verified', value: ['S', 'M', 'L'] },
      unknownFields: [], riskNotes: [],
    },
    margin: { supplierPrice: 11.96, shippingCost: 0, landedCost: 11.96, proposedLuxedgePrice: 29.99, grossMarginDollars: 18.03, grossMarginPct: 0.6, confidence: 'high', notes: [] },
    score: { overall: 80, weights: {}, breakdown: {}, explanation: 'ok' },
    status: 'qualified', createdAt: 't',
    ...over,
  });

  it('MANUAL mode never auto-advances and requires owner', () => {
    const d = evaluateAutonomy({ candidate: makeCandidate({}), marketScore: 70, qa: { candidateId: 'c', title: 'x', passed: true, issues: [] }, config: { ...DEFAULT_AUTONOMY_CONFIG, mode: 'MANUAL' } });
    expect(d.eligibleForAutoPublish).toBe(false);
    expect(d.reason).toContain('MANUAL');
  });

  it('REVIEW mode prepares candidates but requires owner approval', () => {
    const d = evaluateAutonomy({ candidate: makeCandidate({}), marketScore: 70, qa: { candidateId: 'c', title: 'x', passed: true, issues: [] }, config: { ...DEFAULT_AUTONOMY_CONFIG, mode: 'REVIEW' } });
    expect(d.eligibleForAutoPublish).toBe(false);
    expect(d.reason).toContain('owner approval required');
  });

  it('AUTO mode advances only when every gate passes', () => {
    const cfg = { ...DEFAULT_AUTONOMY_CONFIG, mode: 'AUTO' as const };
    const qa = qaCandidate(makeCandidate({}));
    const d = evaluateAutonomy({ candidate: makeCandidate({}), marketScore: 70, qa, config: cfg });
    expect(d.eligibleForAutoPublish).toBe(true);
    expect(Object.values(d.gates).every(Boolean)).toBe(true);
    // A hard gate failure blocks AUTO even with a high market score:
    const rejected = evaluateAutonomy({ candidate: makeCandidate({ status: 'rejected', rejectionReason: 'counterfeit risk' }), marketScore: 95, qa, config: cfg });
    expect(rejected.eligibleForAutoPublish).toBe(false);
    expect(rejected.gates.noHardRejection).toBe(false);
    expect(rejected.needsOwnerAttention).toBe(true);
  });

  it('AUTO never overrides thin margin or low confidence', () => {
    const cfg = { ...DEFAULT_AUTONOMY_CONFIG, mode: 'AUTO' as const };
    const weak = makeCandidate({ margin: { supplierPrice: 20, shippingCost: null, landedCost: null, proposedLuxedgePrice: null, grossMarginDollars: null, grossMarginPct: null, confidence: 'low', notes: [] } });
    const d = evaluateAutonomy({ candidate: weak, marketScore: 90, qa: null, config: cfg });
    expect(d.eligibleForAutoPublish).toBe(false);
    expect(d.gates.marginHigh).toBe(false);
  });

  it('emergency pause is a kill switch even in AUTO', () => {
    const cfg = { ...DEFAULT_AUTONOMY_CONFIG, mode: 'AUTO' as const, emergencyPause: true };
    const d = evaluateAutonomy({ candidate: makeCandidate({}), marketScore: 95, qa: { candidateId: 'c', title: 'x', passed: true, issues: [] }, config: cfg });
    expect(d.eligibleForAutoPublish).toBe(false);
    expect(d.reason).toContain('EMERGENCY PAUSE');
  });

  it('routes meaningful exceptions to the owner attention queue (deduped)', () => {
    const storage = (() => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    })();
    const candidate = makeCandidate({ status: 'rejected', rejectionReason: 'medical claim' });
    const decision = evaluateAutonomy({ candidate, marketScore: null, qa: null, config: { ...DEFAULT_AUTONOMY_CONFIG, mode: 'REVIEW' } });
    const items = attentionForCandidate(candidate, decision, null, null);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.reason.includes('Hard-rejected'))).toBe(true);
    const first = pushAttentionItem(items[0], storage);
    const dup = pushAttentionItem(items[0], storage);
    expect(dup.id).toBe(first.id); // deduped
    expect(loadAttentionItems(storage).length).toBe(1);
    resolveAttentionItem(first.id, storage);
    expect(loadAttentionItems(storage)[0].status).toBe('resolved');
  });

  it('owner attention surfaces high-margin risk and missing market score', () => {
    const candidate = makeCandidate({ margin: { supplierPrice: 5, shippingCost: 1, landedCost: 6, proposedLuxedgePrice: 14.99, grossMarginDollars: 8.99, grossMarginPct: 0.6, confidence: 'high', notes: [] } });
    const items = attentionForCandidate(candidate, { eligibleForAutoPublish: false, reason: 'x', gates: {}, needsOwnerAttention: true }, null, null);
    expect(items.some((i) => i.reason.includes('No market opportunity'))).toBe(true);
    expect(items.some((i) => i.reason.includes('high margin'))).toBe(true);
  });
});

describe('AI cost control (Phase 4B)', () => {
  it('fingerprints evidence deterministically and caches identical evidence', () => {
    clearAiCache();
    expect(evidenceFingerprint(['a', 1, null])).toBe(evidenceFingerprint(['a', 1, null]));
    expect(evidenceFingerprint(['a', 1])).not.toBe(evidenceFingerprint(['a', 2]));
    const key = candidateEvidenceKey({ sourceUrl: 'u', title: 't', evidence: { supplierPrice: { value: 10 }, shippingDays: { value: { min: 3, max: 5 } }, availability: { value: 'available' }, rating: { value: 4.5 } } });
    cachePut(key, 'result');
    expect(cacheGet(key)).toBe('result');
    const same = candidateEvidenceKey({ sourceUrl: 'u', title: 't', evidence: { supplierPrice: { value: 10 }, shippingDays: { value: { min: 3, max: 5 } }, availability: { value: 'available' }, rating: { value: 4.5 } } });
    expect(same).toBe(key);
  });

  it('deterministic prefilter runs before any AI spend', () => {
    const cfg = { productScoreThreshold: 75, maxAiCallsPerRun: 3 } as unknown as AutonomyConfig;
    expect(aiPrefilter({ hardRejected: true, productScore: 90, hasSourceCost: true, config: cfg }).allow).toBe(false);
    expect(aiPrefilter({ hardRejected: false, productScore: 40, hasSourceCost: true, config: cfg }).allow).toBe(false);
    expect(aiPrefilter({ hardRejected: false, productScore: 80, hasSourceCost: false, config: cfg }).allow).toBe(false);
    expect(aiPrefilter({ hardRejected: false, productScore: 80, hasSourceCost: true, config: cfg }).allow).toBe(true);
    const budget = makeAiBudget(2);
    expect(budget.canCall()).toBe(true);
    budget.record();
    budget.record();
    expect(budget.canCall()).toBe(false);
    expect(budget.used()).toBe(2);
  });
});

describe('listing generation + factual QA (Phase 4B)', () => {
  const candidate: ScoutCandidate = {
    id: 'c', title: 'KONG Classic', source: 'KONG Company', sourceUrl: 'https://www.kongcompany.com/kong-classic/', supplierSlug: 'kong',
    images: ['https://img/1.jpg'],
    evidence: {
      sourceUrl: 'https://www.kongcompany.com/kong-classic/', observedAt: 't',
      title: { status: 'verified', value: 'KONG Classic' },
      supplierPrice: { status: 'verified', value: 11.96 },
      shippingCost: { status: 'inferred', value: 0, note: 'Free shipping' },
      shippingDays: { status: 'verified', value: { min: 3, max: 5 } },
      availability: { status: 'verified', value: 'available' },
      images: { status: 'verified', value: ['https://img/1.jpg'] },
      rating: { status: 'unknown', value: null },
      origin: { status: 'verified', value: 'USA' },
      category: { status: 'inferred', value: 'Dog' },
      sizes: { status: 'unknown', value: null },
      unknownFields: ['rating'], riskNotes: [],
    },
    margin: { supplierPrice: 11.96, shippingCost: 0, landedCost: 11.96, proposedLuxedgePrice: 29.99, grossMarginDollars: 18.03, grossMarginPct: 0.6, confidence: 'high', notes: [] },
    score: { overall: 80, weights: {}, breakdown: {}, explanation: 'ok' },
    status: 'approved', createdAt: 't',
  };

  it('classifies listing claims as SUPPORTED / UNSUPPORTED / UNKNOWN', () => {
    const listing = buildDeterministicListing(candidate);
    const qa = qaListing(candidate, listing);
    expect(qa.passed).toBe(true);
    // Unsupported claim must fail QA:
    const fake = { ...listing, features: [...listing.features, 'FDA approved — cures arthritis in dogs'] };
    const bad = qaListing(candidate, fake);
    expect(bad.passed).toBe(false);
    expect(bad.unsupported.some((u) => /fda|medical|certif|cures/i.test(u))).toBe(true);
  });

  it('rejects hallucinated certifications, dimensions, ratings and inventory in listing QA', () => {
    const fake = {
      title: 'KONG Classic', shortDescription: 'Certified organic FDA-approved rubber toy ships within 1-2 days (4.9/5 stars, 50 in stock)',
      longDescription: '', features: [], benefits: [], specifications: {}, seoTitle: '', metaDescription: '', keywords: [], imageAlts: [], faqs: [],
    };
    const qa = qaListing(candidate, fake);
    expect(qa.passed).toBe(false);
    expect(qa.unsupported.length).toBeGreaterThanOrEqual(1); // one claim, flagged as unsupported
    const text = qa.unsupported.join(' ').toLowerCase();
    expect(text).toMatch(/certif|fda|approve/);
    expect(text).toMatch(/days/);
    expect(text).toMatch(/star/);
    expect(text).toMatch(/stock/);
  });

  it('parses AI listing JSON and rejects garbage', () => {
    const ok = parseListingJson('{"title":"X","shortDescription":"d","longDescription":"l","features":["f"],"benefits":[],"specifications":{},"seoTitle":"","metaDescription":"","keywords":[],"imageAlts":[],"faqs":[]}');
    expect(ok?.title).toBe('X');
    expect(parseListingJson('garbage')).toBeNull();
  });

  it('generates a listing via AI and falls back to deterministic when DeepSeek is missing', async () => {
    // Missing key → generateListingDraft returns null (caught) → caller uses deterministic.
    const missing = await generateListingDraft(candidate, async () => { throw new Error('not configured'); });
    expect(missing).toBeNull();
    const det = buildDeterministicListing(candidate);
    expect(det.title).toContain('KONG');
    expect(det.features.length).toBeGreaterThan(0);
    const qa = qaListing(candidate, det);
    expect(qa.passed).toBe(true);
  });

  it('never auto-publishes: the Phase 4B path only ever creates a DRAFT', () => {
    expect(String(runScoutResearch)).not.toContain("'published'");
    expect(String(createProductDraft)).not.toContain("status: 'published'");
    expect(String(buildDeterministicListing)).not.toContain('published');
  });
});

describe('MARKET_INTELLIGENCE job (Phase 4B)', () => {
  it('records a durable MARKET_INTELLIGENCE job with signals/score/ai fallback', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const result = await runMarketIntelligenceJob({
      query: 'dog toys',
      market: 'USA',
      db: db as unknown as DbAdapter,
      discover: async () => ({ query: 'dog toys', rawLinks: [], urls: ['https://a.com/p1', 'https://b.com/p2', 'https://c.com/p3'], duplicates: 0, filtered: 0 }),
      aiCall: async () => { throw new Error('not configured'); },
    });
    expect(result.jobId).toBeTruthy();
    expect(result.signals).toBeGreaterThan(0);
    expect(result.aiUsed).toBe(false);
    const jobs = db.rows.get('agent_jobs') as { type: string; status: string }[];
    expect(jobs.length).toBe(1);
    expect(jobs[0].type).toBe('MARKET_INTELLIGENCE');
    expect(jobs[0].status).toBe('completed');
    const runs = db.rows.get('agent_runs') as { job_id: string }[];
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it('R+T) Phase 4G.1: the normal MI flow collects demand via the wired adapter — max ONE outbound request per job', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    let outboundCalls = 0;
    const adapter: MarketDemandAdapter = {
      provider: 'google-ads',
      getStatus: async () => ({ health: 'configured' }),
      collect: async (q) => {
        outboundCalls++;
        return {
          status: 'success',
          provider: 'google-ads',
          requestedKeywords: q.keywords && q.keywords.length ? q.keywords : [q.query],
          returnedResults: [{
            text: 'dog toys', closeVariants: [], avgMonthlySearches: 8100,
            monthlySearchVolumes: [{ year: 2026, month: 'AUGUST', monthlySearches: 8200 }],
            competition: 'MEDIUM', competitionIndex: 52,
            lowTopOfPageBidUsd: 0.5, highTopOfPageBidUsd: 2.5,
          }],
          keywordsRequested: 1,
          keywordsReturned: 1,
          signals: [],
          errorSafe: null, errorCode: null, requestId: 'req-mi',
          observedAt: '2026-08-18T00:00:00Z',
          avgMonthlySearches: [8100],
          monthlyHistory: [{ keyword: 'dog toys', month: '2026-08', searches: 8200 }],
          competition: ['MEDIUM'], competitionIndex: [52],
          bidRangeUsd: [{ keyword: 'dog toys', low: 0.5, high: 2.5 }],
        };
      },
    };
    const result = await runMarketIntelligenceJob({
      query: 'dog toys',
      market: 'US',
      db: db as unknown as DbAdapter,
      // The ProductScout normal flow passes the server-backed demand adapter;
      // explicit deterministic keywords come from the caller (e.g. CJ-seed
      // concept vocabulary) — never invented by DeepSeek.
      demand: adapter,
      demandKeywords: ['dog toys', 'interactive dog toy'],
      discover: async () => ({ query: 'dog toys', rawLinks: [], urls: [], duplicates: 0, filtered: 0 }),
      aiCall: async () => { throw new Error('not configured'); },
    });
    // Structured facts are PRIMARY on the result (not reverse-parsed summaries).
    expect(result.demand.status).toBe('success');
    expect(result.demand.provider).toBe('google-ads');
    expect(result.demand.keywordsRequested).toBe(1);
    expect(result.demand.keywordsReturned).toBe(1);
    expect(result.demand.requestedKeywords).toEqual(['dog toys', 'interactive dog toy']);
    expect(result.demand.returnedResults[0].text).toBe('dog toys');
    expect(result.demand.returnedResults[0].avgMonthlySearches).toBe(8100);
    expect(result.demand.returnedResults[0].monthlySearchVolumes[0].month).toBe('AUGUST');
    expect(result.demand.requestId).toBe('req-mi');
    // Exactly ONE outbound collect() for the whole MI job execution.
    expect(outboundCalls).toBe(1);
    // Persisted on the durable job output.
    const job = (db.rows.get('agent_jobs') as Record<string, unknown>[]).find((j) => j.type === 'MARKET_INTELLIGENCE');
    expect(job?.output as Record<string, unknown>).toMatchObject({
      demandProvider: 'google-ads',
      demandStatus: 'success',
      keywordsRequested: 1,
      keywordsReturned: 1,
    });
  });

  it('Phase 4G.1: MI with no demand adapter → status not_configured, zero outbound calls, no crash', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const result = await runMarketIntelligenceJob({
      query: 'dog toys',
      market: 'US',
      db: db as unknown as DbAdapter,
      discover: async () => ({ query: 'dog toys', rawLinks: [], urls: [], duplicates: 0, filtered: 0 }),
      aiCall: async () => { throw new Error('not configured'); },
    });
    expect(result.demand.status).toBe('not_configured');
    expect(result.demand.keywordsRequested).toBe(0);
    expect(result.signals).toBeGreaterThanOrEqual(0);
  });
});
