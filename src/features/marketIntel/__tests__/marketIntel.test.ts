// ============================================================================
// LUXEDGE — PRODUCT MARKET INTELLIGENCE ENGINE TESTS
//
// Honesty invariants: missing data never becomes a fake positive; confidence
// is separate from opportunity; no paid tool is ever required.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { trendDirectionFromPoints, trendScore, officialTrendsStatus, hermesTrendsTask } from '../trend';
import { ebayScores, parseEbaySearchPage } from '../ebay';
import { parseAmazonPublicPage, amazonOpportunityStatus, bsrVelocity } from '../amazon';
import { landedCost, profitEconomics } from '../supplier';
import { opportunityScore, verdictFrom } from '../score';
import { familyKey, mergeTrending } from '../trending';
import { researchKeyword, resetResearchCache } from '../research';

describe('trendDirectionFromPoints + trendScore (honesty)', () => {
  it('returns INSUFFICIENT_DATA / null when no data exists — never a fake positive', () => {
    expect(trendDirectionFromPoints(null, null, null, null)).toBe('INSUFFICIENT_DATA');
    expect(trendScore({ direction: 'INSUFFICIENT_DATA' })).toBeNull();
  });

  it('classifies strongly rising vs declining', () => {
    expect(trendDirectionFromPoints(70, 60, 50, 45)).toBe('STRONGLY_RISING');
    expect(trendDirectionFromPoints(-60, -50, -40, -30)).toBe('DECLINING');
  });

  it('scores rising queries higher but caps at 100', () => {
    const a = trendScore({ direction: 'RISING', risingQueries: ['a', 'b', 'c'], usRelevant: true });
    const b = trendScore({ direction: 'RISING' });
    expect(a !== null && b !== null).toBe(true);
    expect(a!).toBeGreaterThan(b!);
    expect(a!).toBeLessThanOrEqual(100);
  });

  it('official API is NOT_CONFIGURED unless proven — never faked availability', () => {
    expect(officialTrendsStatus()).toBe('NOT_CONFIGURED');
    expect(officialTrendsStatus({ officialApiEnabled: true })).toBe('NOT_CONFIGURED');
  });

  it('hermes browser task is a queued, non-blocking payload', () => {
    const t = hermesTrendsTask('dog poop scooper');
    expect(t.intent).toBe('google_trends_browser');
    expect(t.provider).toBe('hermes');
    expect(t.country).toBe('US');
    expect(t.periods).toContain('12 months');
  });
});

describe('ebayScores + parseEbaySearchPage', () => {
  it('parses visible sold/watchers/results from a search page', () => {
    const text = 'About 1,234 results for dog toy\n 56 sold\n 12 watchers\n $14.99';
    const p = parseEbaySearchPage(text);
    expect(p.activeListings).toBe(1234);
    expect(p.soldQuantity).toBe(56);
    expect(p.watchers).toBe(12);
    expect(p.priceRange?.min).toBe(14.99);
  });

  it('missing signals → null demand score (no fake positive)', () => {
    const s = ebayScores({ status: 'AVAILABLE', activeListings: null, soldQuantity: null, watchers: null });
    expect(s.demandScore).toBeNull();
    expect(s.competitionScore).toBeNull();
  });

  it('healthy sold + watchers → high demand, listings density → competition', () => {
    const s = ebayScores({ status: 'AVAILABLE', soldQuantity: 500, watchers: 100, activeListings: 80, competitorCount: 12 });
    expect(s.demandScore).not.toBeNull();
    expect(s.demandScore!).toBeGreaterThan(50);
    expect(s.competitionScore!).toBeGreaterThan(50);
  });
});

describe('parseAmazonPublicPage + opportunity status', () => {
  it('parses BSR, price range, rating, reviews from PDP text', () => {
    const p = parseAmazonPublicPage('#1,234 in Pet Supplies\n$24.99 - $34.99\n4.6 out of 5 stars\n1,200 ratings', 'https://amazon.com/dp/x');
    expect(p.bestSellersRank).toBe(1234);
    expect(p.category).toBe('Pet Supplies');
    expect(p.priceRange?.min).toBe(24.99);
    expect(p.rating).toBe(4.6);
    expect(p.reviewCount).toBe(1200);
  });

  it('opportunity explorer needs an authorized session', () => {
    expect(amazonOpportunityStatus(false)).toBe('LOGIN_REQUIRED');
    expect(amazonOpportunityStatus(true)).toBe('AVAILABLE');
  });

  it('BSR velocity is directional', () => {
    expect(bsrVelocity(1000)).toBe('rising');
    expect(bsrVelocity(15000)).toBe('stable');
    expect(bsrVelocity(90000)).toBe('declining');
    expect(bsrVelocity(null)).toBeNull();
  });
});

