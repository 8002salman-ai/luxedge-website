// ============================================================================
// LUXEDGE — HERMES INTELLIGENCE TESTS
//
// Covers: strict ingest validation, research-only security posture, Luxedge's
// own scoring, ads-readiness economics, row building, and repository CRUD on
// the local adapter (offline resilience — Hermes offline never breaks Luxedge).
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTests, __setDbConfigForTests } from '../../../services/db';
import { parseIngestBody, flagSuspiciousContent, sanitizeText, sanitizeUrl, sanitizeNumber } from '../ingest';
import { scoreHermesRecommendation, marginFrom, scoreBand, recommendationRowToInput } from '../score';
import { computeAdsReadiness } from '../adsReadiness';
import { productInputToRow, seoInputToRow, marketingInputToRow, adsReadinessToRow } from '../rows';
import {
  insertRecommendation, listRecommendations, updateRecommendation, deleteRecommendation,
  insertSeoSuggestion, listSeoSuggestions, updateSeoSuggestion, deleteSeoSuggestion,
  insertMarketingIntel, listMarketingIntel,
  insertAdsReadiness, listAdsReadiness,
} from '../repository';

function reset() {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
  resetDbForTests();
  __setDbConfigForTests(null); // local adapter — offline mode
}

const validProduct = {
  kind: 'product',
  data: {
    productName: 'Elevated Dog Ramp for Cars',
    category: 'Dog Travel',
    supplier: 'CJ',
    supplierPrice: 18.5,
    expectedSellingPrice: 39.99,
    sourceUrl: 'https://example.com/ramp',
    benefits: 'Foldable, non-slip surface.',
    risks: 'Bulky for small cars.',
    confidence: 0.7,
  },
};

