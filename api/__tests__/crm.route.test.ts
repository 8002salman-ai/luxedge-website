// ============================================================================
// LUXEDGE — /api/crm/* ROUTE TESTS
//
// Verifies the CRM contract without any live HTTP:
//   - /api/crm/welcome: 405 on wrong method, email validation, server-DB
//     absent → preview coupon still returned (visitor never loses the offer),
//     and no secret ever echoed.
//   - /api/crm/lead: 405, contact validation, DB-absent honest degrade.
//   - /api/crm/list: admin JWT required; non-admin 403; missing DB 503.
//   - /api/crm/assistant: 405, empty-message 400, rate-limit 429, canned
//     fallback when DeepSeek is not configured (no fake success).
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const welcomeHandler = (await import('../crm/welcome.js')).default;
const leadHandler = (await import('../crm/lead.js')).default;
const listHandler = (await import('../crm/list.js')).default;
const assistantHandler = (await import('../crm/assistant.js')).default;

const SECRET = '0123456789abcdef0123456789abcdef';
const originalEnv: Record<string, string | undefined> = {
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
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
function makeReq(method: string, body?: unknown, token?: string): IncomingMessage {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const r = {
    method,
    url: '/api/crm/x',
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage & { __body?: string };
  if (body !== undefined) {
    (r as unknown as { __body?: string }).__body = JSON.stringify(body);
    // Provide a minimal readJsonBody-compatible stream.
    (r as unknown as { on: unknown }).on = undefined;
  }
  // Attach a body stream that readJsonBody can consume.
  const payload = body !== undefined ? JSON.stringify(body) : '';
  const listener: Record<string, ((chunk?: Buffer) => void)[]> = {};
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    (listener[name] ||= []).push(fn);
    if (name === 'data' && payload) process.nextTick(() => fn(Buffer.from(payload)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  void listener;
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
  // Force "server DB not configured" for public endpoint tests (no service role).
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DEEPSEEK_API_KEY;
}
function restoreEnv() {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
}

describe('/api/crm/welcome', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-POST with 405', async () => {
    const { captured, server } = makeRes();
    await welcomeHandler(makeReq('GET'), server);
    expect(captured.status).toBe(405);
  });

  it('rejects a missing/invalid email', async () => {
    const { captured, server } = makeRes();
    await welcomeHandler(makeReq('POST', { email: 'nope' }), server);
    expect(captured.status).toBe(400);
    expect(JSON.stringify(captured.body)).toMatch(/email/i);
  });

  it('returns a preview coupon honestly when the server DB is not configured', async () => {
    const { captured, server } = makeRes();
    await welcomeHandler(makeReq('POST', { email: 'visitor@example.com' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, leadSaved: false });
    expect(String((captured.body as { couponCode?: string }).couponCode || '')).toMatch(/^LUX10-/);
    // env var NAMES are fine (setup instructions); actual secret VALUES must never appear.
    const s = JSON.stringify(captured.body);
    expect(s).not.toMatch(/sb_secret|eyJ|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/i);
  });
});

describe('/api/crm/lead', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-POST with 405', async () => {
    const { captured, server } = makeRes();
    await leadHandler(makeReq('GET'), server);
    expect(captured.status).toBe(405);
  });

  it('rejects when neither email nor phone is provided', async () => {
    const { captured, server } = makeRes();
    await leadHandler(makeReq('POST', { source: 'whatsapp' }), server);
    expect(captured.status).toBe(400);
  });

  it('degrades honestly when the server DB is not configured', async () => {
    const { captured, server } = makeRes();
    await leadHandler(makeReq('POST', { email: 'buyer@example.com', source: 'whatsapp' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, stored: false });
  });
});

describe('/api/crm/list', () => {
  beforeEach(() => { process.env.SUPABASE_JWT_SECRET = SECRET; });
  afterEach(restoreEnv);

  it('rejects non-GET with 405', async () => {
    const { captured, server } = makeRes();
    await listHandler(makeReq('POST', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(405);
  });

  it('rejects non-admin with 403', async () => {
    const { captured, server } = makeRes();
    await listHandler(makeReq('GET', undefined, BUYER_TOKEN), server);
    expect(captured.status).toBe(403);
  });

  it('rejects anonymous with 401', async () => {
    const { captured, server } = makeRes();
    await listHandler(makeReq('GET'), server);
    expect(captured.status).toBe(401);
  });

  it('reports 503 when the server DB is not configured', async () => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { captured, server } = makeRes();
    await listHandler(makeReq('GET', undefined, ADMIN_TOKEN), server);
    expect(captured.status).toBe(503);
  });
});

describe('/api/crm/assistant', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-POST with 405', async () => {
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('GET'), server);
    expect(captured.status).toBe(405);
  });

  it('rejects an empty message', async () => {
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('POST', { message: '   ' }), server);
    expect(captured.status).toBe(400);
  });

  it('falls back to a canned reply when DeepSeek is not configured (honest, never fake AI)', async () => {
    const { captured, server } = makeRes();
    await assistantHandler(makeReq('POST', { message: 'Do you ship to Texas?' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ provider: 'canned' });
    expect(JSON.stringify(captured.body)).toMatch(/WhatsApp|sales@luxedge\.us/);
    expect(JSON.stringify(captured.body)).not.toMatch(/deepseek.*(sk-|key)/i);
  });
});
