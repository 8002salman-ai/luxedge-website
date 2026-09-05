// ============================================================================
// LUXEDGE — /api/admin/payment-keys contract
//
// Admin-only management of the owner-attached Stripe keys (app_settings
// PAYMENT_STRIPE_*). NEVER returns a full key; set/clear never echo the key;
// the test action returns only safe account facts. Env vars win over attached.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('../_lib/supabase.js', () => ({
  upsertAppSetting: vi.fn(),
  deleteAppSetting: vi.fn(),
}));

const { requireAdmin } = await import('../_lib/auth.js');
const { upsertAppSetting, deleteAppSetting } = await import('../_lib/supabase.js');
const handler = (await import('../admin/payment-keys.js')).default;

// Probe-only fixtures. Deliberately NOT realistic key material (push
// protection would block a formatted live key); the handler only checks
// length/masking, never key validity.
const SECRET_ENV = 'sk_probe_test_secret';
const WH_ENV = 'whsec_probe_test_secret';

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
    url: '/api/admin/payment-keys',
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

// Route fetch by URL: Supabase app_settings reads → empty; Stripe /v1/account → live.
function stubFetch(accountBody: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/account')) {
        return new Response(JSON.stringify(accountBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

describe('/api/admin/payment-keys', () => {
  const original = {
    secret: process.env.STRIPE_SECRET_KEY,
    wh: process.env.STRIPE_WEBHOOK_SECRET,
  };

  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin' } as never);
    vi.mocked(upsertAppSetting).mockResolvedValue(true);
    vi.mocked(deleteAppSetting).mockResolvedValue(true);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (original.secret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original.secret;
    if (original.wh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = original.wh;
  });

  it('GET reports not-configured state when neither env nor attached keys exist', async () => {
    stubFetch({});
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      secretKey: { configured: false, masked: '', source: 'none' },
      webhookSecret: { configured: false, masked: '', source: 'none' },
    });
  });

  it('GET reports env keys as configured with source env and masks them', async () => {
    stubFetch({});
    process.env.STRIPE_SECRET_KEY = SECRET_ENV;
    process.env.STRIPE_WEBHOOK_SECRET = WH_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { secretKey: { configured: boolean; source: string; masked: string }; webhookSecret: { configured: boolean; source: string; masked: string } };
    expect(b.secretKey.configured).toBe(true);
    expect(b.secretKey.source).toBe('env');
    expect(b.secretKey.masked).not.toContain(SECRET_ENV);
    expect(b.secretKey.masked).toContain('••••');
    expect(b.webhookSecret.configured).toBe(true);
  });

  it('set rejects a too-short key without touching storage', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', keyType: 'secretKey', key: 'sk_x' }), server);
    expect(captured.status).toBe(400);
    expect(upsertAppSetting).not.toHaveBeenCalled();
  });

  it('set persists the key under the PAYMENT_STRIPE_* setting and never echoes it', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'set', keyType: 'secretKey', key: SECRET_ENV }), server);
    expect(captured.status).toBe(200);
    expect(upsertAppSetting).toHaveBeenCalledWith('PAYMENT_STRIPE_SECRET_KEY', SECRET_ENV);
    expect(JSON.stringify(captured.body)).not.toContain(SECRET_ENV);
    const b = captured.body as { ok: boolean; masked: string };
    expect(b.ok).toBe(true);
    expect(b.masked).toContain('••••');
  });

  it('test probes the Stripe account and reports only safe facts', async () => {
    stubFetch({ livemode: true, charges_enabled: false, payouts_enabled: false, id: 'acct_1234567890abcdef' });
    process.env.STRIPE_SECRET_KEY = SECRET_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'test' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; mode: string; chargesEnabled: boolean; masked: string };
    expect(b.ok).toBe(true);
    expect(b.mode).toBe('live');
    expect(b.chargesEnabled).toBe(false);
    expect(b.masked).not.toContain(SECRET_ENV);
  });

  it('test reports failure when Stripe rejects the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), { status: 401 })),
    );
    process.env.STRIPE_SECRET_KEY = SECRET_ENV;
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'test' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; message: string };
    expect(b.ok).toBe(false);
    expect(b.message).toContain('Stripe rejected the key');
  });

  it('clear removes the attached key and reflects remaining env config', async () => {
    const { captured, server } = makeRes();
    await handler(makeReq('POST', { action: 'clear', keyType: 'webhookSecret' }), server);
    expect(captured.status).toBe(200);
    expect(deleteAppSetting).toHaveBeenCalledWith('PAYMENT_STRIPE_WEBHOOK_SECRET');
    const b = captured.body as { ok: boolean; configured: boolean };
    expect(b.ok).toBe(true);
    expect(b.configured).toBe(false);
  });

  it('rejects unauthenticated callers before doing anything', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const { server } = makeRes();
    await handler(makeReq('GET', {}), server);
    expect(requireAdmin).toHaveBeenCalled();
    expect(upsertAppSetting).not.toHaveBeenCalled();
    expect(deleteAppSetting).not.toHaveBeenCalled();
  });
});