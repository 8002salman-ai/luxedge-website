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
import { runScoutResearch, qaCandidate } from '../engine';
import { persistCandidate, persistScore, ensureSupplier, createProductDraft } from '../persist';
import { decodeRedirectUrl, extractLinks, isLikelyProductPage, cleanUrl, dedupeUrls, buildSearchUrl, discoverUrls } from '../discover';
import type { FetchedSourcePage, ScoutCandidate } from '../types';

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
  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    this.assertAdmin();
    const list = this.rows.get(table) || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    this.updates.push({ table, id, patch: { ...patch } });
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
