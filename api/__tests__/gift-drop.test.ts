// ============================================================================
// LUXEDGE — Pet Gift Drop tests
//
// Pure logic (validation / deterministic order numbers / status transitions)
// plus handler-level contract tests for the public state+claim endpoints and
// the admin management endpoint. The claim path is exercised end-to-end with
// a stubbed PostgREST so we assert: no payment fields, $0 totals, marker
// coupon_code, atomic duplicate-email rejection and live inventory gating.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));

const { requireAdmin } = await import('../_lib/auth.js');

const HOST = 'https://probe.supabase.co';
const KEY = 'svc-key';

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
    url: '/api/gift-drop/claim',
    headers: payload ? { 'content-type': 'application/json' } : {},
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

const validClaim = {
  firstName: 'Ada',
  email: 'ada@example.com',
  petType: 'dog',
  petName: 'Biscuit',
  petSize: 'Medium',
  petInterest: 'Toys',
  address: { line1: '12 Woof Lane', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
  marketingOptIn: false,
  company: '',
  formSeconds: 42,
};

const campaignDoc = {
  title: 'Luxedge Pet Gift Drop',
  message: 'm',
  giftName: 'Test gift',
  giftValueCents: 1500,
  totalQuantity: 50,
  active: true,
  startsAt: null,
  endsAt: null,
  updatedAt: new Date().toISOString(),
};

/** Stub PostgREST: campaign doc; count /N; household list; insert capture. */
function stubDb(opts: { active?: boolean; count?: number; duplicate?: boolean; live?: boolean } = {}) {
  const active = opts.active ?? true;
  const count = opts.count ?? 49;
  const inserted: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push(`${method} ${url.split(HOST)[1] || url}`);
      const h = (init?.headers || {}) as Record<string, string>;

      if (url.includes('/rest/v1/app_settings')) {
        return new Response(JSON.stringify([{ value: JSON.stringify({ ...campaignDoc, active }) }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/rest/v1/luxedge_orders')) {
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
          inserted.push(body);
          if (opts.duplicate) {
            return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "luxedge_orders_order_number_key"' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify([
              { id: '11111111-1111-1111-1111-111111111111', order_number: body.order_number, ...body },
            ]),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }
        if (method === 'PATCH') {
          return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (h.Prefer === 'count=exact') {
          return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-range': `0-0/${count}` },
          });
        }
        // household scan list — always includes our inserted claim; when
        // opts.live, another household member already claimed the address.
        const mine = { id: '11111111-1111-1111-1111-111111111111', order_number: 'GIFT-AAAAAAAA', shipping_address: {} };
        const other = {
          id: '22222222-2222-2222-2222-222222222222',
          order_number: 'GIFT-99999999',
          shipping_address: { line1: '12 woof lane', zip: '78701', _gift: { isTest: false } },
        };
        return new Response(JSON.stringify(opts.live ? [mine, other] : [mine]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return { inserted, calls };
}

// ---------------------------------------------------------------------------
describe('gift-drop pure logic', () => {
  it('rejects invalid payloads with clear messages', async () => {
    const lib = await import('../_lib/gift-drop.js');
    expect(lib.validateGiftClaim(null)).toContain('Invalid request');
    expect(lib.validateGiftClaim({ ...validClaim, email: 'not-an-email' })).toContain('email');
    expect(lib.validateGiftClaim({ ...validClaim, petType: 'horse' })).toContain('dogs and cats');
    expect(lib.validateGiftClaim({ ...validClaim, firstName: '' })).toContain('first name');
    const noAddr = { ...validClaim, address: { line1: '', city: '', zip: '' } };
    expect(lib.validateGiftClaim(noAddr)).toContain('shipping address');
    expect(lib.validateGiftClaim({ ...validClaim, company: 'I am a bot' })).toContain('Invalid request');
    expect(lib.validateGiftClaim(validClaim)).toBeNull();
  });

  it('derives deterministic per-email order numbers (atomic dedupe key)', async () => {
    const lib = await import('../_lib/gift-drop.js');
    expect(lib.giftOrderNumber('ada@example.com')).toBe(lib.giftOrderNumber('ADA@Example.com '));
    expect(lib.giftOrderNumber('ada@example.com')).toMatch(/^GIFT-[0-9A-F]{8}$/);
    expect(lib.giftOrderNumber('ada@example.com')).not.toBe(lib.giftOrderNumber('bob@example.com'));
  });

  it('builds a $0 promotional order with no payment fields', async () => {
    const lib = await import('../_lib/gift-drop.js');
    const row = lib.buildGiftOrderRow(validClaim, campaignDoc as never, false);
    expect(row.coupon_code).toBe('PET-GIFT-DROP');
    expect(row.total).toBe(0);
    expect(row.shipping).toBe(0);
    expect(row.status).toBe('pending');
    expect((row as unknown as Record<string, unknown>).stripe_session_id).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).stripe_payment_intent).toBeUndefined();
    expect((row.shipping_address as Record<string, unknown>)._gift).toMatchObject({ payment: 'NOT_REQUIRED', isTest: false });
    expect((row.items as Array<Record<string, unknown>>)[0]).toMatchObject({ kind: 'gift', qty: 1, price: 0 });
  });

  it('defines a sane one-way status flow with cancel on unshipped only', async () => {
    const lib = await import('../_lib/gift-drop.js');
    expect(lib.GIFT_STATUS_FLOW.pending).toContain('processing');
    expect(lib.GIFT_STATUS_FLOW.pending).toContain('cancelled');
    expect(lib.GIFT_STATUS_FLOW.processing).toContain('shipped');
    expect(lib.GIFT_STATUS_FLOW.shipped).toContain('delivered');
    expect(lib.GIFT_STATUS_FLOW.delivered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/gift-drop/claim', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rejects invalid payloads with 400 before touching the DB', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, email: 'nope' }), server);
    expect(captured.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 409 when the campaign is paused', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    stubDb({ active: false });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect((captured.body as { closed?: boolean }).closed).toBe(true);
  });

  it('returns 409 full when live inventory is exhausted', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    stubDb({ count: 50 });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect((captured.body as { full?: boolean }).full).toBe(true);
  });

  it('creates a $0 gift claim end-to-end with no payment step', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    const db = stubDb();
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; orderNumber: string; payment: string; totalCents: number; giftName: string };
    expect(body.ok).toBe(true);
    expect(body.payment).toBe('NOT_REQUIRED');
    expect(body.totalCents).toBe(0);
    expect(body.orderNumber).toMatch(/^GIFT-[0-9A-F]{8}$/);
    const inserted = db.inserted[0] as Record<string, unknown>;
    expect(inserted).toBeDefined();
    expect(inserted.coupon_code).toBe('PET-GIFT-DROP');
    expect(inserted.total).toBe(0);
    expect(inserted.customer_email).toBe('ada@example.com');
    expect(inserted.order_number).toBe(body.orderNumber);
    expect((inserted.shipping_address as Record<string, unknown>)._gift).toMatchObject({ petType: 'dog', isTest: false });
    // No stripe/payment fields anywhere in the created order:
    const keys = Object.keys(inserted as Record<string, unknown>);
    expect(keys).not.toContain('stripe_session_id');
    expect(keys).not.toContain('stripe_payment_intent');
  });

  it('rejects a second claim from the same email atomically (duplicate 409)', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    stubDb({ duplicate: true });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect(String((captured.body as { error: string }).error)).toContain('already claimed');
  });

  it('self-cancels and rejects when the household already claimed', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    stubDb({ live: true });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect(String((captured.body as { error: string }).error)).toContain('household');
  });

  it('rejects test-key claims when GIFT_TEST_KEY is not configured (prod-inert)', async () => {
    const { claimHandler } = await import('../gift-drop.js');
    stubDb();
    delete process.env.GIFT_TEST_KEY;
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, testKey: 'whatever' }), server);
    expect(captured.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/gift-drop/state', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('returns real inventory numbers', async () => {
    const { stateHandler } = await import('../gift-drop.js');
    stubDb({ count: 37 });
    const { server, captured } = makeRes();
    const req = makeReq('GET') as IncomingMessage;
    await stateHandler(req, server);
    expect(captured.status).toBe(200);
    const b = captured.body as { active: boolean; total: number; remaining: number };
    expect(b.active).toBe(true);
    expect(b.total).toBe(50);
    expect(b.remaining).toBe(13);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/admin/gift-drop', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.clearAllMocks();
  });

  it('rejects an illegal status transition', async () => {
    const handler = (await import('../admin/gift-drop.js')).default;
    stubDb();
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      order_number: 'GIFT-AAAAAAAA',
      status: 'pending',
      coupon_code: 'PET-GIFT-DROP',
      shipping_address: { line1: 'a', zip: 'b', _gift: {} },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/rest/v1/app_settings')) {
          return new Response(JSON.stringify([{ value: JSON.stringify(campaignDoc) }]), { status: 200 });
        }
        if (url.includes('count=exact')) return new Response('[]', { status: 200, headers: { 'content-range': '0-0/49' } });
        if ((init?.method || 'GET') === 'GET' && url.includes('/rest/v1/luxedge_orders')) {
          return new Response(JSON.stringify([row]), { status: 200 });
        }
        return new Response('[]', { status: 200 });
      }),
    );
    const { server, captured } = makeRes();
    const req = makeReq('POST', { action: 'update-status', id: row.id, status: 'delivered' });
    await handler(req, server);
    expect(captured.status).toBe(400);
    expect(String((captured.body as { error: string }).error)).toContain('Cannot move');
  });
});
