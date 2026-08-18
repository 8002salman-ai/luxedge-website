// ============================================================================
// LUXEDGE V2 — PHASE 4E.2 RETAIL NAVIGATION DISCOVERY TESTS
//
// A retailer listing/search/category page is a NAVIGATION SOURCE ONLY: it is
// never market/product evidence itself. Tests cover: listing pages can never
// count as product evidence (E), per-retailer PDP extraction (F/G/H), dedupe
// (I), per-retailer caps (J), invalid/category URL rejection after extraction
// (K), and the engine failing closed (DeepSeek calls = 0) when the evidence
// pack stays insufficient even with navigation (L).
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../../../services/db';
import type { FetchedSourcePage } from '../types';
import {
  extractNavigationPdpUrls, FetchingRetailNavigationAdapter,
  MAX_NAV_PDP_PER_RETAILER, MAX_NAV_LISTING_SOURCES,
} from '../retailNavigation';
import { selectEvidencePagesDetailed, validateExactProduct } from '../marketEvidence';
import { extractPageFacts } from '../extract';
import { runMarketIntelligenceJob } from '../engine';
import { DuckDuckGoRetailDiscoveryAdapter, type RetailEvidenceSearchResult } from '../retailDiscovery';

// ---------------------------------------------------------------------------
// Minimal admin-JWT fake db (mirrors the Phase 4D test pattern)
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

/** Jina-reader-style text of a retailer LISTING page (markdown links). */
function listingText(links: string[]): string {
  return [
    'Shop Dog Travel Accessories',
    'Results for "dog travel accessories"',
    ...links.map((u, i) => `[Product ${i + 1}](${u})`),
    'Sign in to track your order',
  ].join('\n');
}

const CHEWY_PDP_A = 'https://www.chewy.com/dog-travel-bag-xyz/dp/123456789';
const CHEWY_PDP_B = 'https://www.chewy.com/dog-water-bottle/dp/987654321';
const TARGET_PDP_A = 'https://www.target.com/p/travel-bag-xyz/-/A-91561719';
const TARGET_PDP_B = 'https://www.target.com/p/pet-carrier/-/A-11223344';
const WALMART_PDP_A = 'https://www.walmart.com/ip/Dog-Travel-Bag/12345678';
const WALMART_PDP_B = 'https://www.walmart.com/ip/Portable-Water-Bottle/87654321';

describe('retailNavigation — listing pages as NAVIGATION sources only', () => {
  it('E) a listing page can never count as product evidence itself (and its URL is never returned as a PDP)', () => {
    const listingUrl = 'https://www.chewy.com/b/dog-travel_c369';
    const res = extractNavigationPdpUrls(listingText([CHEWY_PDP_A]), listingUrl);
    expect(res.pdpUrls).toEqual([CHEWY_PDP_A]);
    expect(res.pdpUrls).not.toContain(listingUrl); // the listing URL itself is NOT a PDP
    // Content-level: a listing page extract (title + a price-like line, no real
    // product signals) is NOT usable exact-product evidence.
    const listingExtract = extractPageFacts({
      text: `Dog Travel Accessories\n$19.99\nShowing 24 products`,
      images: [],
    });
    expect(validateExactProduct(listingExtract).usable).toBe(false);
  });

  it('F) Chewy listing → exact /dp/ PDP links extracted', () => {
    const res = extractNavigationPdpUrls(listingText([CHEWY_PDP_A, CHEWY_PDP_B]), 'https://www.chewy.com/b/dog-travel_c369');
    expect(res.pdpUrls).toEqual([CHEWY_PDP_A, CHEWY_PDP_B]);
  });

  it('G) Target listing → exact /p/…/A- PDP links extracted', () => {
    const res = extractNavigationPdpUrls(listingText([TARGET_PDP_A, TARGET_PDP_B]), 'https://www.target.com/c/dog-travel/-/N-5xt3f');
    expect(res.pdpUrls).toEqual([TARGET_PDP_A, TARGET_PDP_B]);
  });

  it('H) Walmart listing → exact /ip/ PDP links extracted', () => {
    const res = extractNavigationPdpUrls(listingText([WALMART_PDP_A, WALMART_PDP_B]), 'https://www.walmart.com/c/kp/dog-travel-accessories');
    expect(res.pdpUrls).toEqual([WALMART_PDP_A, WALMART_PDP_B]);
  });

  it('I) duplicate PDP links are deduped (canonical host+path)', () => {
    const res = extractNavigationPdpUrls(
      listingText([CHEWY_PDP_A, `${CHEWY_PDP_A}?utm_source=x`, 'https://www.chewy.com/dog-travel-bag-xyz/dp/123456789']),
      'https://www.chewy.com/b/dog-travel_c369'
    );
    expect(res.pdpUrls).toEqual([CHEWY_PDP_A]);
  });

  it('K) invalid/category/search URLs inside a listing are rejected after extraction, not returned as PDPs', () => {
    const res = extractNavigationPdpUrls(
      listingText([CHEWY_PDP_A, 'https://www.chewy.com/b/toys-315', 'https://www.chewy.com/f/dog-carriers_c371', 'https://www.chewy.com/account/login']),
      'https://www.chewy.com/b/dog-travel_c369'
    );
    expect(res.pdpUrls).toEqual([CHEWY_PDP_A]);
    const reasons = res.rejected.map((r) => r.url);
    expect(reasons).toContain('https://www.chewy.com/b/toys-315');
    expect(reasons).toContain('https://www.chewy.com/account/login');
  });

  it('off-domain links are never accepted (site-restricted)', () => {
    const res = extractNavigationPdpUrls(
      listingText(['https://www.amazon.com/dp/B0TEST', TARGET_PDP_A]),
      'https://www.target.com/c/dog-travel/-/N-5xt3f'
    );
    expect(res.pdpUrls).toEqual([TARGET_PDP_A]);
    expect(res.rejected.some((r) => r.reason === 'off-domain link')).toBe(true);
  });

  it('J) engine merge path caps at 2 PDPs per retailer and 8 total (round-robin)', () => {
    const urls = [
      CHEWY_PDP_A, CHEWY_PDP_B,
      'https://www.chewy.com/third-toy/dp/333',
      'https://www.chewy.com/fourth-toy/dp/444',
      TARGET_PDP_A, TARGET_PDP_B, 'https://www.target.com/p/x/-/A-555',
      WALMART_PDP_A, WALMART_PDP_B,
    ];
    const sel = selectEvidencePagesDetailed(urls, 8, MAX_NAV_PDP_PER_RETAILER);
    const perDomain: Record<string, number> = {};
    for (const u of sel.selected) {
      const d = new URL(u).hostname.replace(/^www\./, '').split('.')[0];
      perDomain[d] = (perDomain[d] ?? 0) + 1;
    }
    expect(sel.selected.length).toBeLessThanOrEqual(8);
    expect(perDomain.chewy).toBeLessThanOrEqual(2);
    expect(perDomain.target).toBeLessThanOrEqual(2);
    expect(perDomain.walmart).toBeLessThanOrEqual(2);
    // Domain diversity: at least chewy + target + walmart present when possible.
    expect(Object.keys(perDomain).length).toBeGreaterThanOrEqual(3);
  });

  it('FetchingRetailNavigationAdapter: failed listing fetch → rejection, never a crash; no PDPs claimed', async () => {
    const nav = new FetchingRetailNavigationAdapter(async () => { throw new Error('429 rate limited'); });
    const res = await nav.discoverProductLinks({ sourceUrl: 'https://www.chewy.com/b/dog-travel_c369' });
    expect(res.pdpUrls).toEqual([]);
    expect(res.rejected[0]?.reason).toContain('listing fetch failed');
  });

  it('FetchingRetailNavigationAdapter extracts + caps PDPs from a real fetched listing page', async () => {
    const nav = new FetchingRetailNavigationAdapter(async (): Promise<FetchedSourcePage> => ({
      text: listingText([CHEWY_PDP_A, CHEWY_PDP_B, 'https://www.chewy.com/b/toys-315']),
      images: [],
    }));
    const res = await nav.discoverProductLinks({ sourceUrl: 'https://www.chewy.com/b/dog-travel_c369', maxLinks: 8 });
    expect(res.pdpUrls).toEqual([CHEWY_PDP_A, CHEWY_PDP_B]);
  });
});

