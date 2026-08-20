// ============================================================================
// LUXEDGE — /api/webhook ROUTE TESTS
//
// Verifies:
//   - invalid signatures rejected with NO database write
//   - completed + payment_status=paid → REAL purchase snapshot persisted,
//     reservation CONSUMED exactly once, no legacy decrement
//   - completed + payment_status!=paid → awaiting_payment, NO inventory change
//   - async_payment_succeeded → awaiting order promoted to paid + consume
//   - async_payment_failed / expired → reservation RELEASED (+ status sync)
//   - replays → no duplicate order, no double consume / no double release
//   - legacy session without a reservation → atomic decrement fallback
//   - charge.refunded syncs refunded / partially_refunded
// ============================================================================
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../webhook.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const SR = 'service-role-key';
const WH = 'whsec_probe_webhook_secret';
const STRIPE = 'sk_test_probe_secret';

const original = {
  url: process.env.VITE_SUPABASE_URL,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  wh: process.env.STRIPE_WEBHOOK_SECRET,
  stripe: process.env.STRIPE_SECRET_KEY,
};

const SESSION = {
  id: 'cs_test_123',
  payment_status: 'paid',
  amount_total: 3300,
  amount_subtotal: 2999,
  currency: 'usd',
  customer_email: 'buyer@example.com',
  payment_intent: 'pi_test_1',
  customer_details: { email: 'buyer@example.com', name: 'Jane Smith', phone: '(555) 123-4567' },
  shipping_details: { name: 'Jane Smith', address: { line1: '456 Elm St', line2: null, city: 'Dallas', state: 'TX', postal_code: '75201', country: 'US' } },
  total_details: { amount_discount: 0, amount_shipping: 499, amount_tax: 201 },
  metadata: { ids: '11111111-1111-4111-8111-111111111111', qtys: '1', coupon: 'none', reservation: 'res-1' },
  line_items: { data: [{ id: 'li_1', description: 'Test Product', quantity: 1, price: { unit_amount: 2500 } }] },
};

function sessionEvent(type = 'checkout.session.completed', overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_1',
    type,
    data: { object: { ...SESSION, ...overrides } },
  });
}

function refundEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_refund_1',
    type: 'charge.refunded',
    data: { object: { id: 'ch_test_1', amount: 3300, amount_refunded: 3300, currency: 'usd', payment_intent: 'pi_test_1', ...overrides } },
  });
}

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', WH).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function makeEnv() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const state = {
    orderStatus: null as string | null,
    inventoryCalls: 0,
    consumeCalls: 0,
    releaseCalls: 0,
    // The webhook uses the RETRIEVED session's payment_status/metadata, so
    // tests override the Stripe GET response to mirror the event.
    sessionOverride: {} as Record<string, unknown>,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });

    // Stripe: retrieve detailed session (webhook snapshot source).
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/') && (init?.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ ...SESSION, ...state.sessionOverride }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Reservation RPCs (migration 0015).
    if (url.includes('/rest/v1/rpc/consume_reservation')) {
      state.consumeCalls += 1;
      return new Response(JSON.stringify({ ok: true, consumed: 1, group_size: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/rpc/release_reservation')) {
      state.releaseCalls += 1;
      return new Response(JSON.stringify({ ok: true, released: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Legacy atomic decrement fallback (migration 0014).
    if (url.includes('/rest/v1/rpc/decrement_inventory')) {
      state.inventoryCalls += 1;
      return new Response(JSON.stringify({ ok: true, remaining: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Orders.
    if (url.includes('/rest/v1/luxedge_orders')) {
      if (init?.method === 'POST') {
        if (state.orderStatus) {
          return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "luxedge_orders_stripe_session_id_key"' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        state.orderStatus = (JSON.parse(String(init.body)) as { status: string }).status;
        return new Response(JSON.stringify([{ id: 'ord_1', ...JSON.parse(String(init.body)) }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (init?.method === 'PATCH') {
        state.orderStatus = (JSON.parse(String(init.body)) as { status: string }).status;
        return new Response(JSON.stringify([{ id: 'ord_1', ...JSON.parse(String(init.body)) }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // GET (existence check)
      return new Response(JSON.stringify(state.orderStatus ? [{ id: 'ord_1', status: state.orderStatus }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return { calls, state };
}

interface Cap { status: number; body: unknown }
function res(): { server: ServerResponse; cap: Cap } {
  const cap: Cap = { status: 200, body: null };
  const server = {
    statusCode: 200,
    setHeader: () => {},
    end: (payload?: unknown) => {
      cap.status = (server as { statusCode: number }).statusCode;
      try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
    },
  } as unknown as ServerResponse;
  return { server, cap };
}

function req(rawBody: string, sig: string | undefined): IncomingMessage {
  const raw = Buffer.from(rawBody);
  let ended = false;
  return {
    method: 'POST',
    url: '/api/webhook',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    on: (ev: string, cb: (chunk?: Buffer) => void) => {
      if (ev === 'data') cb(raw);
      if (ev === 'end' && !ended) { ended = true; cb(); }
    },
  } as unknown as IncomingMessage;
}

describe('/api/webhook', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
    process.env.STRIPE_WEBHOOK_SECRET = WH;
    process.env.STRIPE_SECRET_KEY = STRIPE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('rejects an invalid signature with NO database write', async () => {
    const env = makeEnv();
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`), server);
    expect(cap.status).toBe(400);
    expect(env.calls.some((c) => c.url.includes('/rest/v1/luxedge_orders') || c.url.includes('/rest/v1/rpc'))).toBe(false);
  });

  it('persists the REAL purchase snapshot + consumes the reservation on completed+paid (no legacy decrement)', async () => {
    const env = makeEnv();
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    const insert = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'POST');
    expect(insert).toBeTruthy();
    const row = insert!.body as {
      stripe_session_id: string; status: string; order_number: string;
      items: { id: string; name: string; unitPrice: number; quantity: number }[];
      subtotal: number; discount: number; shipping: number; tax: number; total: number;
      customer_email: string; customer_name: string; shipping_address: { state: string };
    };
    expect(row.stripe_session_id).toBe('cs_test_123');
    expect(row.status).toBe('paid');
    expect(row.order_number).toMatch(/^LX-/);
    expect(row.items).toEqual([{ id: '11111111-1111-4111-8111-111111111111', name: 'Test Product', unitPrice: 25, quantity: 1 }]);
    expect(row.subtotal).toBe(29.99);
    expect(row.discount).toBe(0);
    expect(row.shipping).toBe(4.99);
    expect(row.tax).toBe(2.01);
    expect(row.total).toBe(33);
    expect(row.customer_email).toBe('buyer@example.com');
    expect(row.customer_name).toBe('Jane Smith');
    expect(row.shipping_address.state).toBe('TX');
    // Reservation consumed exactly once; stock was already reduced at reserve,
    // so the legacy decrement RPC must NOT be called.
    expect(env.state.consumeCalls).toBe(1);
    expect(env.state.inventoryCalls).toBe(0);
    const consume = env.calls.find((c) => c.url.includes('/rest/v1/rpc/consume_reservation'));
    expect(consume!.body).toEqual({ p_reservation_id: 'res-1' });
  });

  it('is idempotent — a replayed paid event creates NO duplicate order and consumes exactly once', async () => {
    const env = makeEnv();
    const body = sessionEvent();
    const sig = sign(body);
    const a = res();
    await handler(req(body, sig), a.server);
    expect(a.cap.status).toBe(200);
    const b = res();
    await handler(req(body, sig), b.server);
    expect(b.cap.status).toBe(200);
    expect((b.cap.body as { duplicate: boolean }).duplicate).toBe(true);
    const inserts = env.calls.filter((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'POST');
    expect(inserts.length).toBe(1);
    expect(env.state.consumeCalls).toBe(1); // never consumed twice
  });

  it('completed + payment_status != paid → awaiting_payment, NO inventory change', async () => {
    const env = makeEnv();
    env.state.sessionOverride = { payment_status: 'unpaid' };
    const body = sessionEvent('checkout.session.completed', { payment_status: 'unpaid' });
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    const insert = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'POST');
    expect((insert!.body as { status: string }).status).toBe('awaiting_payment');
    expect(env.state.consumeCalls).toBe(0);
    expect(env.state.inventoryCalls).toBe(0);
  });

  it('async_payment_succeeded promotes an awaiting order to paid + consumes the reservation', async () => {
    const env = makeEnv();
    env.state.orderStatus = 'awaiting_payment';
    const body = sessionEvent('checkout.session.async_payment_succeeded');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { promoted: boolean }).promoted).toBe(true);
    const patch = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'PATCH');
    expect((patch!.body as { status: string }).status).toBe('paid');
    expect(env.state.consumeCalls).toBe(1);
  });

  it('async_payment_failed releases the reservation and marks the order failed', async () => {
    const env = makeEnv();
    env.state.orderStatus = 'awaiting_payment';
    const body = sessionEvent('checkout.session.async_payment_failed');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect(env.state.releaseCalls).toBe(1);
    const patch = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'PATCH');
    expect((patch!.body as { status: string }).status).toBe('failed');
  });

  it('checkout.session.expired releases the reservation (stock restored)', async () => {
    const env = makeEnv();
    const body = sessionEvent('checkout.session.expired');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { released: boolean }).released).toBe(true);
    expect(env.state.releaseCalls).toBe(1);
    expect(env.state.consumeCalls).toBe(0);
  });

  it('legacy session WITHOUT a reservation → atomic decrement fallback (exactly once)', async () => {
    const env = makeEnv();
    env.state.sessionOverride = { metadata: { ids: '11111111-1111-4111-8111-111111111111', qtys: '1', coupon: 'none' } };
    const body = sessionEvent('checkout.session.completed');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect(env.state.consumeCalls).toBe(0);
    expect(env.state.inventoryCalls).toBe(1);
    const decrement = env.calls.find((c) => c.url.includes('/rest/v1/rpc/decrement_inventory'));
    expect(decrement!.body).toEqual({ p_product_id: '11111111-1111-4111-8111-111111111111', p_quantity: 1 });
  });

  it('marks a fully refunded charge as refunded with the Stripe-authoritative amount', async () => {
    const env = makeEnv();
    const body = refundEvent();
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    const patch = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch!.url).toContain('stripe_payment_intent=eq.pi_test_1');
    expect(patch!.body).toMatchObject({ status: 'refunded', refunded_amount: 33 });
  });

  it('marks a partial refund as partially_refunded', async () => {
    const env = makeEnv();
    const body = refundEvent({ amount_refunded: 1000 });
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    const patch = env.calls.find((c) => c.url.includes('/rest/v1/luxedge_orders') && c.method === 'PATCH');
    expect(patch!.body).toMatchObject({ status: 'partially_refunded', refunded_amount: 10 });
  });

  it('acks but ignores unrelated events', async () => {
    const env = makeEnv();
    const body = sessionEvent('payment_intent.created');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { ignored: string }).ignored).toBe('payment_intent.created');
    expect(env.calls.some((c) => c.url.includes('/rest/v1/luxedge_orders') || c.url.includes('/rest/v1/rpc'))).toBe(false);
  });

  it('fails closed (400) when the webhook secret is not configured', async () => {
    makeEnv();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const body = sessionEvent();
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(400);
  });
});
