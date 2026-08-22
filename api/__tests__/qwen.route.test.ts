// ============================================================================
// LUXEDGE — /api/ai/qwen + /api/ai/qwen/health ROUTE TESTS
//
// Verifies the private Qwen (Ollama on Colab) contract without any live HTTP:
//   - admin-only (401 anonymous / 403 non-admin)
//   - not-configured → 501 with an honest, credential-free message
//   - prompt + messages paths hit the private Ollama endpoint with Cloudflare
//     Access service-token headers (never a Bearer key)
//   - the Cloudflare access secret is never echoed in responses
//   - health reports Cloudflare auth / Ollama / model / generation
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const qwenHandler = (await import('../ai/qwen.js')).default;
const qwenHealthHandler = (await import('../ai/qwen-health.js')).default;

const SECRET = '0123456789abcdef0123456789abcdef';
const originalEnv: Record<string, string | undefined> = {
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  QWEN_API_BASE_URL: process.env.QWEN_API_BASE_URL,
  QWEN_MODEL: process.env.QWEN_MODEL,
  CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
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

interface CapturedResponse { status: number; body: unknown; text: string }
function makeReq(method: string, body?: unknown, token?: string, url = '/api/ai/qwen'): IncomingMessage {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const r = { method, url, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
  const payload = body !== undefined ? JSON.stringify(body) : '';
  const listener: Record<string, ((chunk?: Buffer) => void)[]> = {};
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    (listener[name] ||= []).push(fn);
    if (name === 'data' && payload) process.nextTick(() => fn(Buffer.from(payload)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

function makeRes() {
  const captured: CapturedResponse = { status: 200, body: null, text: '' };
  const server = {
    statusCode: 200,
    setHeader: () => {},
    end: (payload?: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      const s = payload == null ? '' : String(payload);
      captured.text = s;
      try { captured.body = s ? JSON.parse(s) : null; } catch { captured.body = s; }
    },
  } as unknown as ServerResponse;
  return { captured, server };
}

function resetEnv() {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.QWEN_API_BASE_URL = 'https://ollama.luxedge.us';
  process.env.QWEN_MODEL = 'qwen3.5:9b';
  process.env.CF_ACCESS_CLIENT_ID = 'test-client-id.access';
  process.env.CF_ACCESS_CLIENT_SECRET = 'test-client-secret-value-123';
}
function restoreEnv() {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
}

describe('/api/ai/qwen', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-POST with 405', async () => {
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('GET', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(405);
  });

  it('rejects anonymous with 401', async () => {
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('POST', { prompt: 'hi' }), server);
    expect(captured.status).toBe(401);
  });

  it('rejects non-admin with 403', async () => {
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('POST', { prompt: 'hi' }, BUYER_TOKEN), server);
    expect(captured.status).toBe(403);
  });

  it('returns 501 honestly when not configured (no secret leak)', async () => {
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('POST', { prompt: 'hi' }, ADMIN_TOKEN), server);
    expect(captured.status).toBe(501);
    expect(JSON.stringify(captured.body)).toMatch(/not configured/i);
    expect(JSON.stringify(captured.body)).not.toMatch(/test-client-secret|CF-Access-Client-Secret[^,]*/i);
  });

  it('calls the private Ollama /api/chat with Cloudflare Access headers and returns a clean response', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ model: body.model, message: { content: 'LUXEDGE-QWEN-OK' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('POST', { prompt: 'Reply exactly: LUXEDGE-QWEN-OK' }, ADMIN_TOKEN), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ model: 'qwen3.5:9b', provider: 'qwen', response: 'LUXEDGE-QWEN-OK' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/chat');
    const headers = init.headers as Record<string, string>;
    expect(headers['CF-Access-Client-Id']).toBe('test-client-id.access');
    expect(headers['CF-Access-Client-Secret']).toBe('test-client-secret-value-123');
    expect(headers.Authorization).toBeUndefined();
    // the access secret must never appear in the response
    expect(captured.text).not.toContain('test-client-secret-value-123');
  });

  it('supports the messages chat shape', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ model: body.model, message: { content: 'hello!' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await qwenHandler(
      makeReq('POST', { messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hey' }, { role: 'user', content: 'How are you?' }] }, ADMIN_TOKEN),
      server,
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ model: 'qwen3.5:9b', response: 'hello!' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1]?.body || '{}'));
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('turns provider failure into a clean 502 without secrets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream refused', { status: 401 })));
    const { captured, server } = makeRes();
    await qwenHandler(makeReq('POST', { prompt: 'hi' }, ADMIN_TOKEN), server);
    expect(captured.status).toBe(502);
    expect(JSON.stringify(captured.body)).not.toMatch(/test-client-secret|CF-Access-Client-Secret/i);
  });
});

describe('/api/ai/qwen/health', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-GET with 405 and anonymous with 401', async () => {
    const { captured: c1, server: s1 } = makeRes();
    await qwenHealthHandler(makeReq('POST', undefined, ADMIN_TOKEN), s1);
    expect(c1.status).toBe(405);
    const { captured: c2, server: s2 } = makeRes();
    await qwenHealthHandler(makeReq('GET'), s2);
    expect(c2.status).toBe(401);
  });

  it('reports the full health picture when online', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:9b' }] }), { status: 200 });
      }
      if (u.endsWith('/api/chat')) {
        return new Response(JSON.stringify({ message: { content: 'LUXEDGE-QWEN-OK' } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await qwenHealthHandler(makeReq('GET', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      configured: true,
      cloudflareAuth: 'PASS',
      ollama: 'ONLINE',
      model: 'qwen3.5:9b',
      modelFound: true,
      generation: 'PASS',
    });
    // CF Access secret never in the response
    expect(captured.text).not.toContain('test-client-secret-value-123');
  });

  it('reports OFFLINE / FAIL when tags are rejected (Colab disconnected)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const { captured, server } = makeRes();
    await qwenHealthHandler(makeReq('GET', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ configured: true, cloudflareAuth: 'FAIL', ollama: 'OFFLINE', generation: 'SKIPPED' });
  });

  it('reports not-configured without leaking anything', async () => {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    const { captured, server } = makeRes();
    await qwenHealthHandler(makeReq('GET', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ configured: false, cloudflareAuth: 'UNKNOWN', ollama: 'UNKNOWN', generation: 'SKIPPED' });
    expect(captured.text).not.toMatch(/test-client-secret/i);
  });
});
