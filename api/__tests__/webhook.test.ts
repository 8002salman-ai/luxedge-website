// ============================================================================
// LUXEDGE — /api/webhook ROUTE TESTS
//
// Verifies: invalid signatures rejected with NO database write; completed
// sessions persist the REAL purchase snapshot (line items + Stripe totals +
// customer) and decrement inventory EXACTLY once; replays never duplicate an
// order and never double-decrement; charge.refunded syncs refunded /
// partially_refunded; non-completion events are acked.
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
  metadata: { ids: '11111111-1111-4111-8111-111111111111', qtys: '1', coupon: 'none' },
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
  let orderExists = false;
  let inventoryCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });

    // Stripe: retrieve detailed session (webhook snapshot source).
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/') && (init?.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(SESSION), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Inventory RPC — atomic decrement.
    if (url.includes('/rest/v1/rpc/decrement_inventory')) {
      inventoryCalls += 1;
      return new Response(JSON.stringify({ ok: true, remaining: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Orders.
    if (url.includes('/rest/v1/luxedge_orders')) {
      if (init?.method === 'POST') {
        if (orderExists) {
          return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "luxedge_orders_stripe_session_id_key"' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        orderExists = true;
        return new Response(JSON.stringify([{ id: 'ord_1', ...JSON.parse(String(init.body)) }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify([{ id: 'ord_1', ...JSON.parse(String(init.body)) }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // GET (existence check)
      return new Response(JSON.stringify(orderExists ? [{ id: 'ord_1' }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return { calls, get inventoryCalls() { return inventoryCalls; } };
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

  it('persists the REAL purchase snapshot on checkout.session.completed', async () => {
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
    // Real snapshot from Stripe's authoritative session.
    expect(row.items).toEqual([{ id: '11111111-1111-4111-8111-111111111111', name: 'Test Product', unitPrice: 25, quantity: 1 }]);
    expect(row.subtotal).toBe(29.99);
    expect(row.discount).toBe(0);
    expect(row.shipping).toBe(4.99);
    expect(row.tax).toBe(2.01); // Stripe-computed tax, not a Luxedge estimate
    expect(row.total).toBe(33);
    expect(row.customer_email).toBe('buyer@example.com');
    expect(row.customer_name).toBe('Jane Smith');
    expect(row.shipping_address.state).toBe('TX');
    // Inventory decremented exactly once (single line).
    const decrements = env.calls.filter((c) => c.url.includes('/rest/v1/rpc/decrement_inventory'));
    expect(decrements.length).toBe(1);
    expect(decrements[0].body).toEqual({ p_product_id: '11111111-1111-4111-8111-111111111111', p_quantity: 1 });
  });

  it('is idempotent — a replayed completed event creates NO duplicate order and NO double decrement', async () => {
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
    const decrements = env.calls.filter((c) => c.url.includes('/rest/v1/rpc/decrement_inventory'));
    expect(decrements.length).toBe(1); // never decremented twice
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

  it('acks but ignores non-completion, non-refund events', async () => {
    const env = makeEnv();
    const body = sessionEvent('checkout.session.expired');
    const { server, cap } = res();
    await handler(req(body, sign(body)), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { ignored: string }).ignored).toBe('checkout.session.expired');
    expect(env.calls.some((c) => c.url.includes('/rest/v1/luxedge_orders'))).toBe(false);
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
