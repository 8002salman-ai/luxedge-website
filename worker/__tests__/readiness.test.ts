import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSitemap, buildVideoSitemap } from '../sitemap';
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
    for (const path of ['/admin', '/checkout/success', '/cart', '/account', '/wishlist', '/blog/write', '/media/example', '/404']) {
      expect(isExcludedPath(path, DEFAULT_CONFIG), path).toBe(true);
    }
    // Shop/category listing pages are owner-approved ad inventory.
    expect(isExcludedPath('/shop', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/category/horse', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/blog/how-to-choose-a-cat-tunnel', DEFAULT_CONFIG)).toBe(false);
  });
  it('submits reviewed media but never held products/videos, or invents modification dates', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/products?') ? [
        { slug: 'promo-probe-1788640230930', status: 'active', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'dog-bed', status: 'active', commerce_readiness: 'COMMERCE_READY' },
      ] : url.includes('/media_videos?') ? [
        { slug: 'how-livestock-salt-licks-are-made', youtube_video_id: 'abc123', thumbnail_url: 'https://i.ytimg.com/a.jpg', summary: 'Factory to farm.' },
        { slug: '05-05-hollow-crystal-sphere', youtube_video_id: 'held111', thumbnail_url: 'https://i.ytimg.com/b.jpg', summary: 'Candy snap.' },
      ] : []
    ))));
    const sitemap = await buildSitemap();
    expect(sitemap).toContain('/product/dog-bed');
    expect(sitemap).not.toContain('promo-probe');
    // Reviewed media is indexable now; held videos stay out.
    expect(sitemap).toContain('/media');
    expect(sitemap).toContain('/media/how-livestock-salt-licks-are-made');
    expect(sitemap).not.toContain('05-05-hollow-crystal-sphere');
    expect(sitemap).not.toContain('<lastmod>');
  });
  it('uses a video:video container, editorial description, and excludes held media from the video feed', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { slug: 'guide', title: 'Guide', summary: 'An editorial explanation.', youtube_video_id: 'abcdefghijk', thumbnail_url: 'https://example.com/a.jpg' },
      { slug: 'empty', title: 'Empty', youtube_video_id: 'abcdefghijl', thumbnail_url: 'https://example.com/b.jpg' },
      { slug: '01-01-crystal-block-clean-cut', title: 'Crystal Snap', summary: 'Candy.', youtube_video_id: 'held111', thumbnail_url: 'https://example.com/c.jpg' },
    ]))));
    const sitemap = await buildVideoSitemap();
    expect(sitemap).toContain('<video:video>');
    expect(sitemap).toContain('<video:description>An editorial explanation.</video:description>');
    expect(sitemap).not.toContain('/media/empty');
    expect(sitemap).not.toContain('/media/01-01-crystal-block-clean-cut');
    expect(sitemap).not.toContain('<video:content_loc>');
  });
});