describe('supplier economics', () => {
  it('landed cost requires both unit + shipping', () => {
    expect(landedCost({ unitCost: 10, shippingCost: 2 })).toBe(12);
    expect(landedCost({ unitCost: null, shippingCost: 2 })).toBeNull();
  });

  it('profit economics are deterministic', () => {
    const e = profitEconomics({ unitCost: 4, shippingCost: 1 });
    expect(e.landedCost).toBe(5);
    expect(e.targetSellingPrice).toBe(12.5);
    expect(e.expectedNetProfit).toBe(7.5);
    expect(e.marginPct).toBe(60);
    expect(e.roiPct).toBe(150);
  });
});

describe('opportunityScore + confidence (separate, honest)', () => {
  const strong = () => ({
    trendDirection: 'STRONGLY_RISING' as const,
    risingQueries: ['a', 'b'],
    relatedQueries: ['x'],
    usRelevant: true,
    amazonDemand: { volume: 5000, bsrVelocity: 'rising' as const, reviews: 300 },
    ebay: { soldQuantity: 800, watchers: 200, activeListings: 60, competitorCount: 8, avgSoldPrice: 20 },
    supplierAvailable: true,
    economics: profitEconomics({ unitCost: 4, shippingCost: 1 }),
    shippingSimple: true,
    ipSafe: true,
  });

  it('full-coverage strong input scores high with high confidence', () => {
    const { score, confidence, breakdown } = opportunityScore(strong());
    expect(score).toBeGreaterThan(70);
    expect(confidence).toBe(100);
    expect(breakdown.max).toBe(100);
  });

  it('missing data → LOWER confidence, never auto-full points', () => {
    const weak = {
      ...strong(),
      trendDirection: 'INSUFFICIENT_DATA' as const,
      risingQueries: [] as string[],
      relatedQueries: [] as string[],
      amazonDemand: { volume: null, bsrVelocity: null, reviews: null },
      ebay: { soldQuantity: null, watchers: null, activeListings: null, competitorCount: null, avgSoldPrice: null },
      supplierAvailable: false,
      economics: profitEconomics({ unitCost: null, shippingCost: null }),
      shippingSimple: null,
      ipSafe: null,
    };
    const { score, confidence } = opportunityScore(weak);
    expect(confidence).toBe(0); // zero evidence coverage
    expect(score).toBe(0);       // no fake positive
  });

  it('a high score with low confidence is NOT treated as stronger (91/42 vs 86/91)', () => {
    const full = opportunityScore(strong());
    const lowConf = opportunityScore({
      ...strong(),
      amazonDemand: { volume: null, bsrVelocity: null, reviews: null },
      shippingSimple: null,
      ipSafe: null,
    });
    expect(full.confidence).toBe(100);
    expect(lowConf.confidence).toBeLessThan(full.confidence);
    // Confidence and score are separate axes.
    expect(lowConf.confidence).not.toBe(lowConf.score);
  });
});

describe('verdict', () => {
  it('STRONG BUY with test quantity + investment', () => {
    const v = verdictFrom(80, 90, profitEconomics({ unitCost: 4, shippingCost: 1 }));
    expect(v.verdict).toBe('STRONG BUY');
    expect(v.recommendedTestQuantity).toBe(25);
    expect(v.expectedInvestment).toBe(125);
  });

  it('low confidence forces WATCH regardless of score', () => {
    expect(verdictFrom(90, 20, profitEconomics({ unitCost: 4, shippingCost: 1 })).verdict).toBe('WATCH');
  });

  it('thin margin → SKIP', () => {
    const thin = { landedCost: 10, targetSellingPrice: 11, expectedNetProfit: 1, marginPct: 9, roiPct: 10 };
    expect(verdictFrom(60, 80, thin).verdict).toBe('SKIP');
  });
});

