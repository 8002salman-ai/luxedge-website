// ============================================================================
// LUXEDGE V2 — PHASE 4E RETAIL EVIDENCE DISCOVERY TESTS
//
// Covers: verified single-product URL patterns (recorded, never sufficient on
// their own), site-restricted search caps (one request per domain, per-domain
// and total limits), and rejection of category/search/browse/listicle URLs on
// the target domain.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  DuckDuckGoRetailDiscoveryAdapter, retailProductUrlPattern,
  type RetailEvidenceSearchResult,
} from '../retailDiscovery';

function md(links: string[]): string {
  return links.map((u, i) => `[result ${i}](${u})`).join('\n');
}

describe('retailProductUrlPattern (Phase 4E)', () => {
  it('records the verified single-product patterns honestly', () => {
    expect(retailProductUrlPattern('https://www.chewy.com/kong-classic/dp/123456').matched).toBe(true);
    expect(retailProductUrlPattern('https://www.target.com/p/dog-toy/-/A-12345678').matched).toBe(true);
    expect(retailProductUrlPattern('https://www.walmart.com/ip/Dog-Toy/987654321').matched).toBe(true);
  });

  it('does NOT claim a pattern for browse/search URLs (pattern alone is never sufficient)', () => {
    expect(retailProductUrlPattern('https://www.chewy.com/b/toys-315').matched).toBe(false);
    expect(retailProductUrlPattern('https://www.target.com/c/dog-toys-supplies-pets/-/N-5xt3f').matched).toBe(false);
    expect(retailProductUrlPattern('https://www.walmart.com/browse/pet/dog-toys').matched).toBe(false);
  });
});

describe('DuckDuckGoRetailDiscoveryAdapter (Phase 4E)', () => {
  it('caps total searches and results — one request per domain, maxPerDomain + maxTotal enforced (test G)', async () => {
    const fetchRaw = vi.fn(async (url: string) => {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      const domain = q.split(' ')[0].replace('site:', '');
      // Domain-appropriate exact-product URLs so strict pattern mode keeps them.
      if (domain === 'chewy.com') {
        return md(['https://www.chewy.com/a/dp/1', 'https://www.chewy.com/b/dp/2', 'https://www.chewy.com/c/dp/3']);
      }
      if (domain === 'target.com') {
        return md(['https://www.target.com/p/a/-/A-1', 'https://www.target.com/p/b/-/A-2', 'https://www.target.com/p/c/-/A-3']);
      }
      return md(['https://www.walmart.com/ip/a/1', 'https://www.walmart.com/ip/b/2', 'https://www.walmart.com/ip/c/3']);
    });
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(fetchRaw as unknown as (url: string) => Promise<string>, () => 't');
    const r = await adapter.searchExactProducts({ query: 'dog toys', domains: ['chewy.com', 'target.com', 'walmart.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(fetchRaw).toHaveBeenCalledTimes(3);   // one search per domain — no dozens of requests
    expect(r.searchRequests).toBe(3);
    expect(r.candidates.length).toBeLessThanOrEqual(8); // total cap
    expect(r.candidates.length).toBe(6);                 // 2 per domain × 3 domains
  });

  it('keeps only exact product URLs on the target domain — browse/category/wrong-domain dropped (test H)', async () => {
    const fetchRaw = vi.fn(async () => md([
      'https://www.chewy.com/b/toys-315',               // browse — must drop
      'https://www.chewy.com/category/dog-toys',        // category — must drop
      'https://www.chewy.com/kong-classic/dp/123456',   // exact product — keep
      'https://www.target.com/p/other/-/A-1',           // wrong domain — drop
    ]));
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(fetchRaw as unknown as (url: string) => Promise<string>, () => 't');
    const r = await adapter.searchExactProducts({ query: 'dog toys', domains: ['chewy.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(r.candidates.map((c) => c.url)).toEqual(['https://www.chewy.com/kong-classic/dp/123456']);
    expect(r.candidates[0].productUrlPatternMatched).toBe(true);
    expect(r.candidates[0].confidence).toBe('inferred'); // URL-level only; content validated later
  });

  it('strict pattern mode: only verified single-product URLs for chewy/target/walmart (Phase 4E live finding)', async () => {
    const fetchRaw = vi.fn(async () => {
      return 'DuckDuckGo search results for dog travel\n\n' + md([
        'https://www.chewy.com/deals/dog-travel-accessories-and-gear-3419374', // deals page — drop
        'https://www.chewy.com/f/mobile-dog-gear-dog-carriers-travel_c371_f1v262866', // filter page — drop
        'https://www.chewy.com/kong-classic/dp/123456',                          // exact product — keep
        'https://www.walmart.com/c/kp/dog-travel-accessories',                   // category — drop
      ]);
    });
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(fetchRaw as unknown as (url: string) => Promise<string>, () => 't');
    const r = await adapter.searchExactProducts({ query: 'dog travel accessories', domains: ['chewy.com', 'walmart.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(r.candidates.map((c) => c.url)).toEqual(['https://www.chewy.com/kong-classic/dp/123456']);
    expect(r.rejected.map((x) => x.url)).toEqual([
      'https://www.chewy.com/deals/dog-travel-accessories-and-gear-3419374',
      'https://www.chewy.com/f/mobile-dog-gear-dog-carriers-travel_c371_f1v262866',
      'https://www.walmart.com/c/kp/dog-travel-accessories',
    ]);
  });

  it('records searchRequests / domainsAttempted / domainsWithResults honestly (some domains may fail)', async () => {
    const fetchRaw = vi.fn(async (url: string) => {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      if (q.includes('site:chewy.com')) {
        return 'DuckDuckGo search results for dog toys\n\n' + md(['https://www.chewy.com/x/dp/1', 'https://www.chewy.com/y/dp/2']);
      }
      throw new Error('unreachable'); // target + walmart fail
    });
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(fetchRaw as unknown as (url: string) => Promise<string>, () => 't');
    const r = await adapter.searchExactProducts({ query: 'dog toys', domains: ['chewy.com', 'target.com', 'walmart.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(r.searchRequests).toBe(3);
    expect(r.domainsAttempted).toEqual(['chewy.com', 'target.com', 'walmart.com']);
    expect(r.domainsWithResults).toEqual(['chewy.com']);
    expect(r.warning).toContain('target.com');
    expect(r.candidates.length).toBe(2); // both Chewy exact-product links
  });

  it('does not fabricate candidates when no domain returns results', async () => {
    const fetchRaw = vi.fn(async () => { throw new Error('unreachable'); });
    const adapter = new DuckDuckGoRetailDiscoveryAdapter(fetchRaw as unknown as (url: string) => Promise<string>, () => 't');
    const r: RetailEvidenceSearchResult = await adapter.searchExactProducts({ query: 'dog toys', domains: ['chewy.com', 'target.com'], maxPerDomain: 2, maxTotal: 8 });
    expect(r.candidates).toHaveLength(0);
    expect(r.domainsWithResults).toHaveLength(0);
    expect(r.warning).toContain('chewy.com');
  });
});
