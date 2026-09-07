// ============================================================================
// LUXEDGE — /api/admin/table-columns contract
//
// Admin-only GET/POST for the seller-chosen catalog column order, persisted
// per-admin in app_settings (ADMIN_CATALOG_COLUMN_ORDER_V1 = JSON map of
// admin email → column order array) so the layout follows the admin across
// devices. GET returns { columns } (null when never saved); POST validates a
// non-empty string array and writes the per-admin entry.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAdmin: vi.fn(),
}));

const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/table-columns.js')).default;

const HOST = 'https://probe.supabase.co';
const SETTING_KEY = 'ADMIN_CATALOG_COLUMN_ORDER_V1';

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
    url: '/api/admin/table-columns',
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

// Stub fetch against the PostgREST URL. `stored` is the app_settings value
// (JSON map of email → columns). GET → that value; POST → 201.
function stubFetch(stored: string | null) {
  const calls: { method?: string; url: string; body?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'POST') {
      return new Response(JSON.stringify([{ key: SETTING_KEY, value: '{}' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rows = stored === null ? [] : [{ value: stored }];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

describe('/api/admin/table-columns', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin', email: 'Admin@Test.com' } as never);
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-probe';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('GET returns null when this admin never saved an order', async () => {
    stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('GET'), server);
    expect(captured.status).toBe(200);
    expect((captured.body as { columns: string[] | null }).columns).toBeNull();
  });

  it('GET returns THIS admin\'s order only (per-admin keying)', async () => {
    stubFetch(JSON.stringify({ 'other@test.com': ['actions', 'price'], 'admin@test.com': ['margin', 'product'] }));
    const { captured, server } = makeRes();
    await handler(makeReq('GET'), server);
    expect(captured.status).toBe(200);
    // Email is lowercased in the handler: Admin@Test.com → admin@test.com
    expect((captured.body as { columns: string[] | null }).columns).toEqual(['margin', 'product']);
  });

  it('POST validates the body and persists the order for the admin', async () => {
    const calls = stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { columns: ['actions', 'price', 'product'] }), server);
    expect(captured.status).toBe(200);
    expect((captured.body as { columns: string[]; saved: boolean }).saved).toBe(true);
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    const body = JSON.parse(String(post?.body));
    expect(body.key).toBe(SETTING_KEY);
    const map = JSON.parse(body.value) as Record<string, string[]>;
    expect(map['admin@test.com']).toEqual(['actions', 'price', 'product']);
  });

  it('rejects invalid column bodies and non-GET/POST methods', async () => {
    stubFetch(null);
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { columns: [] }), server);
    expect(captured.status).toBe(400);

    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('POST', { columns: [123] }), s2);
    expect(c2.status).toBe(400);

    const { captured: c3, server: s3 } = makeRes();
    await handler(makeReq('DELETE'), s3);
    expect(c3.status).toBe(405);
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