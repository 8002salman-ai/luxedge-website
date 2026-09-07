// ============================================================================
// LUXEDGE — /api/admin/erp contract
//
// Server-side Embani ERP sync. The browser NEVER holds the webhook URL token:
// GET returns only masked values, set/clear never echo secrets, test is a
// harmless probe, and push sends ONLY authoritative Stripe-webhook orders
// (gift-drop rows excluded, original order numbers preserved for ERP
// reconciliation on retry). A source-scan guard proves the client bundle
// cannot leak ERP credentials.
// ============================================================================
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));
vi.mock('../_lib/supabase.js', () => ({ upsertAppSetting: vi.fn(), deleteAppSetting: vi.fn() }));
vi.mock('../_lib/ssrf.js', () => ({ validateFetchTarget: vi.fn(async () => null) }));

const { requireAdmin } = await import('../_lib/auth.js');
const { upsertAppSetting, deleteAppSetting } = await import('../_lib/supabase.js');
const handler = (await import('../admin/erp.js')).default;

const WEBHOOK_ENV = 'https://erp.embani.example.com/api/luxedge/orders';
const TOKEN_ENV = 'erp_probe_test_token_1234';
const SUPABASE_URL = 'https://xyz.supabase.co';

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

function makeReq(method: string, payload: Record<string, unknown>): IncomingMessage {
  const body = JSON.stringify(payload);
  const r = {
    method,
    url: '/api/admin/erp',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data') process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

interface StubOpts {
  /** app_settings key → value (absent key → no row). */
  settings?: Record<string, string>;
  /** luxedge_orders rows returned to the push action. */
  orders?: unknown[];
  /** Custom ERP webhook responder; receives the request init so tests can inspect the payload. */
  erp?: (url: string, init?: RequestInit) => Response | { throw: Error };
}

function stubFetch(opts: StubOpts = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/luxedge_orders')) {
        return new Response(JSON.stringify(opts.orders ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/app_settings')) {
        const m = url.match(/key=eq\.([^&]+)/);
        const key = m ? decodeURIComponent(m[1]) : '';
        const v = opts.settings?.[key];
        return new Response(JSON.stringify(v ? [{ value: v }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (opts.erp) {
        const r = opts.erp(url, init);
        if (r instanceof Response) return r;
        throw r.throw;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

const realOrder = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  order_number: 'LX-ABCD1234',
  customer_email: 'buyer@example.com',
  customer_name: 'Jane Buyer',
  shipping_address: { line1: '1 Main St', city: 'Denver', state: 'CO', postal_code: '80203', country: 'US' },
  items: [
    { id: 'p1', name: 'Dog Harness', quantity: 1, unitPrice: 29.95 },
    { id: 'p2', name: 'Cat Toy', quantity: 2, unitPrice: 12.5 },
  ],
  coupon_code: null,
  subtotal: 54.95,
  discount: 0,
  shipping: 6.57,
  tax: 0,
  total: 61.52,
  currency: 'USD',
  status: 'paid',
  stripe_session_id: 'cs_test_123',
  stripe_payment_intent: 'pi_test_123',
  created_at: '2026-09-01T10:00:00.000Z',
  ...over,
});

describe('/api/admin/erp', () => {
  const original = {
    webhook: process.env.EMBANI_ERP_WEBHOOK_URL,
    token: process.env.EMBANI_ERP_API_TOKEN,
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    vi.mocked(upsertAppSetting).mockResolvedValue(true);
    vi.mocked(deleteAppSetting).mockResolvedValue(true);
    delete process.env.EMBANI_ERP_WEBHOOK_URL;
    delete process.env.EMBANI_ERP_API_TOKEN;
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_probe_key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (original.webhook === undefined) delete process.env.EMBANI_ERP_WEBHOOK_URL; else process.env.EMBANI_ERP_WEBHOOK_URL = original.webhook;
    if (original.token === undefined) delete process.env.EMBANI_ERP_API_TOKEN; else process.env.EMBANI_ERP_API_TOKEN = original.token;
    if (original.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = original.url;
    if (original.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  });

  it('GET reports not-configured state when nothing is set', async () => {
    stubFetch({});
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { webhook: { configured: boolean; masked: string; source: string }; token: { configured: boolean; masked: string; source: string }; sync: Record<string, unknown> };
    expect(b.webhook).toEqual({ configured: false, masked: '', source: 'none' });
    expect(b.token).toEqual({ configured: false, masked: '', source: 'none' });
    expect(b.sync).toEqual({});
  });

  it('GET masks env secrets — the raw token and full URL never leave the server', async () => {
    stubFetch({});
    process.env.EMBANI_ERP_WEBHOOK_URL = WEBHOOK_ENV;
    process.env.EMBANI_ERP_API_TOKEN = TOKEN_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(200);
    const body = JSON.stringify(captured.body);
    expect(body).not.toContain(TOKEN_ENV);
    expect(body).not.toContain(WEBHOOK_ENV.replace('https://', ''));
    const b = captured.body as { webhook: { configured: boolean; masked: string; source: string }; token: { configured: boolean; masked: string; source: string } };
    expect(b.webhook.configured).toBe(true);
    expect(b.webhook.source).toBe('env');
    expect(b.webhook.masked).toContain('••••');
    expect(b.token.configured).toBe(true);
    expect(b.token.source).toBe('env');
    expect(b.token.masked).toContain('••••');
  });

  it('GET reports attached (DB) config when env is absent, still masked', async () => {
    stubFetch({ settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV } });
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { webhook: { configured: boolean; masked: string; source: string }; token: { configured: boolean; source: string } };
    expect(b.webhook.configured).toBe(true);
    expect(b.webhook.source).toBe('attached');
    expect(b.token.source).toBe('attached');
    expect(JSON.stringify(captured.body)).not.toContain(TOKEN_ENV);
  });

  it('set rejects a non-http webhook URL', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', field: 'webhook', value: 'file:///etc/passwd' }), server);
    expect(captured.status).toBe(400);
    expect(upsertAppSetting).not.toHaveBeenCalled();
  });

  it('set webhook persists server-side and never echoes the value', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', field: 'webhook', value: WEBHOOK_ENV }), server);
    expect(captured.status).toBe(200);
    expect(upsertAppSetting).toHaveBeenCalledWith('ERP_WEBHOOK_URL', WEBHOOK_ENV);
    expect(JSON.stringify(captured.body)).not.toContain(WEBHOOK_ENV);
  });

  it('set refuses to overwrite a webhook configured in the environment', async () => {
    process.env.EMBANI_ERP_WEBHOOK_URL = WEBHOOK_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', field: 'webhook', value: 'https://other.example.com/hook' }), server);
    expect(captured.status).toBe(400);
    expect(upsertAppSetting).not.toHaveBeenCalled();
  });

  it('set rejects a too-short token without touching storage', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', field: 'token', value: 'short' }), server);
    expect(captured.status).toBe(400);
    expect(upsertAppSetting).not.toHaveBeenCalled();
  });

  it('set token persists server-side and never echoes it', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', field: 'token', value: TOKEN_ENV }), server);
    expect(captured.status).toBe(200);
    expect(upsertAppSetting).toHaveBeenCalledWith('ERP_API_TOKEN', TOKEN_ENV);
    expect(JSON.stringify(captured.body)).not.toContain(TOKEN_ENV);
  });

  it('clear removes the attached value and reports the remaining env fallback', async () => {
    process.env.EMBANI_ERP_WEBHOOK_URL = WEBHOOK_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'clear', field: 'token' }), server);
    expect(captured.status).toBe(200);
    expect(deleteAppSetting).toHaveBeenCalledWith('ERP_API_TOKEN');
    const b = captured.body as { ok: boolean; configured: boolean; source: string };
    expect(b.ok).toBe(true);
    expect(b.configured).toBe(true); // webhook env still configured
    expect(b.source).toBe('none'); // the cleared token field has no remaining value
  });

  it('test succeeds with a 2xx ERP response and reports no order activity', async () => {
    let erpPayload: unknown = null;
    let authorization: string | null = null;
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      erp: (_url, init) => {
        erpPayload = init?.body ? JSON.parse(String(init.body)) : null;
        authorization = (init?.headers as Record<string, string>)?.Authorization || null;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'test' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; message: string; status: number; latencyMs: number };
    expect(b.ok).toBe(true);
    expect(b.status).toBe(200);
    expect(b.message).toContain('successful');
    // Harmless test payload — no orders, no revenue record.
    expect((erpPayload as { event: string; test: boolean }).event).toBe('test');
    expect((erpPayload as { test: boolean }).test).toBe(true);
    expect((erpPayload as { orders?: unknown }).orders).toBeUndefined();
    expect(authorization).toBe(`Bearer ${TOKEN_ENV}`); // token used server-side, not in the browser
  });

  it('test reports HTTP 401 cleanly without leaking the token', async () => {
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      erp: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'test' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; message: string };
    expect(b.ok).toBe(false);
    expect(b.message).toContain('401');
    expect(JSON.stringify(b)).not.toContain(TOKEN_ENV);
  });

  it('test handles a network error without exposing internals', async () => {
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV },
      erp: () => ({ throw: new Error('fetch failed') }),
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'test' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; message: string };
    expect(b.ok).toBe(false);
    expect(b.message).toContain('Could not reach the ERP server');
  });

  it('push sends ONLY real orders — gift-drop rows excluded, order numbers preserved', async () => {
    const giftRow = realOrder({ id: '99999999-9999-9999-9999-999999999999', order_number: 'LX-GIFTDROP', coupon_code: 'PET-GIFT-DROP', total: 0, status: 'pending' });
    let pushedOrders: Array<Record<string, unknown>> | null = null;
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      orders: [giftRow, realOrder()],
      erp: (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as { orders: Array<Record<string, unknown>> };
        pushedOrders = payload.orders;
        return new Response(JSON.stringify({ created: 1, updated: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'push' }), server);
    expect(captured.status).toBe(200);
    expect(pushedOrders).not.toBeNull();
    expect(pushedOrders!.length).toBe(1);
    expect(pushedOrders![0].order_number).toBe('LX-ABCD1234');
    expect(JSON.stringify(pushedOrders)).not.toContain('LX-GIFTDROP');
    // Normalization contract
    const o = pushedOrders![0] as Record<string, unknown>;
    expect(o.source).toBe('luxedge');
    expect(o.order_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(o.stripe_session_id).toBe('cs_test_123');
    expect(o.payment_status).toBe('paid');
    expect(o.fulfillment_status).toBe('paid');
    expect(o.total).toBe(61.52);
    expect((o.customer as { email: string }).email).toBe('buyer@example.com');
    expect((o.items as unknown[]).length).toBe(2);
    expect((o.items as Array<{ line_total: number }>)[1].line_total).toBe(25);
    const b = captured.body as { ok: boolean; sent: number; created: number | null; updated: number | null; message: string };
    expect(b.ok).toBe(true);
    expect(b.sent).toBe(1);
    expect(b.created).toBe(1);
    expect(b.updated).toBe(0);
    expect(b.message).toContain('ERP Sync complete');
  });

  it('push is idempotent — a retry sends the SAME stable order number', async () => {
    const sent: Array<Array<Record<string, unknown>>> = [];
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      orders: [realOrder()],
      erp: (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as { orders: Array<Record<string, unknown>> };
        sent.push(payload.orders);
        return new Response(JSON.stringify({ created: 1, updated: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await handler(makeReq('POST', { action: 'push' }), makeRes().server);
    await handler(makeReq('POST', { action: 'push' }), makeRes().server);
    expect(sent.length).toBe(2);
    expect(sent[0][0].order_number).toBe('LX-ABCD1234');
    expect(sent[1][0].order_number).toBe('LX-ABCD1234'); // no artificial new ID
  });

  it('push records a per-order sync ledger after success', async () => {
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      orders: [realOrder()],
      erp: () => new Response(JSON.stringify({ updated: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    await handler(makeReq('POST', { action: 'push' }), makeRes().server);
    const ledgerCall = vi.mocked(upsertAppSetting).mock.calls.find(([k]) => k === 'ERP_SYNC_STATUS');
    expect(ledgerCall).toBeDefined();
    const ledger = JSON.parse(String(ledgerCall![1])) as Record<string, { status: string }>;
    expect(ledger['LX-ABCD1234'].status).toBe('updated');
  });

  it('push surfaces per-order failures and marks them failed in the ledger', async () => {
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      orders: [realOrder({ order_number: 'LX-OK-1' }), realOrder({ order_number: 'LX-BAD-1', id: '22222222-2222-2222-2222-222222222222' })],
      erp: () => new Response(JSON.stringify({ created: 1, failed: [{ order_number: 'LX-BAD-1', reason: 'invalid SKU' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'push' }), server);
    const b = captured.body as { ok: boolean; sent: number; failed: { order_number: string; reason: string }[] };
    expect(b.ok).toBe(true);
    expect(b.failed.length).toBe(1);
    expect(b.failed[0].order_number).toBe('LX-BAD-1');
    expect(b.failed[0].reason).toContain('invalid SKU');
    const ledgerCall = vi.mocked(upsertAppSetting).mock.calls.find(([k]) => k === 'ERP_SYNC_STATUS');
    const ledger = JSON.parse(String(ledgerCall![1])) as Record<string, { status: string; error?: string }>;
    expect(ledger['LX-BAD-1'].status).toBe('failed');
    expect(ledger['LX-BAD-1'].error).toContain('invalid SKU');
  });

  it('push batch failure marks every order failed with a sanitized reason', async () => {
    stubFetch({
      settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV, ERP_API_TOKEN: TOKEN_ENV },
      orders: [realOrder(), realOrder({ id: '22222222-2222-2222-2222-222222222222', order_number: 'LX-EFGH5678' })],
      erp: () => new Response('Internal error', { status: 500 }),
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'push' }), server);
    const b = captured.body as { ok: boolean; failed: { order_number: string; reason: string }[]; message: string };
    expect(b.ok).toBe(false);
    expect(b.failed.length).toBe(2);
    expect(b.message).toContain('HTTP 500');
    // No secrets or full URL in the sanitized message.
    expect(JSON.stringify(b)).not.toContain(TOKEN_ENV);
    expect(JSON.stringify(b)).not.toContain(WEBHOOK_ENV);
  });

  it('push handles an empty order list cleanly', async () => {
    stubFetch({ settings: { ERP_WEBHOOK_URL: WEBHOOK_ENV }, orders: [], erp: () => { throw new Error('should not be called'); } });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'push' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; sent: number; message: string };
    expect(b.ok).toBe(true);
    expect(b.sent).toBe(0);
    expect(b.message).toContain('no orders to push');
  });

  it('rejects unauthenticated callers before doing anything', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null as never);
    const { server } = makeRes();
    await handler(makeReq('POST', { action: 'push' }), server);
    expect(requireAdmin).toHaveBeenCalled();
    expect(upsertAppSetting).not.toHaveBeenCalled();
    expect(deleteAppSetting).not.toHaveBeenCalled();
  });

  it('browser code never holds ERP secrets or calls the ERP webhook directly', () => {
    const src = readFileSync(new URL('../../src/admin/AdminSection.tsx', import.meta.url), 'utf8');
    // No localStorage persistence of ERP settings (legacy plaintext removed).
    expect(src).not.toMatch(/localStorage\.(setItem|getItem)\('luxedge-erp/);
    // No direct browser fetch to a configured webhook URL with the token.
    expect(src).not.toMatch(/fetch\(erp/);
    // The browser only talks to the server-side endpoint.
    expect(src).toContain("'/api/admin/erp'");
  });
});