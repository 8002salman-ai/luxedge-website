// ============================================================================
// LUXEDGE — /api/email/status + /api/email/send ROUTE TESTS
//
// Verifies: admin JWT required, 405 on wrong method, body validation on send,
// missing send_email binding reported honestly (never fake success), and no
// secret/sensitive values in responses. (All HTTP is mocked — no live calls.)
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const statusHandler = (await import('../email/status.js')).default;
const sendHandler = (await import('../email/send.js')).default;

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
function makeHandler(env?: { SEND_MAIL?: unknown }) {
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
    const r = {
      method,
      url: method === 'GET' ? '/api/email/status' : '/api/email/send',
      headers,
      env,
    } as unknown as IncomingMessage & { env?: { SEND_MAIL?: unknown } };
    (r as { on?: unknown }).on = undefined;
    return r as unknown as IncomingMessage;
  }
  return { res, req };
}

// Minimal body reader for send tests: the real readJsonBody needs a stream.
// We stub the body by providing a req that the handler will read — instead we
// test the auth/405/binding paths which fail before body parsing.
describe('/api/email/status', () => {
  beforeEach(() => { process.env.SUPABASE_JWT_SECRET = SECRET; });
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = original.secret;
    vi.unstubAllGlobals();
  });

  it('rejects non-GET with 405', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await statusHandler(req('POST', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(405);
  });

  it('rejects non-admin with 403', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await statusHandler(req('GET', BUYER_TOKEN), r.server);
    expect(r.status).toBe(403);
  });

  it('reports inbound forwarding + outbound sender, never secrets', async () => {
    const { res, req } = makeHandler({ SEND_MAIL: {} });
    const r = res();
    await statusHandler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      configured: true,
      inbound: { enabled: true, destination: '8002salman@gmail.com' },
      outbound: { sender: 'sales@luxedge.us', bindingPresent: true },
    });
    const s = JSON.stringify(r.body);
    expect(s).not.toMatch(/secret|token|key/i);
  });

  it('reports binding missing when no send_email binding', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await statusHandler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.body).toMatchObject({ outbound: { bindingPresent: false } });
  });
});

describe('/api/email/send', () => {
  beforeEach(() => { process.env.SUPABASE_JWT_SECRET = SECRET; });
  afterEach(() => {
    process.env.SUPABASE_JWT_SECRET = original.secret;
    vi.unstubAllGlobals();
  });

  it('rejects non-POST with 405', async () => {
    const { res, req } = makeHandler({ SEND_MAIL: {} });
    const r = res();
    await sendHandler(req('GET', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(405);
  });

  it('rejects non-admin with 403', async () => {
    const { res, req } = makeHandler({ SEND_MAIL: {} });
    const r = res();
    await sendHandler(req('POST', BUYER_TOKEN), r.server);
    expect(r.status).toBe(403);
  });

  it('reports 501 honestly when the send_email binding is missing', async () => {
    const { res, req } = makeHandler();
    const r = res();
    await sendHandler(req('POST', ADMIN_TOKEN), r.server);
    expect(r.status).toBe(501);
    expect(r.body).toMatchObject({ ok: false });
    expect(JSON.stringify(r.body)).toContain('send_email binding');
  });
});

describe('/api/email/send — CRM-leads campaign (audience=leads)', () => {
  function bodyReq(body: unknown, token = ADMIN_TOKEN): IncomingMessage {
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const r = {
      method: 'POST',
      url: '/api/email/send',
      headers,
      env: {
        SEND_MAIL: {
          send: async (msg: { to: string }) => { sentTo.push(msg.to); },
        },
      },
    } as unknown as IncomingMessage;
    const listeners: Record<string, ((c?: Buffer) => void)[]> = {};
    (r as unknown as { on: (n: string, fn: (c?: Buffer) => void) => unknown }).on = (n: string, fn: (c?: Buffer) => void) => {
      (listeners[n] ||= []).push(fn);
      if (n === 'data' && payload) queueMicrotask(() => fn(Buffer.from(payload)));
      if (n === 'end') queueMicrotask(() => fn());
      return r;
    };
    return r;
  }

  const sentTo: string[] = [];
  const ORIG_ENV = { url: process.env.VITE_SUPABASE_URL, role: process.env.SUPABASE_SERVICE_ROLE_KEY, secret: process.env.SUPABASE_JWT_SECRET };

  beforeEach(() => {
    sentTo.length = 0;
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.VITE_SUPABASE_URL = ORIG_ENV.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG_ENV.role;
    process.env.SUPABASE_JWT_SECRET = ORIG_ENV.secret;
    vi.unstubAllGlobals();
  });

  function stubLeads(rows: Array<{ email: string | null }>) {
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/rest/v1/crm_leads')) return new Response(JSON.stringify(rows), { status: 200 });
      return new Response('{}', { status: 500 });
    }));
  }

  function captured(): { status: number; body: unknown; server: ServerResponse } {
    const cap = { status: 200, body: null as unknown, server: null as unknown as ServerResponse };
    const server = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: unknown) => {
        cap.status = (server as { statusCode: number }).statusCode;
        try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
      },
    } as unknown as ServerResponse;
    cap.server = server;
    return cap;
  }

  it('sends to every opted-in lead and reports counts (never returns emails)', async () => {
    stubLeads([{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: null }, { email: 'a@example.com' }, { email: 'bad-email' }]);
    const r = captured();
    await sendHandler(bodyReq({ audience: 'leads', subject: 'S', text: 'T' }), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: 2, failed: 0, total: 2 });
    expect(sentTo).toEqual(['a@example.com', 'b@example.com']);
    expect(JSON.stringify(r.body)).not.toContain('@example.com');
  });

  it('reports zero leads honestly', async () => {
    stubLeads([]);
    const r = captured();
    await sendHandler(bodyReq({ audience: 'leads', subject: 'S', html: '<p>H</p>' }), r.server);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: 0, total: 0 });
    expect(sentTo.length).toBe(0);
  });

  it('counts per-recipient failures without aborting the campaign', async () => {
    stubLeads([{ email: 'ok@example.com' }, { email: 'bad@example.com' }]);
    const cap = { status: 200, body: null as unknown };
    const server = {
      statusCode: 200,
      setHeader: () => {},
      end: (payload?: unknown) => {
        cap.status = (server as { statusCode: number }).statusCode;
        try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
      },
    } as unknown as ServerResponse;
    // Override the binding: fail on the second recipient.
    const payload = JSON.stringify({ audience: 'leads', subject: 'S', text: 'T' });
    const headers: Record<string, string> = { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
    const r = { method: 'POST', url: '/api/email/send', headers, env: { SEND_MAIL: { send: async (msg: { to: string }) => { if (msg.to === 'bad@example.com') throw new Error('nope'); sentTo.push(msg.to); } } } } as unknown as IncomingMessage;
    const listeners: Record<string, ((c?: Buffer) => void)[]> = {};
    (r as unknown as { on: (n: string, fn: (c?: Buffer) => void) => unknown }).on = (n: string, fn: (c?: Buffer) => void) => {
      (listeners[n] ||= []).push(fn);
      if (n === 'data') queueMicrotask(() => fn(Buffer.from(payload)));
      if (n === 'end') queueMicrotask(() => fn());
      return r;
    };
    await sendHandler(r, server);
    expect(cap.status).toBe(200);
    expect(cap.body).toMatchObject({ ok: true, sent: 1, failed: 1, total: 2 });
  });
});