describe('ingest validation', () => {
  it('accepts a valid product suggestion and normalizes it', () => {
    const r = parseIngestBody(validProduct);
    expect(r.ok).toBe(true);
    expect(r.input?.kind).toBe('product');
    const d = r.input!.data as { productName: string; currency?: string };
    expect(d.productName).toBe('Elevated Dog Ramp for Cars');
    expect(d.currency).toBe('USD');
  });

  it('rejects a missing productName', () => {
    const r = parseIngestBody({ kind: 'product', data: { supplierPrice: 5 } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/productName is required/);
  });

  it('rejects a malformed currency', () => {
    const r = parseIngestBody({ kind: 'product', data: { productName: 'X', currency: 'US Dollars' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/currency/);
  });

  it('rejects an unknown kind', () => {
    const r = parseIngestBody({ kind: 'spaceship', data: {} });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(parseIngestBody('hello').ok).toBe(false);
    expect(parseIngestBody(null).ok).toBe(false);
  });

  it('drops unknown fields (whitelist only)', () => {
    const r = parseIngestBody({ kind: 'product', data: { ...validProduct.data, evilField: 'x', __proto__: { polluted: 1 } } });
    expect(r.ok).toBe(true);
    const d = r.input!.data as unknown as Record<string, unknown>;
    expect('evilField' in d).toBe(false);
  });

  it('caps long text and strips control characters', () => {
    const long = 'A'.repeat(5000);
    const r = parseIngestBody({ kind: 'product', data: { productName: long } });
    expect(r.ok).toBe(true); // accepted but capped — never stored unbounded
    const d = r.input!.data as unknown as { productName: string };
    expect(d.productName.length).toBeLessThanOrEqual(300);
    expect(sanitizeText('bad\u0007text', 'productName')).toBe('badtext');
  });

  it('sanitizes URLs to http(s) with a host only', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('ftp://x.com/a')).toBeNull();
    expect(sanitizeUrl('not a url')).toBeNull();
    expect(sanitizeUrl('https://example.com/p')).toBe('https://example.com/p');
  });

  it('sanitizes numbers: finite + in-range', () => {
    expect(sanitizeNumber(NaN)).toBeNull();
    expect(sanitizeNumber(Infinity)).toBeNull();
    expect(sanitizeNumber(99, 0, 5)).toBeNull();
    expect(sanitizeNumber('12.5')).toBe(12.5);
  });

  it('parses an SEO suggestion with defaults', () => {
    const r = parseIngestBody({ kind: 'seo', data: { recommendation: 'Add topic cluster for dog travel' } });
    expect(r.ok).toBe(true);
    const d = r.input!.data as { suggestionType: string; priority: string };
    expect(d.suggestionType).toBe('other');
    expect(d.priority).toBe('medium');
  });

  it('parses a marketing intel item', () => {
    const r = parseIngestBody({ kind: 'marketing', data: { title: 'Seasonal angle', summary: 'Summer travel gear spikes', details: { season: 'summer' } } });
    expect(r.ok).toBe(true);
  });
});

describe('research-only security posture', () => {
  it('stores command-looking text as inert evidence — never executes', () => {
    const r = parseIngestBody({ kind: 'product', data: { productName: 'Ramp', risks: 'rm -rf /; drop table products;' } });
    expect(r.ok).toBe(true);
    // The text survives as inert data for review (Luxedge decides), but the
    // ingest layer must flag it, and nothing here ever runs it.
    const d = r.input!.data as { risks: string };
    expect(d.risks).toContain('rm -rf');
  });

  it('flags shell/SQL/script-like content', () => {
    expect(flagSuspiciousContent('rm -rf / && echo pwned')).toContain('shell-like');
    expect(flagSuspiciousContent('DROP TABLE products;')).toContain('sql-ddl-like');
    expect(flagSuspiciousContent('<script>document.cookie</script>')).toContain('script-like');
    expect(flagSuspiciousContent('just a normal note about product quality')).toEqual([]);
  });

  it('never returns an execution instruction from a payload', () => {
    const r = parseIngestBody({ kind: 'seo', data: { recommendation: '`echo pwned`; --force' } });
    expect(r.ok).toBe(true);
    // validation only — no runner, no command, no admin action exists here
    expect((r.input!.data as { recommendation: string }).recommendation).toContain('echo pwned');
  });
});

describe('Luxedge scoring (research evidence pre-screen)', () => {
  it('gives zero economics points when cost evidence is unknown', () => {
    const s = scoreHermesRecommendation({ productName: 'Ramp', benefits: 'b', risks: 'r', marketingPotential: 'm', adsPotential: 'a' });
    expect(s.breakdown.economics).toBe(0);
    expect(s.marginPercent).toBeNull();
    expect(s.total).toBeLessThan(60);
  });

  it('computes margin from landed cost when present', () => {
    const { marginPercent, source } = marginFrom({ productName: 'x', expectedSellingPrice: 40, landedCost: 20 });
    expect(marginPercent).toBe(50);
    expect(source).toBe('landed_cost');
  });

  it('falls back to supplier+shipping when no landed cost', () => {
    const { marginPercent, source } = marginFrom({ productName: 'x', expectedSellingPrice: 40, supplierPrice: 20, shippingCost: 4 });
    expect(marginPercent).toBe(40);
    expect(source).toBe('supplier_plus_shipping');
  });

  it('does not invent margin when price is missing', () => {
    expect(marginFrom({ productName: 'x', landedCost: 10 }).marginPercent).toBeNull();
  });

  it('caps Hermes confidence contribution at 10 points', () => {
    const s = scoreHermesRecommendation({ productName: 'Ramp', confidence: 1 });
    expect(s.breakdown.confidence).toBe(10);
  });

  it('is deterministic and bounded 0..100', () => {
    const a = scoreHermesRecommendation(validProduct.data as never);
    const b = scoreHermesRecommendation(validProduct.data as never);
    expect(a.total).toBe(b.total);
    expect(a.total).toBeGreaterThanOrEqual(0);
    expect(a.total).toBeLessThanOrEqual(100);
  });

  it('maps score bands', () => {
    expect(scoreBand(30)).toBe('thin');
    expect(scoreBand(50)).toBe('moderate');
    expect(scoreBand(65)).toBe('promising');
    expect(scoreBand(80)).toBe('strong');
  });

  it('maps a stored row back to an input for scoring', () => {
    const row = productInputToRow(validProduct.data as never);
    const input = recommendationRowToInput(row);
    expect(input.productName).toBe('Elevated Dog Ramp for Cars');
    expect(input.supplierPrice).toBe(18.5);
  });
});

describe('ads readiness (Luxedge economics only)', () => {
  it('stays insufficient_data when economics are unknown', () => {
    const a = computeAdsReadiness({ sellingPrice: null, landedCost: null, estimatedVariableCosts: null });
    expect(a.readiness).toBe('insufficient_data');
    expect(a.grossMargin).toBeNull();
    expect(a.contributionMargin).toBeNull();
    expect(a.breakEvenCac).toBeNull();
  });

  it('never treats unknown variable costs as zero', () => {
    const a = computeAdsReadiness({ sellingPrice: 50, landedCost: 25, estimatedVariableCosts: null });
    expect(a.grossMargin).toBe(50);
    expect(a.contributionMargin).toBeNull(); // not silently 0
    expect(a.readiness).toBe('promising');
  });

  it('computes contribution + break-even CAC when variable costs are known', () => {
    const a = computeAdsReadiness({ sellingPrice: 50, landedCost: 20, estimatedVariableCosts: 5 });
    expect(a.contributionMargin).toBe(25);
    expect(a.breakEvenCac).toBe(25);
  });

  it('allowable CAC is never invented (owner-set target required)', () => {
    const a = computeAdsReadiness({ sellingPrice: 50, landedCost: 20, estimatedVariableCosts: 5 });
    expect(a.allowableCac).toBeNull();
  });

  it('strong requires ≥50% margin with real contribution', () => {
    const a = computeAdsReadiness({ sellingPrice: 100, landedCost: 30, estimatedVariableCosts: 10 });
    expect(a.grossMargin).toBe(70);
    expect(a.readiness).toBe('strong');
  });

  it('thin margin maps to possible with a cautious assessment', () => {
    const a = computeAdsReadiness({ sellingPrice: 100, landedCost: 85, estimatedVariableCosts: 0 });
    expect(a.readiness).toBe('possible');
    expect(a.assessment).toMatch(/not compelling/);
  });
});

describe('row builders (migration 0012 shapes)', () => {
  it('builds a hermes_recommendations row with research defaults', () => {
    const row = productInputToRow(validProduct.data as never, { receivedVia: 'salman_os' });
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('new');
    expect(row.received_via).toBe('salman_os');
    expect(row.currency).toBe('USD');
    expect(row.luxedge_score).toBeNull();
    expect(row.validation).toEqual({});
    expect(row.supplier_price).toBe(18.5);
  });

  it('builds a hermes_seo_suggestions row (never auto-applied)', () => {
    const row = seoInputToRow({ recommendation: 'Add internal links', priority: 'high' });
    expect(row.status).toBe('new');
    expect(row.priority).toBe('high');
    expect(row.project).toBe('luxedge');
  });

  it('builds a marketing intel row', () => {
    const row = marketingInputToRow({ title: 'Trend', summary: 'S', intelType: 'trend' });
    expect(row.intel_type).toBe('trend');
    expect(row.status).toBe('new');
  });

  it('builds an ads_readiness row from a computed assessment', () => {
    const a = computeAdsReadiness({ sellingPrice: 50, landedCost: 20, estimatedVariableCosts: 5 });
    const row = adsReadinessToRow({ product_id: null, recommendation_id: 'r1', selling_price: 50, landed_cost: 20, gross_margin: a.grossMargin, estimated_variable_costs: 5, contribution_margin: a.contributionMargin, break_even_cac: a.breakEvenCac, allowable_cac: null, assessment: a.assessment, readiness: a.readiness });
    expect(row.readiness).toBe('strong');
    expect(row.id).toBeTruthy();
  });
});

describe('repository CRUD (local adapter — Hermes offline resilience)', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('inserts and lists recommendations', async () => {
    const row = productInputToRow(validProduct.data as never);
    await insertRecommendation(row);
    const all = await listRecommendations();
    expect(all.length).toBe(1);
    expect(all[0].product_name).toBe('Elevated Dog Ramp for Cars');
  });

  it('updates recommendation status, note and Luxedge score', async () => {
    const row = productInputToRow(validProduct.data as never);
    await insertRecommendation(row);
    const s = scoreHermesRecommendation(validProduct.data as never);
    await updateRecommendation(row.id, { status: 'accepted', review_note: 'needs supplier check', luxedge_score: s.total });
    const all = await listRecommendations();
    expect(all[0].status).toBe('accepted');
    expect(all[0].review_note).toBe('needs supplier check');
    expect(all[0].luxedge_score).toBe(s.total);
  });

  it('deletes a recommendation', async () => {
    const row = productInputToRow(validProduct.data as never);
    await insertRecommendation(row);
    await deleteRecommendation(row.id);
    expect(await listRecommendations()).toEqual([]);
  });

  it('runs the SEO lifecycle (new → accepted → implemented)', async () => {
    const row = seoInputToRow({ recommendation: 'Fix title tags', priority: 'high' });
    await insertSeoSuggestion(row);
    await updateSeoSuggestion(row.id, { status: 'accepted' });
    await updateSeoSuggestion(row.id, { status: 'implemented' });
    const all = await listSeoSuggestions();
    expect(all[0].status).toBe('implemented');
    await deleteSeoSuggestion(row.id);
    expect(await listSeoSuggestions()).toEqual([]);
  });

  it('stores marketing intel and ads readiness', async () => {
    await insertMarketingIntel(marketingInputToRow({ title: 'T', summary: 'S' }));
    await insertAdsReadiness(adsReadinessToRow({ product_id: null, recommendation_id: null, selling_price: 50, landed_cost: 20, gross_margin: 60, estimated_variable_costs: 5, contribution_margin: 25, break_even_cac: 25, allowable_cac: null, assessment: 'ok', readiness: 'strong' }));
    expect((await listMarketingIntel()).length).toBe(1);
    expect((await listAdsReadiness()).length).toBe(1);
  });

  it('research CRUD never touches product tables', async () => {
    // The local adapter stores per-table — inserting research evidence must
    // not create anything under the products table.
    await insertRecommendation(productInputToRow(validProduct.data as never));
    const { getDb } = await import('../../../services/db');
    const products = await getDb().list<{ id: string }>('products');
    expect(products.length).toBe(0);
  });
});
