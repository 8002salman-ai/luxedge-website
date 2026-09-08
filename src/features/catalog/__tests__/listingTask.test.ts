import { describe, it, expect } from 'vitest';
import {
  normalizeListingTask, applyPricingRule, discoverProductLinks, validateListingTask,
  parseListingTaskText, normalizePricingRule,
} from '../listingTask';

describe('listing task — normalization & validation', () => {
  it('normalizes hostile/partial input to safe defaults', () => {
    const t = normalizeListingTask({ sourceUrl: 'not a url', productCount: 99999, category: '  ', pricing: { mode: 'weird' }, status: 'bogus' });
    expect(t.sourceUrl).toBe('');
    expect(t.productCount).toBe(500); // capped
    expect(t.category).toBe('Other');
    expect(t.pricing.mode).toBe('markup');
    expect(t.status).toBe('draft');
    expect(validateListingTask(t).ok).toBe(false);
  });

  it('validates required pricing values per mode', () => {
    expect(validateListingTask(normalizeListingTask({ sourceUrl: 'https://a.com', pricing: { mode: 'fixed', fixedPrice: 0 } })).errors.join(' ')).toMatch(/fixed price/);
    expect(validateListingTask(normalizeListingTask({ sourceUrl: 'https://a.com', pricing: { mode: 'markup', markupPct: 0 } })).errors.join(' ')).toMatch(/markup/);
    expect(validateListingTask(normalizeListingTask({ sourceUrl: 'https://a.com', pricing: { mode: 'min-margin', minMarginPct: 0 } })).errors.join(' ')).toMatch(/margin/);
    expect(validateListingTask(normalizeListingTask({ sourceUrl: 'https://a.com', pricing: { mode: 'markup', markupPct: 40 } })).ok).toBe(true);
  });
});

describe('listing task — pricing rules', () => {
  it('fixed price wins regardless of cost', () => {
    expect(applyPricingRule(5, normalizePricingRule({ mode: 'fixed', fixedPrice: 19.99 }))).toBe(19.99);
  });

  it('markup applies over cost', () => {
    expect(applyPricingRule(10, normalizePricingRule({ mode: 'markup', markupPct: 50 }))).toBe(15);
  });

  it('min-margin keeps at least the configured margin', () => {
    // price = 10 / (1 - 0.4) = 16.67 → margin = 40%
    expect(applyPricingRule(10, normalizePricingRule({ mode: 'min-margin', minMarginPct: 40 }))).toBeCloseTo(16.67, 2);
  });

  it('no cost → falls back to fixed or 0 (never invents margin math)', () => {
    expect(applyPricingRule(0, normalizePricingRule({ mode: 'markup', markupPct: 35 }))).toBe(0);
    expect(applyPricingRule(null, normalizePricingRule({ mode: 'fixed', fixedPrice: 12 }))).toBe(12);
  });
});

describe('listing task — product link discovery', () => {
  const html = `
    <html><body>
      <a href="/">Home</a>
      <a href="/cart">Cart</a>
      <a href="/item/3256807000000000.html">Product 1</a>
      <a href="https://www.aliexpress.com/item/3256807000000001.html">Product 2</a>
      <a href="/item/3256807000000001.html">dup</a>
      <a href="/category/1234">Category page</a>
    </body></html>
  `;

  it('extracts unique absolute product links, caps at max, skips nav', () => {
    const links = discoverProductLinks(html, 'https://www.aliexpress.com/category/1234', 'AliExpress', 5);
    expect(links).toHaveLength(2);
    expect(links[0]).toBe('https://www.aliexpress.com/item/3256807000000000.html');
    expect(links[1]).toBe('https://www.aliexpress.com/item/3256807000000001.html');
  });

  it('caps results at the requested count', () => {
    const many = Array.from({ length: 12 }, (_, i) => `<a href="/item/${i}000.html">p</a>`).join('\n');
    expect(discoverProductLinks(many, 'https://www.aliexpress.com/', 'AliExpress', 3)).toHaveLength(3);
  });

  it('handles Shopify product paths and returns [] for a product-only page', () => {
    const shop = `<a href="/products/dog-collar">Collar</a><a href="/collections/dogs">Col</a>`;
    expect(discoverProductLinks(shop, 'https://store.myshopify.com/', 'Shopify', 5)).toHaveLength(1);
    // A single product page has no other product links.
    expect(discoverProductLinks(`<a href="/products/collar">p</a>`, 'https://store.myshopify.com/products/collar', 'Shopify', 5)).toHaveLength(0);
  });
});

describe('listing task — text parsing', () => {
  it('parses a natural-language listing command', () => {
    const t = parseListingTaskText('Import 8 products from AliExpress for Cattle category with 40% markup, keep Draft, skip livestock claims');
    expect(t.sourcePlatform).toBe('AliExpress');
    expect(t.category).toBe('Cattle');
    expect(t.productCount).toBe(8);
    expect(t.pricing.mode).toBe('markup');
    expect(t.pricing.markupPct).toBe(40);
    expect(t.status).toBe('draft');
  });

  it('detects fixed price and active status', () => {
    const t = parseListingTaskText('Import from https://a.com/search?q=horse with fixed price $25 and status active');
    expect(t.sourceUrl).toContain('a.com');
    expect(t.pricing.mode).toBe('fixed');
    expect(t.pricing.fixedPrice).toBe(25);
    expect(t.status).toBe('active');
  });
});