describe('retail navigation — engine integration + fail-closed gate (Phase 4E.2 §13/§15-L)', () => {
  it('listing sources are surfaced by the DuckDuckGo retail adapter (≤3, diverse domains)', async () => {
    const raw = [
      '<a href="https://www.chewy.com/b/dog-travel_c369">Chewy listing</a>',
      `<a href="${CHEWY_PDP_A}">Chewy product</a>`,
      '<a href="https://www.target.com/c/dog-travel/-/N-5xt3f">Target listing</a>',
      `<a href="${TARGET_PDP_A}">Target product</a>`,
      '<a href="https://www.walmart.com/c/kp/dog-travel">Walmart listing</a>',
      `<a href="${WALMART_PDP_A}">Walmart product</a>`,
    ].join('\n');
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(async () => raw);
    const res: RetailEvidenceSearchResult = await adapter.searchExactProducts({ query: 'dog travel accessories', domains: ['chewy.com', 'target.com', 'walmart.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(res.candidates.length).toBeGreaterThanOrEqual(3); // the PDPs
    expect(res.listingSources.length).toBeGreaterThanOrEqual(1);
    expect(res.listingSources.length).toBeLessThanOrEqual(MAX_NAV_LISTING_SOURCES);
    const listingDomains = new Set(res.listingSources.map((l) => l.domain));
    // Diverse: at least two different retailer listing sources when available.
    expect(listingDomains.size).toBeGreaterThanOrEqual(2);
  });

  it('L) thin pack (1 usable page) fed via listing→PDP navigation → DeepSeek calls = 0 (gate invariant)', async () => {
    const db = new FakeDb();
    db.token = adminToken();
    const aiCall = vi.fn(async () => { throw new Error('should never be called'); });
    // Use the generic discovery path with a fetchPage: 1 listing + 1 PDP only.
    const fetchPage = vi.fn(async (url: string): Promise<FetchedSourcePage> => {
      if (url.includes('listing')) return { text: listingText([CHEWY_PDP_A]), images: [] };
      return { text: `Chewy Travel Bag\nPrice: $24.99\nIn Stock\n4.5 out of 5 stars`, images: ['https://img.test/1.jpg'] };
    });
    const result = await runMarketIntelligenceJob({
      query: 'dog travel accessories',
      market: 'US',
      db,
      discover: async () => ({ query: 'dog travel accessories', rawLinks: [], urls: ['https://www.chewy.com/b/dog-travel_c369'], duplicates: 0, filtered: 0 }),
      fetchPage,
      aiCall,
    });
    expect(result.evidence.evidenceQuality).toBe('insufficient');
    expect(aiCall).not.toHaveBeenCalled();
    expect(result.aiUsed).toBe(false);
    expect(result.marketScore).toBeNull();
  });
});
