// Route tests for GET /api/fetch-page — product-evidence validation,
// cost-aware scrape.do escalation, geoCode=us, and structured diagnostics.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../fetch-page.js';

vi.mock('../_lib/ssrf.js', () => ({
  validateFetchTarget: async () => null,
}));
vi.mock('../_lib/auth.js', () => ({
  requireAdmin: async () => true,
}));

function makeRes() {
  const captured: { status: number; headers: Record<string, string>; body: unknown } = {
    status: 200, headers: {}, body: null,
  };
  const server = {
    statusCode: 200,
    setHeader: (k: string, v: string) => { captured.headers[k] = v; },
    end: (payload?: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      try { captured.body = payload ? JSON.parse(String(payload)) : null; } catch { captured.body = String(payload); }
    },
  } as unknown as ServerResponse;
  return Object.assign(captured, { server });
}

function req(url: string): IncomingMessage {
  return { method: 'GET', url, headers: {} } as unknown as IncomingMessage;
}

/** A real-looking AliExpress product page with strong evidence (title + image + item id). */
function realProductPage(itemId: string, title = 'Dog Cooling Mat 2XL 150x100cm'): string {
  return `<html><head>
    <meta property="og:title" content="${title}" />
    <meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/${itemId}.jpg" />
  </head><body><div data-product-id="${itemId}">product</div><script type="application/ld+json">{"@type":"Product","name":"${title}"}</script></body></html>`;
}

/** A long anti-bot punish page — long enough to prove length gates are gone. */
function punishPage(): string {
  return '<html><body>' + 'x'.repeat(20000) + '<div class="sufei-punish">security check</div></body></html>';
}

describe('GET /api/fetch-page', () => {
  const realFetch = globalThis.fetch;
  let callLog: { url: string }[] = [];

  beforeEach(() => {
    callLog = [];
    vi.stubGlobal('fetch', (async (input: any) => {
      const u = String(input);
      callLog.push({ url: u });
      return new Response('<html></html>', { status: 200 });
    }) as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
    delete (process.env as Record<string, string | undefined>).SCRAPE_DO_TOKEN;
  });

  it('uses geoCode=us (never countryCode) and escalates modes on evidence failure', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    callLog = [];
    vi.stubGlobal('fetch', (async (input: any) => {
      const u = String(input);
      callLog.push({ url: u });
      const attempt = callLog.filter((c) => c.url.includes('api.scrape.do')).length;
      if (attempt < 3) return new Response(punishPage(), { status: 200 });
      return new Response(realProductPage('3256805600005011'), { status: 200 });
    }) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/3256805600005011.html')), c.server);
    const scrapeCalls = callLog.filter((x) => x.url.includes('api.scrape.do'));
    expect(scrapeCalls.length).toBe(3);
    // Every scrape.do call must use the documented geoCode=us parameter.
    for (const call of scrapeCalls) {
      expect(call.url).toContain('geoCode=us');
      expect(call.url).not.toContain('countryCode');
    }
    // Cost-aware escalation order: render → super → super-wait.
    expect(scrapeCalls[0].url).toContain('render=true');
    expect(scrapeCalls[0].url).not.toContain('super=true');
    expect(scrapeCalls[1].url).toContain('super=true');
    expect(scrapeCalls[1].url).not.toContain('customWait');
    expect(scrapeCalls[2].url).toContain('super=true');
    expect(scrapeCalls[2].url).toContain('blockResources=false');
    expect(scrapeCalls[2].url).toContain('customWait=2000');
    expect(c.status).toBe(200);
    expect(String(c.body)).toContain('Dog Cooling Mat');
  });

  it('serves the real page on the first attempt when evidence is strong', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    callLog = [];
    vi.stubGlobal('fetch', (async (input: any) => {
      callLog.push({ url: String(input) });
      return new Response(realProductPage('123'), { status: 200 });
    }) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/123.html')), c.server);
    const scrapeCalls = callLog.filter((x) => x.url.includes('api.scrape.do'));
    expect(scrapeCalls.length).toBe(1);
    expect(c.status).toBe(200);
    expect(String(c.body)).toContain('Dog Cooling Mat');
  });

  it('rejects a 200 shell WITHOUT product evidence as 502, even when very long', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    // Long punish page (>15000 chars) — the old length gate would have let it
    // through as a 200. Marker-based detection must reject it regardless.
    vi.stubGlobal('fetch', (async () => new Response(punishPage(), { status: 200 })) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/789.html')), c.server);
    expect(c.status).toBe(502);
    const body = c.body as { error: string; diagnostics: unknown[] };
    expect(body.error).toContain('Could not fetch page');
    expect(body.error).toContain('punish');
    // Structured diagnostics: all 3 attempts recorded with escalating modes.
    expect(body.diagnostics).toHaveLength(3);
    const d = body.diagnostics as { scraper_attempt: number; http_status: number; product_evidence_valid: boolean; scrape_mode: string }[];
    expect(d[0].scrape_mode).toBe('render');
    expect(d[1].scrape_mode).toBe('super');
    expect(d[2].scrape_mode).toBe('super-wait');
    for (const attempt of d) {
      expect(attempt.product_evidence_valid).toBe(false);
      expect(attempt.http_status).toBe(200); // 200 alone is NOT success
    }
  });

  it('rejects a real-looking page with title but NO image/JSON-LD/item id (weak evidence)', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    // og:title present but no og:image, no JSON-LD, item id not in body — must
    // NOT count as product success (title alone is not enough).
    vi.stubGlobal('fetch', (async () => new Response('<html><meta property="og:title" content="Cat Toy" /></html>', { status: 200 })) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/456.html')), c.server);
    expect(c.status).toBe(502);
    const d = (c.body as { diagnostics: { product_title_found: boolean; product_image_found: boolean; product_evidence_valid: boolean }[] }).diagnostics;
    expect(d[0].product_title_found).toBe(true);
    expect(d[0].product_image_found).toBe(false);
    expect(d[0].product_evidence_valid).toBe(false);
  });

  it('validates Product JSON-LD as evidence even without og:title', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    vi.stubGlobal('fetch', (async () => new Response(
      '<html><head><script type="application/ld+json">{"@type":"Product","name":"Cat Toy","image":"https://cdn.example.com/cat.jpg"}</script></head><body>desc</body></html>',
      { status: 200 },
    )) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/999.html')), c.server);
    expect(c.status).toBe(200);
    expect(String(c.body)).toContain('Cat Toy');
  });

  it('falls back to Jina Reader and serves generic pages when no token is set', async () => {
    vi.stubGlobal('fetch', (async () => new Response('<html><body>' + 'y'.repeat(500) + '</body></html>', { status: 200 })) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.example.com/product/1')), c.server);
    expect(c.status).toBe(200);
    expect(String(c.body).length).toBeGreaterThan(200);
  });

  it('no-token AliExpress via Jina is rejected (no real title line)', async () => {
    vi.stubGlobal('fetch', (async () => new Response('Title: AliExpress - Online Shopping\n' + 'x'.repeat(300), { status: 200 })) as typeof fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.com/item/111.html')), c.server);
    expect(c.status).toBe(502);
    expect((c.body as { error: string }).error).toContain('shell');
  });
});
