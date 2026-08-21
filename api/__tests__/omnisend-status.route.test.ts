// ============================================================================
// LUXEDGE — /api/omnisend/status ROUTE TESTS
//
// Verifies: admin JWT required, reports "not configured" without a key,
// never leaks the key, and returns audience metadata on a successful live
// connection test. (All HTTP is mocked — no live calls, no secrets.)
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const handler = (await import('../omnisend/status.js')).default;

const SECRET = '0123456789abcdef0123456789abcdef';
const original = { secret: process.env.SUPABASE_JWT_SECRET };

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

interface CapturedResponse { status: number; body: unknown }
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
  function req(method: string, token?: string): IncomingMessage {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    return { method, url: '/api/omnisend/status', headers } as unknown as IncomingMessage;
  }
  return { res, req };
}

describe('/api/omnisend/status', () => {
  beforeEach(() => { process.env.SUPABASE_JWT_SECRET = SECRET; });
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = original.secret;
    delete process.env.OMNISEND_API_KEY;
    vi.unstubAllGlobals();
  });

  it('rejects non-GET with 405', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await handler(req('POST', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(405);
  });

  it('rejects non-admin with 403', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await handler(req('GET', BUYER_TOKEN), r.server);
    expect(r.status).toBe(403);
  });

  it('reports not configured when no key is set (no secret leak)', async () => {
    delete process.env.OMNISEND_API_KEY;
    const { res, req } = makeHandler();
    const r = res();
    await handler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: false, connected: false });
    expect(JSON.stringify(r.body)).not.toContain('OMNISEND_API_KEY=');
  });

  it('returns audience metadata when Omnisend API responds', async () => {
    process.env.OMNISEND_API_KEY = 'test-omnisend-key-123';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ total: 4321, contacts: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { res, req } = makeHandler();
    const r = res();
    await handler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, connected: true, audience: 4321, platform: 'omnisend' });
    // The key must go to Omnisend as X-API-KEY, never appear in the response.
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    const [input, init] = call;
    expect(String(input)).toContain('api.omnisend.com');
    expect(init.headers['X-API-KEY']).toBe('test-omnisend-key-123');
    expect(JSON.stringify(r.body)).not.toContain('test-omnisend-key-123');
  });

  it('reports 401 auth failure honestly without leaking detail', async () => {
    process.env.OMNISEND_API_KEY = 'bad-key';
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { res, req } = makeHandler();
    const r = res();
    await handler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, connected: false });
    expect(JSON.stringify(r.body)).not.toContain('bad-key');
  });
});
