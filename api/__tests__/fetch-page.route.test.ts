// Route tests for GET /api/fetch-page — retry-on-punish-page and clean errors.
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

describe('GET /api/fetch-page', () => {
  const realFetch = globalThis.fetch;
  let callLog: { url: string; status: number; body: string }[] = [];

  beforeEach(() => {
    callLog = [];
    globalThis.fetch = (async (input: any) => {
      const u = String(input);
      callLog.push({ url: u, status: 200, body: '' });
      // First two scrape.do attempts return the anti-bot punish page; the
      // third returns the real product page.
      const punish = u.includes('api.scrape.do');
      const attempt = callLog.filter((c) => c.url.includes('api.scrape.do')).length;
      if (punish && attempt < 3) {
        return new Response('<html>sufei-punish recaptcha</html>', { status: 200 });
      }
      return new Response('<html><meta property="og:title" content="Dog Cooling Mat" /><img src="https://ae-pic.example/kf/a.jpg" /></html>', { status: 200 });
    }) as typeof fetch;
    vi.stubGlobal('fetch', globalThis.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
    delete (process.env as Record<string, string | undefined>).SCRAPE_DO_TOKEN;
  });

  it('retries the punish page and serves the real page on attempt 3', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/123.html')), c.server);
    const scrapeCalls = callLog.filter((x) => x.url.includes('api.scrape.do'));
    expect(scrapeCalls.length).toBe(3);
    expect(c.status).toBe(200);
    expect(String(c.body)).toContain('Dog Cooling Mat');
  });

  it('serves the real page on the first attempt', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    callLog = [];
    globalThis.fetch = (async (input: any) => {
      callLog.push({ url: String(input), status: 200, body: '' });
      // Real pages are long — the <100-char guard must not trigger a retry.
      return new Response('<html><body>' + 'x'.repeat(500) + '<meta property="og:title" content="Cat Toy" /></body></html>', { status: 200 });
    }) as typeof fetch;
    vi.stubGlobal('fetch', globalThis.fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/456.html')), c.server);
    const scrapeCalls = callLog.filter((x) => x.url.includes('api.scrape.do'));
    expect(scrapeCalls.length).toBe(1);
    expect(c.status).toBe(200);
    expect(String(c.body)).toContain('Cat Toy');
  });

  it('returns clean JSON 502 after exhausting retries with only punish pages', async () => {
    process.env.SCRAPE_DO_TOKEN = 'test-token';
    // Punish pages are >100 chars, so they hit the punish-page check, not
    // the too-little-content guard — and must exhaust all 3 retries.
    globalThis.fetch = (async () => new Response('<html><body>' + 'x'.repeat(300) + 'sufei-punish recaptcha</body></html>', { status: 200 })) as typeof fetch;
    vi.stubGlobal('fetch', globalThis.fetch);
    const c = makeRes();
    await handler(req('/api/fetch-page?url=' + encodeURIComponent('https://www.aliexpress.us/item/789.html')), c.server);
    expect(c.status).toBe(502);
    expect(typeof c.body).toBe('object');
    expect((c.body as { error: string }).error).toContain('Could not fetch');
    expect((c.body as { error: string }).error).toContain('punish');
  });
});
