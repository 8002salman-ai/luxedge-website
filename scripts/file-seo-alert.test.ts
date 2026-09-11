import { describe, expect, it } from 'vitest';
import { buildIssueContent } from './file-seo-alert.mjs';

const ctx = { repo: 'acme/luxedge', runId: '987654321' };

function cleanReport() {
  return {
    schema_version: '1.0',
    mode: 'read_only',
    site: 'https://luxedge.us',
    generated_at: '2026-09-09T07:00:00.000Z',
    sitemap: { url: 'https://luxedge.us/sitemap.xml', status: 200, urls_discovered: 2, state: 'pass', issues: [] },
    robots: { state: 'pass', sitemap_referenced: true },
    pages: [
      { url: 'https://luxedge.us/a', status: 200, state: 'pass', issues: [] },
      { url: 'https://luxedge.us/b', status: 200, state: 'pass', issues: [] },
    ],
    summary: { checked_urls: 2, failed_urls: 0, alert: false },
  };
}

describe('SEO alert issue content', () => {
  it('returns null when the report shows no alert', () => {
    expect(buildIssueContent(cleanReport(), ctx)).toBeNull();
  });

  it('builds an alert issue listing failed URLs, their issues, and the workflow run', () => {
    const report = {
      ...cleanReport(),
      sitemap: { url: 'https://luxedge.us/sitemap.xml', status: 200, urls_discovered: 2, state: 'fail', issues: ['empty_sitemap'] },
      robots: { state: 'fail', issues: ['http_503'] },
      pages: [
        { url: 'https://luxedge.us/a', status: 200, state: 'pass', issues: [] },
        { url: 'https://luxedge.us/b', status: 404, canonical: 'https://luxedge.us/c', noindex: true, state: 'fail', issues: ['http_404', 'canonical_mismatch', 'noindex'] },
      ],
      summary: { checked_urls: 2, failed_urls: 1, alert: true },
    };
    const content = buildIssueContent(report, ctx)!;
    expect(content).not.toBeNull();
    expect(content.title).toContain('SEO monitor failure');
    expect(content.title).toContain('2026-09-09');
    expect(content.body).toContain('https://luxedge.us/b');
    expect(content.body).toContain('http_404, canonical_mismatch, noindex');
    expect(content.body).toContain('empty_sitemap');
    expect(content.body).toContain('http_503');
    expect(content.body).toContain('actions/runs/987654321');
  });

  it('caps the listed failed URLs at 20 and notes the remainder', () => {
    const pages = Array.from({ length: 25 }, (_, i) => ({ url: `https://luxedge.us/p${i}`, status: 500, state: 'fail', issues: ['http_500'] }));
    const report = {
      ...cleanReport(),
      pages,
      summary: { checked_urls: 25, failed_urls: 25, alert: true },
    };
    const content = buildIssueContent(report, ctx)!;
    expect(content.body).toContain('and 5 more');
    expect(content.body.match(/https:\/\/luxedge\.us\/p\d/g) || []).toHaveLength(20);
  });

  it('builds a run-failed issue when the monitor itself errored', () => {
    const report = { schema_version: '1.0', mode: 'read_only', error: 'monitor_failed: fetch timed out' };
    const content = buildIssueContent(report, ctx)!;
    expect(content.title).toContain('run failed');
    expect(content.body).toContain('fetch timed out');
  });

  it('never puts credential-shaped strings in an issue body', () => {
    const report = {
      ...cleanReport(),
      summary: { checked_urls: 0, failed_urls: 1, alert: true },
      pages: [{ url: 'https://luxedge.us/x', status: 500, state: 'fail', issues: ['http_500'] }],
    };
    const body = buildIssueContent(report, ctx)!.body;
    expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN|CLOUDFLARE_API_TOKEN|send_email|ghp_[A-Za-z0-9]+/i);
  });
});