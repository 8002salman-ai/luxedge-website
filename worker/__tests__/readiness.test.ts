import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSitemap } from '../sitemap';
import { maybeInjectSeo } from '../seo-meta';
import { isHeldBlog, isHeldMedia, isHeldProduct } from '../../src/content/reviewHolds';
import { DEFAULT_CONFIG, isExcludedPath } from '../../src/lib/marketing';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const shell = '<head><title>Luxedge</title><meta name="robots" content="index, follow" /><link rel="canonical" href="https://luxedge.us" /></head><div id="root"></div>';
const env = { ASSETS: { fetch: async () => new Response('{}') } };

describe('editorial release boundaries', () => {
  it('holds only the identified test product and unrelated imported videos', () => {
    expect(isHeldProduct('promo-probe-1788640230930')).toBe(true);
    expect(isHeldProduct('kong-classic-durable-natural-rubber-dog-toy')).toBe(true);
    expect(isHeldProduct('adjustable-nylon-horse-halter-lead-rope')).toBe(true);
    expect(isHeldProduct('horse-grooming-kit-12-piece')).toBe(true);
    expect(isHeldProduct('dog-bed')).toBe(false);
    expect(isHeldMedia('05-05-hollow-crystal-sphere')).toBe(true);
    expect(isHeldMedia('a-reviewed-dog-guide')).toBe(false);
    expect(isHeldBlog('grooming-routine-long-haired-pets')).toBe(true);
  });
  it('returns noindex 404 for held pages even during a database outage', async () => {
    for (const path of ['/product/promo-probe-1788640230930', '/media/05-05-hollow-crystal-sphere', '/blog/grooming-routine-long-haired-pets']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 404);
      expect(result && 'html' in result && result.html).toContain('noindex');
    }
  });
  it('serves /campaigns/:slug as a noindexed 200 (engine landings, SPA-rendered)', async () => {
    const result = await maybeInjectSeo(shell, '/campaigns/pet-gift-drop', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 200);
    expect(result && 'html' in result && result.html).toContain('noindex');
    expect(result && 'html' in result && result.html).toContain('canonical');
    const missing = await maybeInjectSeo(shell, '/campaigns/not-a-campaign', 'https://luxedge.us', env);
    expect(missing).toHaveProperty('status', 404);
  });
  it('keeps truly unknown routes as real noindex 404s (no homepage soft-404)', async () => {
    const result = await maybeInjectSeo(shell, '/campaigns', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 404);
    expect(result && 'html' in result && result.html).toContain('noindex');
  });
  it('excludes utility, nested checkout, search and media routes from both ad modes', () => {
    for (const path of ['/admin', '/checkout/success', '/cart', '/account', '/wishlist', '/blog/write', '/media/example', '/404']) {
      expect(isExcludedPath(path, DEFAULT_CONFIG), path).toBe(true);
    }
    // Shop/category listing pages are owner-approved ad inventory.
    expect(isExcludedPath('/shop', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/category/horse', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/blog/how-to-choose-a-cat-tunnel', DEFAULT_CONFIG)).toBe(false);
  });
  it('excludes all media URLs while retaining qualified products and published blog URLs', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/products?') ? [
        { slug: 'promo-probe-1788640230930', status: 'active', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'dog-bed', name: 'Verified Dog Bed', status: 'active', price: 49.99, image_url: 'https://example.test/dog-bed.jpg', description: 'A verified catalog description with enough factual detail for a customer to understand this product before purchasing.', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'kong-classic', name: 'KONG Classic', status: 'active', price: 12.99, image_url: 'https://example.test/kong.jpg', description: 'A factual product description with enough verified catalog detail for a customer to understand the listed item before ordering.', supplier_source: 'KONG Company (official manufacturer)', commerce_readiness: 'COMMERCE_READY' },
      ] : []
    ))));
    const sitemap = await buildSitemap();
    expect(sitemap).toContain('/product/dog-bed');
    expect(sitemap).not.toContain('promo-probe');
    expect(sitemap).not.toContain('/product/kong-classic');
    expect(sitemap).not.toContain('/media');
    expect(sitemap).not.toContain('<lastmod>');
  });
  it('returns noindex 503 rather than a legacy fallback when the CMS is unavailable', async () => {
    for (const path of ['/blog', '/blog/retired-article', '/media/example']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 503);
      expect(result && 'html' in result && result.html).toContain('noindex');
    }
  });
  it('returns a noindex 404 for a declared-ready official-source PDP', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      id: 'kong-1', slug: 'kong-classic', name: 'KONG Classic', status: 'active', price: 12.99,
      image_url: 'https://example.test/kong.jpg',
      description: 'A factual product description with enough verified catalog detail for a customer to understand the listed item before ordering.',
      supplier_source: 'KONG Company (official manufacturer)', commerce_readiness: 'COMMERCE_READY',
    }]))));
    const result = await maybeInjectSeo(shell, '/product/kong-classic', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 404);
    expect(result && 'html' in result && result.html).toContain('noindex');
  });
});
