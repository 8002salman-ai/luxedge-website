// ============================================================================
// LUXEDGE — /api/hermes/ingest ROUTE TESTS
//
// Verifies the research-only boundary end-to-end (with the DB fetch mocked):
//   - admin JWT required (401/403), fail-closed when auth unconfigured
//   - strict schema validation (400 on bad payloads)
//   - research tables only — no other table is ever addressed
//   - writes run as the caller's JWT (RLS) and never expose secrets
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../ingest.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const SUPABASE_URL = 'https://test-project.supabase.co';
const ANON = 'test-anon-key';

const original = {
  secret: process.env.SUPABASE_JWT_SECRET,
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
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
  headers: Record<string, string>;
}

function makeHandler() {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      method: (init?.method || 'GET') as string,
      url,
      headers: (init?.headers || {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    // Rest tables respond with representation of the posted row (or [] for GET)
    const payload = init?.method === 'GET' ? [] : init?.body ? [JSON.parse(init.body as string)] : [];
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  function res(): CapturedResponse & { server: ServerResponse } {
    const captured: CapturedResponse = { status: 200, body: null, headers: {} };
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

  function req(method: string, body?: unknown, token?: string): IncomingMessage {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const raw = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    let ended = false;
    return {
      method,
      url: '/api/hermes/ingest',
      headers,
      on: (ev: string, cb: (chunk?: Buffer) => void) => {
        if (ev === 'data' && raw) cb(raw);
        if (ev === 'end' && !ended) { ended = true; cb(); }
      },
    } as unknown as IncomingMessage;
  }

  return { calls, fetchMock, res, req };
}

describe('/api/hermes/ingest', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original.secret === undefined) delete process.env.SUPABASE_JWT_SECRET; else process.env.SUPABASE_JWT_SECRET = original.secret;
    if (original.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = original.url;
    if (original.anon === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = original.anon;
  });

  it('rejects unauthenticated requests', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'product', data: { productName: 'X' } }), c.server);
    expect(c.status).toBe(401);
  });

  it('rejects non-admin roles', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'product', data: { productName: 'X' } }, BUYER_TOKEN), c.server);
    expect(c.status).toBe(403);
  });

  it('returns 405 for unsupported methods', async () => {
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('PUT', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(405);
  });

  it('stores a valid product suggestion as research evidence (201)', async () => {
    const { calls, res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'product', data: { productName: 'Elevated Dog Ramp', supplierPrice: 18.5, expectedSellingPrice: 39.99, sourceUrl: 'https://example.com/x' } }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(201);
    const body = c.body as { ok: boolean; id: string; table: string; researchOnly: boolean };
    expect(body.ok).toBe(true);
    expect(body.researchOnly).toBe(true);
    expect(body.table).toBe('hermes_recommendations');
    const restCall = calls.find((x) => x.url.includes('/rest/v1/hermes_recommendations'));
    expect(restCall).toBeTruthy();
    expect(restCall!.method).toBe('POST');
    expect(restCall!.headers.Authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect((restCall!.body as { product_name: string }).product_name).toBe('Elevated Dog Ramp');
  });

  it('rejects a payload missing required fields (400) with NO database write', async () => {
    const { calls, res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'product', data: { supplierPrice: 5 } }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(400);
    expect((c.body as { errors: string[] }).errors.join(' ')).toMatch(/productName/);
    expect(calls.filter((x) => x.url.includes('/rest/v1/')).length).toBe(0);
  });

  it('rejects unknown kinds (400)', async () => {
    const { calls, res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'mystery', data: {} }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(400);
    expect(calls.filter((x) => x.url.includes('/rest/v1/')).length).toBe(0);
  });

  it('only ever addresses the four research tables (never products)', async () => {
    const { calls, res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'seo', data: { recommendation: 'Improve title tags' } }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(201);
    await handler(req('POST', { kind: 'marketing', data: { title: 'Seasonal', summary: 'S' } }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(201);
    const restUrls = calls.filter((x) => x.url.includes('/rest/v1/')).map((x) => x.url);
    expect(restUrls.every((u) => /hermes_recommendations|hermes_seo_suggestions|hermes_marketing_intel|ads_readiness/.test(u))).toBe(true);
  });

  it('GET returns the research feeds without secrets', async () => {
    const { calls, res, req } = makeHandler();
    const c = res();
    await handler(req('GET', undefined, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(200);
    const body = c.body as Record<string, unknown>;
    for (const t of ['hermes_recommendations', 'hermes_seo_suggestions', 'hermes_marketing_intel', 'ads_readiness']) {
      expect(t in body).toBe(true);
    }
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(ANON);
    expect(raw).not.toContain(SECRET);
    expect(calls.filter((x) => x.url.includes('/rest/v1/')).length).toBe(4);
  });

  it('fails closed (503) when Supabase is not configured server-side', async () => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const { res, req } = makeHandler();
    const c = res();
    await handler(req('POST', { kind: 'product', data: { productName: 'X' } }, ADMIN_TOKEN), c.server);
    expect(c.status).toBe(503);
  });
});
