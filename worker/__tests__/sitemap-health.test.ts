// ============================================================================
// LUXEDGE — worker sitemap health check contract
//
// Pins runSitemapHealth(): it crawls every URL in the live sitemap, reports
// non-200 / unreachable / empty cases honestly, and sends the SEND_MAIL alert
// ONLY when something is actually broken — a clean run sends no mail and
// returns ok=true.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSitemapUrls, runSitemapHealth } from '../sitemap-health';

const ok = () => new Response('<html></html>', { status: 200 });
const missing = () => new Response('nope', { status: 404 });
const gone = () => new Response('', { status: 500 });

describe('parseSitemapUrls', () => {
  it('extracts absolute loc URLs and de-duplicates', () => {
    const xml =
      '<urlset><url><loc>https://luxedge.us/</loc></url>' +
      '<url><loc>https://luxedge.us/blog/how-to-choose-a-cat-tunnel</loc></url>' +
      '<url><loc>https://luxedge.us/</loc></url></urlset>';
    expect(parseSitemapUrls(xml)).toEqual([
      'https://luxedge.us/',
      'https://luxedge.us/blog/how-to-choose-a-cat-tunnel',
    ]);
  });

  it('returns empty array when no loc entries exist', () => {
    expect(parseSitemapUrls('<urlset></urlset>')).toEqual([]);
  });
});

describe('runSitemapHealth', () => {
  const ORIG_FETCH = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    vi.restoreAllMocks();
  });

  it('reports ok when every sitemap URL returns 200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://luxedge.us/sitemap.xml') {
        return new Response(
          '<urlset><url><loc>https://luxedge.us/</loc></url>' +
            '<url><loc>https://luxedge.us/about</loc></url></urlset>',
          { status: 200 },
        );
      }
      return ok();
    });

    const sent: unknown[] = [];
    const result = await runSitemapHealth({
      SEND_MAIL: { send: async (msg) => { sent.push(msg); } },
    });

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.broken).toEqual([]);
    expect(sent).toEqual([]); // clean run sends nothing
  });

  it('reports broken URLs and sends an alert email when any return non-200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://luxedge.us/sitemap.xml') {
        return new Response(
          '<urlset><url><loc>https://luxedge.us/</loc></url>' +
            '<url><loc>https://luxedge.us/blog/dead-post</loc></url>' +
            '<url><loc>https://luxedge.us/error</loc></url></urlset>',
          { status: 200 },
        );
      }
      if (url.includes('dead-post')) return missing();
      if (url.includes('/error')) return gone();
      return ok();
    });

    const sent: unknown[] = [];
    const result = await runSitemapHealth({
      SEND_MAIL: { send: async (msg) => { sent.push(msg); } },
      SITEMAP_ALERT_EMAIL: 'ops@example.com',
    });

    expect(result.ok).toBe(false);
    expect(result.checked).toBe(3);
    expect(result.broken.map((b) => b.status).sort()).toEqual(['404', '500']);
    expect(sent).toHaveLength(1);
    const msg = sent[0] as { to: string; subject: string; text: string };
    expect(msg.to).toBe('ops@example.com');
    expect(msg.subject).toContain('2/3');
    expect(msg.text).toContain('404  https://luxedge.us/blog/dead-post');
  });

  it('falls back to the default alert address when SITEMAP_ALERT_EMAIL is not set', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://luxedge.us/sitemap.xml') {
        return new Response('<urlset><url><loc>https://luxedge.us/broken</loc></url></urlset>', { status: 200 });
      }
      return missing();
    });
    const sent: unknown[] = [];
    const result = await runSitemapHealth({ SEND_MAIL: { send: async (msg) => { sent.push(msg); } } });
    expect(result.ok).toBe(false);
    expect((sent[0] as { to: string }).to).toBe('hello@luxedge.us');
  });

  it('reports an unreachable sitemap endpoint without attempting a mail', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });
    const sent: unknown[] = [];
    const result = await runSitemapHealth({ SEND_MAIL: { send: async (msg) => { sent.push(msg); } } });
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.broken).toEqual([{ url: 'https://luxedge.us/sitemap.xml', status: 'UNREACHABLE' }]);
    expect(sent).toHaveLength(1); // still alerted — the sitemap itself is broken
  });

  it('logs instead of emailing when the SEND_MAIL binding is absent', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://luxedge.us/sitemap.xml') {
        return new Response('<urlset><url><loc>https://luxedge.us/broken</loc></url></urlset>', { status: 200 });
      }
      return missing();
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runSitemapHealth({}); // no SEND_MAIL binding
    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});