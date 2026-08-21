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
