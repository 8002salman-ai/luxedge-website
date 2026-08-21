// ============================================================================
// LUXEDGE — /api/upload-image ROUTE TESTS
//
// Verifies: admin JWT required (401/403), fail-closed 503 when storage env is
// missing, 405/400 validation, base64 decode + size checks, and the success
// path (decode → upload → public URL).
// (All HTTP is mocked — no live calls, no secrets.)
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const handler = (await import('../upload-image.js')).default;

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
      url: '/api/upload-image',
      headers,
      on: (ev: string, cb: (chunk?: Buffer) => void) => {
        if (ev === 'data' && raw) cb(raw);
        if (ev === 'end' && !ended) { ended = true; cb(); }
      },
    } as unknown as IncomingMessage;
  }

  return { res, req };
}

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64');

describe('/api/upload-image', () => {
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
    await handler(req('POST', { productId: 'p1', base64: PNG_B64 }), c.server);
    expect(c.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { productId: 'p1', base64: PNG_B64 }, BUYER_TOKEN), c.server);
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
    await handler(req('POST', { productId: 'p1', base64: PNG_B64 }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(503);
    expect((c.body as { error: string }).error).toContain('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates the body (400 on missing/invalid base64)', async () => {
    const { res, req } = makeHandler();
    const missing = res();
    await handler(req('POST', { productId: 'p1' }, ADMIN_TOKEN), missing.server);
    expect(missing.status).toBe(400);
    const invalid = res();
    await handler(req('POST', { productId: 'p1', base64: '!!!not-base64!!!' }, ADMIN_TOKEN), invalid.server);
    expect(invalid.status).toBe(400);
  });

  it('rejects images over the size limit (400)', async () => {
    // 9 MB of 'A' base64 → ~6.75 MB decoded... need > 8 MB decoded.
    // base64 of N bytes is ceil(N/3)*4 chars; to exceed 8MB decoded we need
    // > ~10.67M base64 chars. Use 11M chars of 'A' (8.25 MB decoded).
    const big = 'A'.repeat(11_000_000);
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { productId: 'p1', base64: big }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(400);
    expect((c.body as { error: string }).error).toContain('too large');
  });

  it('uploads the decoded image and returns a public URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/storage/v1/object/product-media/')) {
        return new Response(JSON.stringify({ Key: url.split('/').pop() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected URL' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', {
      productId: 'prod-123',
      filename: 'hero.png',
      contentType: 'image/png',
      base64: PNG_B64,
    }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(200);
    const body = c.body as { ok: boolean; publicUrl: string };
    expect(body.ok).toBe(true);
    expect(body.publicUrl).toContain(`${SUPABASE_URL}/storage/v1/object/public/product-media/catalog/prod-123/`);
    // Storage POST body must be the decoded bytes, not base64 text.
    const uploadCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/storage/v1/object/product-media/'));
    expect(uploadCall).toBeDefined();
    expect(Buffer.from((uploadCall![1] as { body: Uint8Array }).body).toString('utf8')).toBe('fake-png-bytes');
  });
});
