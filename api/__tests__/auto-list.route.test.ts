// ============================================================================
// LUXEDGE — /api/admin/auto-list contract
//
// Admin-only GET/POST toggle for auto-publishing commerce-ready products,
// persisted in app_settings (PRODUCTS_AUTO_PUBLISH_READY = 'true'|'false').
// GET returns { enabled }; POST validates a boolean and writes the setting.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAdmin: vi.fn(),
}));

const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/auto-list.js')).default;

const HOST = 'https://probe.supabase.co';
const KEY = 'PRODUCTS_AUTO_PUBLISH_READY';

function makeRes(): { captured: { status: number; body: unknown }; server: ServerResponse } {
  const captured = { status: 200, body: null as unknown };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      captured.body = typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as ServerResponse;
  return { captured, server };
}

function makeReq(method: string, payload?: Record<string, unknown>): IncomingMessage {
  const body = payload ? JSON.stringify(payload) : '';
  const r = {
    method,
    url: '/api/admin/auto-list',
    headers: payload ? { 'content-type': 'application/json' } : {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

// Stub fetch against the PostgREST URL: GET → current value; POST → 201.
function stubFetch(current: string | null) {
  const calls: { method?: string; url: string; body?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'POST') {
      return new Response(JSON.stringify([{ key: KEY, value: 'true' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rows = current === null ? [] : [{ value: current }];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

describe('/api/admin/auto-list', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin', email: 'admin@test' } as never);
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-probe';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('GET returns the persisted flag (false when unset)', async () => {
    stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('GET'), server);
    const body = captured.body as { enabled: boolean };
    expect(captured.status).toBe(200);
    expect(body.enabled).toBe(false);

    vi.unstubAllGlobals();
    stubFetch('true');
    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('GET'), s2);
    expect((c2.body as { enabled: boolean }).enabled).toBe(true);
  });

  it('POST with a boolean persists the value and echoes it', async () => {
    const calls = stubFetch('false');
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { enabled: true }), server);
    expect(captured.status).toBe(200);
    expect((captured.body as { enabled: boolean; saved: boolean }).enabled).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.body?.includes(`"${KEY}"`) && c.body.includes('"true"'))).toBe(true);
  });

  it('rejects a non-boolean body and non-GET/POST methods', async () => {
    stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { enabled: 'yes' }), server);
    expect(captured.status).toBe(400);

    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('DELETE'), s2);
    expect(c2.status).toBe(405);
  });

  it('requires admin (401 written by requireAdmin itself)', async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('GET'), server);
    expect(captured.status).toBe(401);
  });
});