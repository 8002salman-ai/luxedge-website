import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSitemap, buildVideoSitemap, buildReviewedVideoSitemap } from '../sitemap';
import { maybeInjectSeo } from '../seo-meta';
import { isHeldMedia, isHeldProduct } from '../../src/content/reviewHolds';
import { DEFAULT_CONFIG, isExcludedPath } from '../../src/lib/marketing';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const shell = '<head><title>Luxedge</title><meta name="robots" content="index, follow" /><link rel="canonical" href="https://luxedge.us" /></head><div id="root"></div>';
const env = { ASSETS: { fetch: async () => new Response('{}') } };

describe('editorial release boundaries', () => {
  it('holds only the identified test product and unrelated imported videos', () => {
    expect(isHeldProduct('promo-probe-1788640230930')).toBe(true);
    expect(isHeldProduct('dog-bed')).toBe(false);
    expect(isHeldMedia('05-05-hollow-crystal-sphere')).toBe(true);
    expect(isHeldMedia('a-reviewed-dog-guide')).toBe(false);
  });
  it('returns noindex 404 for held pages even during a database outage', async () => {
    for (const path of ['/product/promo-probe-1788640230930', '/media/05-05-hollow-crystal-sphere']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 404);
      expect(result && 'html' in result && result.html).toContain('noindex');
    }
  });
  it('excludes utility, nested checkout, search and media routes from both ad modes', () => {
    for (const path of ['/admin', '/checkout/success', '/cart', '/account', '/wishlist', '/blog/write', '/shop', '/category/horse', '/media/example', '/404']) {
      expect(isExcludedPath(path, DEFAULT_CONFIG), path).toBe(true);
    }
    expect(isExcludedPath('/blog/how-to-choose-a-cat-tunnel', DEFAULT_CONFIG)).toBe(false);
  });
  it('does not submit held products or noindex media, or invent modification dates', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/products?') ? [
        { slug: 'promo-probe-1788640230930', status: 'active', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'dog-bed', status: 'active', commerce_readiness: 'COMMERCE_READY' },
      ] : url.includes('/media_videos?') ? [{ slug: '05-05-hollow-crystal-sphere' }] : []
    ))));
    const sitemap = await buildSitemap();
    expect(sitemap).toContain('/product/dog-bed');
    expect(sitemap).not.toContain('promo-probe');
    expect(sitemap).not.toContain('/media');
    expect(sitemap).not.toContain('<lastmod>');
    expect(await buildVideoSitemap()).not.toContain('<url>');
  });
  it('uses a video:video container and editorial description in the future reviewed feed', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { slug: 'guide', title: 'Guide', summary: 'An editorial explanation.', youtube_video_id: 'abcdefghijk', thumbnail_url: 'https://example.com/a.jpg' },
      { slug: 'empty', title: 'Empty', youtube_video_id: 'abcdefghijl', thumbnail_url: 'https://example.com/b.jpg' },
    ]))));
    const sitemap = await buildReviewedVideoSitemap();
    expect(sitemap).toContain('<video:video>');
    expect(sitemap).toContain('<video:description>An editorial explanation.</video:description>');
    expect(sitemap).not.toContain('/media/empty');
    expect(sitemap).not.toContain('<video:content_loc>');
  });
});
