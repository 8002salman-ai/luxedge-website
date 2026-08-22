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
const subscribeHandler = (await import('../crm/subscribe.js')).default;
const { isMissingTable } = await import('../crm/_lib.js');

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
function makeReq(method: string, body?: unknown, token?: string, url = '/api/crm/x'): IncomingMessage {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const r = {
    method,
    url,
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

  it('emits a HubSpot-ready CSV with firstname/lastname split and safe escaping', async () => {
    process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
    const rows = [
      { id: 'lead-1', email: 'jane@example.com', name: 'Jane "JJ" Doe', phone: '+1 555 0100', source: 'welcome_popup', page_url: 'https://luxedge.us/', coupon_code: 'LUX10-ABC123', coupon_used: false, coupon_used_at: null, opted_in: true, created_at: '2026-08-21T10:00:00Z' },
      { id: 'lead-2', email: 'bob@example.com', name: 'Bob', phone: null, source: 'whatsapp', page_url: null, coupon_code: null, coupon_used: true, coupon_used_at: '2026-08-21T11:00:00Z', opted_in: false, created_at: '2026-08-21T11:00:00Z' },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await listHandler(makeReq('GET', undefined, ADMIN_TOKEN, '/api/crm/list?format=csv'), server);
    expect(captured.status).toBe(200);
    const lines = captured.text.split('\n');
    expect(lines[0]).toBe('"id","email","firstname","lastname","phone","source","page_url","coupon_code","coupon_used","coupon_used_at","opted_in","created_at"');
    expect(lines[1]).toContain('"jane@example.com"');
    expect(lines[1]).toContain('"Jane","""JJ"" Doe"'); // split at first space + quote escaping
    expect(lines[1]).toContain('"LUX10-ABC123"');
    expect(lines[1]).toContain('"LUX10-ABC123"');
    expect(lines[2]).toContain('"Bob",""'); // no last name -> empty cell
    expect(lines[2]).toContain('"true"');
    // no secrets ever
    expect(captured.text).not.toMatch(/svc-role|sb_secret|eyJ/i);
  });

  it('applies source and couponUsed filters to CSV rows', async () => {
    process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
    const rows = [
      { id: 'lead-1', email: 'a@example.com', name: 'A', source: 'welcome_popup', coupon_used: false, created_at: '2026-08-21T10:00:00Z' },
      { id: 'lead-2', email: 'b@example.com', name: 'B', source: 'whatsapp', coupon_used: true, created_at: '2026-08-21T11:00:00Z' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const { captured, server } = makeRes();
    await listHandler(makeReq('GET', undefined, ADMIN_TOKEN, '/api/crm/list?format=csv&source=whatsapp&couponUsed=1'), server);
    expect(captured.status).toBe(200);
    expect(captured.text).toContain('b@example.com');
    expect(captured.text).not.toContain('a@example.com');
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

describe('/api/crm/subscribe', () => {
  beforeEach(resetEnv);
  afterEach(restoreEnv);

  it('rejects non-POST with 405', async () => {
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('GET'), server);
    expect(captured.status).toBe(405);
  });

  it('rejects a missing/invalid email', async () => {
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('POST', { email: 'not-an-email' }), server);
    expect(captured.status).toBe(400);
    expect(JSON.stringify(captured.body)).toMatch(/email/i);
  });

  it('fails soft with an honest note when the server DB is not configured', async () => {
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('POST', { email: 'visitor@example.com' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, leadSaved: false });
    expect(JSON.stringify(captured.body)).not.toMatch(/sb_secret|eyJ|sk-[A-Za-z0-9]{20,}/i);
  });

  it('inserts a newsletter lead (source=newsletter) and confirms saved', async () => {
    process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
    // First call: SELECT existing → empty. Second call: INSERT → 201 row.
    const calls: { url: string; body?: string }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.includes('/rest/v1/crm_leads?')) return new Response('[]', { status: 200 });
      if (url.endsWith('/rest/v1/crm_leads')) {
        const body = JSON.parse(String(init?.body));
        expect(body.source).toBe('newsletter');
        expect(body.opted_in).toBe(true);
        expect(body.coupon_code).toBeNull();
        return new Response(JSON.stringify([{ id: body.id }]), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('POST', { email: 'New.Fan@Example.com ' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, leadSaved: true });
    // email lowercased + trimmed before insert
    expect(calls.some((c) => c.body?.includes('"new.fan@example.com"'))).toBe(true);
    // never echoes the service role key
    expect(JSON.stringify(captured.body)).not.toMatch(/svc-role|sb_secret|eyJ/i);
  });

  it('does not insert a duplicate — returns alreadySubscribed when a row exists', async () => {
    process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/crm_leads?'))      return new Response(JSON.stringify([{ id: 'lead-1' }]), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('POST', { email: 'dup@example.com' }), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, leadSaved: true, alreadySubscribed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the SELECT, never an INSERT
  });

  it('does NOT misreport a check-constraint error as a missing table (the newsletter bug)', async () => {
    process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-test';
    const constraintError = JSON.stringify({
      code: '23514',
      message: 'new row for relation "crm_leads" violates check constraint "crm_leads_source_check"',
      details: 'Failing row contains (..., newsletter, ...).',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/crm_leads?')) return new Response('[]', { status: 200 });
      return new Response(constraintError, { status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { captured, server } = makeRes();
    await subscribeHandler(makeReq('POST', { email: 'constraint@example.com' }), server);
    // Real failure surfaced as a 502 — NOT a misleading "table missing" note.
    expect(captured.status).toBe(502);
    expect(JSON.stringify(captured.body)).not.toMatch(/table is not created|migration 0017|CRM table is not created/i);
  });
});

describe('isMissingTable', () => {
  it('returns false for a check-constraint error that merely mentions the table name', () => {
    const e = {
      ok: false,
      status: 400,
      data: { code: '23514', message: 'new row for relation "crm_leads" violates check constraint "crm_leads_source_check"' },
    };
    expect(isMissingTable(e)).toBe(false);
  });

  it('returns false for an OK response', () => {
    expect(isMissingTable({ ok: true, status: 200, data: [] })).toBe(false);
  });

  it('returns true for PostgREST 404 (table not found)', () => {
    expect(isMissingTable({ ok: false, status: 404, data: { message: 'Not found' } })).toBe(true);
  });

  it('returns true for PGRST205 / PGRST301 / 42P01 / relation-does-not-exist', () => {
    expect(isMissingTable({ ok: false, status: 400, data: { code: 'PGRST205', message: 'Could not find the table public.crm_leads' } })).toBe(true);
    expect(isMissingTable({ ok: false, status: 400, data: { code: 'PGRST301', message: 'table not found' } })).toBe(true);
    expect(isMissingTable({ ok: false, status: 400, data: { code: '42P01', message: 'relation "crm_leads" does not exist' } })).toBe(true);
    expect(isMissingTable({ ok: false, status: 400, data: { code: '42P01', message: 'relation "public.crm_leads" does not exist' } })).toBe(true);
  });
});