describe('trending merge/dedupe', () => {
  it('merges same-family keywords, keeps different items separate', () => {
    const merged = mergeTrending([
      { keyword: 'dog grooming vacuum', source: 'trends' },
      { keyword: 'pet grooming vacuum cleaner', source: 'amazon' },
      { keyword: 'cat water fountain', source: 'ebay' },
    ]);
    expect(merged.length).toBe(2);
    const groom = merged.find((m) => m.keyword === 'dog grooming vacuum')!;
    expect(groom.aliases).toContain('pet grooming vacuum cleaner');
    expect(groom.sources).toEqual(expect.arrayContaining(['trends', 'amazon']));
  });

  it('familyKey is stable regardless of token order', () => {
    expect(familyKey('dog grooming vacuum')).toBe(familyKey('vacuum grooming dog'));
  });
});

describe('researchKeyword — resilience pipeline', () => {
  beforeEach(() => resetResearchCache());

  const jsonPage = (text: string) => JSON.stringify({ text, images: [] });

  it('unwraps the JSON page envelope before parsing (fetch-fix: parsers get plain text)', async () => {
    const calls: string[] = [];
    const out = await researchKeyword('dog toy', {
      fetchPage: async (url) => {
        calls.push(url);
        return url.includes('ebay')
          ? jsonPage('About 1,234 results for dog toy\n 56 sold\n 12 watchers\n $14.99')
          : jsonPage('#1,234 in Pet Supplies\n$24.99 - $34.99\n4.6 out of 5 stars\n1,200 ratings');
      },
      pacingMs: 1,
    });
    expect(calls.length).toBe(2);
    expect(out.result.provenance.ebay.status).toBe('AVAILABLE');
    expect(out.result.provenance.ebay.activeListings).toBe(1234);
    expect(out.result.provenance.ebay.soldQuantity).toBe(56);
    expect(out.result.provenance.amazonPublic.status).toBe('AVAILABLE');
    expect(out.result.provenance.amazonPublic.bestSellersRank).toBe(1234);
    // Supplier economics derived from the visible eBay price range midpoint.
    expect(out.result.economics.landedCost).not.toBeNull();
    expect(out.result.confidence).toBeGreaterThan(0);
  });

  it('all live sources failing still completes the score pipeline and queues a Hermes trends job', async () => {
    const queued: Record<string, unknown>[] = [];
    const out = await researchKeyword('dog poop scooper', {
      fetchPage: async () => { throw new Error('blocked'); },
      queueHermes: async (payload) => { queued.push(payload); return 'job-1'; },
      pacingMs: 1,
    });
    expect(queued.length).toBe(1);
    expect(queued[0].intent).toBe('google_trends_browser');
    expect(queued[0].keyword).toBe('dog poop scooper');
    expect(out.hermesQueued).toBe(true);
    // The job completed with honest PARTIAL data — it did NOT stop.
    expect(out.result.partial).toBe(true);
    expect(out.result.opportunityScore).toBe(0);
    expect(out.result.confidence).toBe(0);
    expect(out.result.verdict.verdict).toBe('WATCH');
    expect(out.result.provenance.ebay.status).toBe('FAILED');
    expect(out.result.provenance.amazonPublic.status).toBe('FAILED');
    expect(out.result.provenance.supplier.status).toBe('NOT_CONFIGURED');
  });

  it('second research of the same keyword within TTL hits the cache — zero re-fetches', async () => {
    let fetches = 0;
    const deps = {
      fetchPage: async () => { fetches++; return jsonPage('About 100 results'); },
      queueHermes: async () => 'job-x',
      pacingMs: 1,
    };
    const first = await researchKeyword('dog bowl', deps);
    expect(fetches).toBe(2); // eBay + Amazon
    const second = await researchKeyword('  DOG BOWL  ', deps); // normalized same key
    expect(fetches).toBe(2); // cache hit — no additional fetches
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.result).toEqual(first.result);
    expect(second.hermesQueued).toBe(first.hermesQueued);
  });

  it('Hermes queue failure never stops the research job', async () => {
    const out = await researchKeyword('cat water fountain', {
      fetchPage: async () => { throw new Error('blocked'); },
      queueHermes: async () => { throw new Error('db down'); },
      pacingMs: 1,
    });
    expect(out.hermesQueued).toBe(false);
    expect(out.result.opportunityScore).toBe(0);
    expect(out.result.partial).toBe(true);
  });

  it('rejects an empty keyword at the boundary', async () => {
    await expect(researchKeyword('   ', { fetchPage: async () => '' })).rejects.toThrow(/keyword/);
  });
});
