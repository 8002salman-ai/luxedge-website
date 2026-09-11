import { describe, expect, it } from 'vitest';
import { classifyRobots, classifyUrl, parsePageSignals, runMonitor, shouldAlert } from './seo-monitor.mjs';

describe('SEO monitor classification', () => {
  it('flags non-200, noindex, and non-self canonical sitemap pages', () => {
    expect(classifyUrl({ url: 'https://luxedge.us/a', status: 404, canonical: 'https://luxedge.us/b', noindex: true }).issues).toEqual(['http_404', 'canonical_mismatch', 'noindex']);
  });
  it('recognizes canonical and noindex signals regardless of tag attribute order', () => {
    expect(parsePageSignals('<meta content="noindex, follow" name="robots"><link href="/p" rel="canonical">', 'https://luxedge.us/p')).toEqual({ canonical: 'https://luxedge.us/p', noindex: true, robots: 'noindex, follow' });
  });
  it('requires robots to reference the exact sitemap URL', () => {
    expect(classifyRobots({ status: 200, text: 'User-agent: *\nSitemap: https://luxedge.us/sitemap.xml', sitemapUrl: 'https://luxedge.us/sitemap.xml' })).toMatchObject({ state: 'pass', sitemap_referenced: true });
  });
});
describe('SEO monitor alerts', () => {
  it('only alerts for a failed sitemap, robots policy, or page', () => {
    const clean = { sitemap: { state: 'pass' }, robots: { state: 'pass' }, summary: { failed_urls: 0 } }; expect(shouldAlert(clean)).toBe(false); expect(shouldAlert({ ...clean, summary: { failed_urls: 1 } })).toBe(true);
  });
  it('emits a machine-readable read-only report', async () => {
    const responses: Record<string, { status: number; text: string }> = {
      'https://example.test/sitemap.xml': { status: 200, text: '<urlset><url><loc>https://example.test/a</loc></url></urlset>' },
      'https://example.test/a': { status: 200, text: '<link rel="canonical" href="https://example.test/a">' },
      'https://example.test/robots.txt': { status: 200, text: 'Sitemap: https://example.test/sitemap.xml' },
    };
    const report = await runMonitor({ site: 'https://example.test', fetchImpl: async (url: string) => responses[url] });
    expect(report).toMatchObject({ schema_version: '1.0', mode: 'read_only', summary: { checked_urls: 1, failed_urls: 0, alert: false } });
  });
});


