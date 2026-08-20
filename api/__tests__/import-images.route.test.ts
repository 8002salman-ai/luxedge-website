// ============================================================================
// LUXEDGE — /api/import-images ROUTE TESTS
//
// Verifies: admin JWT required (401/403), fail-closed 503 when storage env is
// missing, 405/400 validation, and the success path (download → hash-dedupe →
// upload → public URLs) with honest per-image failure reporting.
// (All HTTP is mocked — no live calls, no secrets.)
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub the SSRF guard so tests do not perform real DNS lookups.
vi.mock('../_lib/ssrf.js', () => ({
  validateFetchTarget: async () => null,
}));

const handler = (await import('../import-images.js')).default;

const SECRET = '0123456789abcdef0123456789abcdef';
const SUPABASE_URL = 'https://test-project.supabase.co';

const original = {
  secret: process.env.SUPABASE_JWT_SECRET,
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const ADMIN_TOKEN = signToken({ sub: 'adm-1', email: 'admin@luxedge.us', exp: futureExp, app_metadata: { role: 'admin' } });
const BUYER_TOKEN = signToken({ sub: 'buy-1', email: 'buyer@luxedge.us', exp: futureExp });

interface CapturedResponse {
  status: number;
  body: unknown;
}

function makeHandler() {
  function res(): CapturedResponse & { server: ServerResponse } {
    const captured: CapturedResponse = { status: 200, body: null };
    const server = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: unknown) => {
        captured.status = (server as { statusCode: number }).statusCode;
        try { captured.body = payload ? JSON.parse(String(payload)) : null; } catch { captured.body = String(payload); }
      },
    } as unknown as ServerResponse;
    return Object.assign(captured, { server });
  }

  function req(method: string, body?: unknown, token?: string): IncomingMessage {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const raw = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    let ended = false;
    return {
      method,
      url: '/api/import-images',
      headers,
      on: (ev: string, cb: (chunk?: Buffer) => void) => {
        if (ev === 'data' && raw) cb(raw);
        if (ev === 'end' && !ended) { ended = true; cb(); }
      },
    } as unknown as IncomingMessage;
  }

  return { res, req };
}

function stubBackend() {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://cdn.example/')) {
      // dup.jpg returns the exact same bytes as 2.jpg → hash-dedupe should drop it.
      const tag = url.includes('dup') ? '2.jpg' : url.split('/').pop();
      return new Response(Buffer.from(`fake-image-${tag}`), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (url.includes('/storage/v1/object/product-media/')) {
      return new Response(JSON.stringify({ Key: url.split('/').pop() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'unexpected URL' }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('/api/import-images', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = 'test-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('rejects unauthenticated requests (401)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { productId: 'p1', urls: ['https://cdn.example/a.jpg'] }), c.server);
    expect(c.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { productId: 'p1', urls: ['https://cdn.example/a.jpg'] }, BUYER_TOKEN), c.server);
    expect(c.status).toBe(403);
  });

  it('returns 405 for unsupported methods', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('GET', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(405);
  });

  it('fails closed (503) when storage env is not configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { productId: 'p1', urls: ['https://cdn.example/a.jpg'] }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(503);
    expect((c.body as { error: string }).error).toContain('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates the body (400 on missing productId / urls)', async () => {
    const { res, req } = makeHandler();
    const bad = res();
    await handler(req('POST', { urls: ['https://cdn.example/a.jpg'] }, ADMIN_TOKEN), bad.server);
    expect(bad.status).toBe(400);
    const noUrls = res();
    await handler(req('POST', { productId: 'p1', urls: [] }, ADMIN_TOKEN), noUrls.server);
    expect(noUrls.status).toBe(400);
  });

  it('downloads, dedupes by content hash, uploads and returns public URLs', async () => {
    stubBackend();
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', {
      productId: 'prod-123',
      urls: [
        'https://cdn.example/1.jpg',
        'https://cdn.example/2.jpg',
        'https://cdn.example/dup.jpg',
      ],
    }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(200);
    const body = c.body as {
      ok: boolean;
      uploaded: { publicUrl: string; sourceUrl: string; sortOrder: number }[];
      failed: { sourceUrl: string; reason: string }[];
      warnings: string[];
    };
    expect(body.ok).toBe(true);
    // 3 URLs → 2 unique bytes (dup.jpg has identical bytes to 2.jpg).
    expect(body.uploaded).toHaveLength(2);
    expect(body.uploaded[0].sortOrder).toBe(0);
    expect(body.uploaded[1].sortOrder).toBe(1);
    for (const u of body.uploaded) {
      expect(u.publicUrl).toContain(`${SUPABASE_URL}/storage/v1/object/public/product-media/catalog/prod-123/`);
    }
    expect(body.failed).toEqual([]);
    expect(body.warnings).toEqual([]);
  });

  it('reports per-image failures honestly and never claims success for them', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('broken.jpg')) return new Response('nope', { status: 404 });
      if (url.startsWith('https://cdn.example/')) {
        return new Response(Buffer.from('ok-image'), { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.includes('/storage/v1/object/product-media/')) {
        return new Response(JSON.stringify({ Key: 'x' }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', {
      productId: 'prod-9',
      urls: ['https://cdn.example/ok.jpg', 'https://cdn.example/broken.jpg'],
    }, ADMIN_TOKEN), c.server);
    const body = c.body as { ok: boolean; uploaded: unknown[]; failed: { sourceUrl: string; reason: string }[]; warnings: string[] };
    expect(body.ok).toBe(true);
    expect(body.uploaded).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].sourceUrl).toContain('broken.jpg');
    expect(body.warnings.length).toBeGreaterThan(0);
  });
});
