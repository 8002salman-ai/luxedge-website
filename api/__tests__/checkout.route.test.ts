// ============================================================================
// LUXEDGE — /api/checkout ROUTE TESTS
//
// Supabase reads and Stripe HTTP are both mocked. Verifies the server
// recomputes every amount from the catalog, charges exactly that amount via
// Stripe, rejects tampered prices/coupons, and never returns secrets.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../checkout.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ANON = 'anon-key';
const SR = 'service-role-key';
const STRIPE = 'sk_test_probe_secret';

const original = {
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stripe: process.env.STRIPE_SECRET_KEY,
};

const PRODUCT = { id: '11111111-1111-4111-8111-111111111111', slug: 'test-product', name: 'Test Product', price: 25, status: 'active', inventory_qty: 10, image_url: 'https://img.test/x.jpg' };
const WELCOME10 = { code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_cart_value: 0, is_active: true, start_at: null, end_at: null };
const SETTINGS = { key: 'free_shipping', value: { freeShippingEnabled: true, freeShippingThreshold: 50 } };

function makeEnv(overrides: { reserveOk?: boolean; stripeFail?: boolean } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const controls = {
    reserveOk: overrides.reserveOk ?? true,
    stripeFail: overrides.stripeFail ?? false,
    reserveCalls: 0,
    releaseCalls: 0,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', headers: (init?.headers || {}) as Record<string, string>, body: init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : undefined });
    // Inventory reservation RPCs (migration 0015).
    if (url.includes('/rest/v1/rpc/reserve_inventory')) {
      controls.reserveCalls += 1;
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as { p_product_id?: string; p_quantity?: number };
      if (!controls.reserveOk) {
        return new Response(JSON.stringify({ ok: false, reason: 'out_of_stock_or_oversell' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true, remaining: 10 - (body.p_quantity ?? 1) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/rpc/release_reservation')) {
      controls.releaseCalls += 1;
      return new Response(JSON.stringify({ ok: true, released: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
      if (init?.method === 'POST') {
        if (controls.stripeFail) {
          return new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', payment_status: 'unpaid', amount_total: 0, currency: 'usd', customer_email: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', payment_status: 'paid', amount_total: 3205, currency: 'usd', customer_email: 'a@b.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/products')) return new Response(JSON.stringify([PRODUCT]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/rest/v1/coupons')) return new Response(JSON.stringify(url.includes('NOPE') ? [] : [WELCOME10]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/rest/v1/store_settings')) return new Response(JSON.stringify([SETTINGS]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/rest/v1/luxedge_orders')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  (calls as unknown as { controls: typeof controls }).controls = controls;
  return calls;
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

function req(method: string, body?: unknown, urlPath = '/api/checkout'): IncomingMessage {
  const raw = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
  let ended = false;
  return {
    method, url: urlPath, headers: { host: 'luxedge.us' },
    on: (ev: string, cb: (chunk?: Buffer) => void) => {
      if (ev === 'data' && raw) cb(raw);
      if (ev === 'end' && !ended) { ended = true; cb(); }
    },
  } as unknown as IncomingMessage;
}

describe('/api/checkout', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
    process.env.STRIPE_SECRET_KEY = STRIPE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = original.url;
    if (original.anon === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = original.anon;
    if (original.sr === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original.sr;
    if (original.stripe === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original.stripe;
  });

  it('creates a Stripe session charged at the SERVER-computed total (tampering rejected), tax is 0 (no Stripe Tax add-on)', async () => {
    const calls = makeEnv();
    const { server, cap } = res();
    // Client tries to send price 0.01 — the server must ignore it.
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1, price: 0.01 }], customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(200);
    const body = cap.body as { url: string; totals: { total: number; tax: number } };
    expect(body.url).toContain('checkout.stripe.com');
    // 25 subtotal + 4.99 shipping (below $50). NO tax — Stripe Tax add-on disabled at launch.
    expect(body.totals.total).toBe(29.99);
    expect(body.totals.tax).toBe(0);
    const stripeCall = calls.find((c) => c.url.startsWith('https://api.stripe.com/v1/checkout/sessions') && c.method === 'POST');
    expect(stripeCall).toBeTruthy();
    const stripeBody = String(stripeCall!.body);
    expect(stripeBody).toContain('mode=payment'); // one-time purchase, never subscription
    expect(stripeBody).not.toContain('subscription');
    expect(stripeBody).not.toContain('recurring');
    expect(stripeBody).not.toContain('automatic_tax');
    expect(stripeBody).toContain('shipping_address_collection%5Ballowed_countries%5D%5B0%5D=US');
    // goods line = catalog price; shipping is a separate Stripe shipping option.
    expect(stripeBody).toContain('unit_amount%5D=2500');
    expect(stripeBody).toContain('shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Bfixed_amount%5D%5Bamount%5D=499');
  });

  it('applies WELCOME10 and free shipping at/above the threshold (pre-tax)', async () => {
    const calls = makeEnv();
    const { server, cap } = res();
    // qty 2 × $25 = $50 → free shipping; WELCOME10 10% → $5 discount; NO tax (Stripe adds it).
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 2 }], couponCode: 'WELCOME10', customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(200);
    const body = cap.body as { totals: { discount: number; shipping: number; total: number; tax: number } };
    expect(body.totals.discount).toBe(5);
    expect(body.totals.shipping).toBe(0);
    expect(body.totals.tax).toBe(0);
    expect(body.totals.total).toBe(45);
    const stripeCall = calls.find((c) => c.url.startsWith('https://api.stripe.com/v1/checkout/sessions') && c.method === 'POST');
    const stripeBody = String(stripeCall!.body);
    // discounted goods line: qty 2 × $22.50 = $45 → 2250 cents; shipping option free = 0.
    expect(stripeBody).toContain('unit_amount%5D=2250');
    expect(stripeBody).toContain('shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Bfixed_amount%5D%5Bamount%5D=0');
  });

  it('rejects an invalid coupon (400) with no Stripe call', async () => {
    const calls = makeEnv();
    const { server, cap } = res();
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1 }], couponCode: 'NOPE', customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { code: string }).code).toBe('COUPON_INVALID');
    expect(calls.some((c) => c.url.startsWith('https://api.stripe.com'))).toBe(false);
  });

  it('fails closed (503) when Stripe is not configured', async () => {
    makeEnv();
    delete process.env.STRIPE_SECRET_KEY;
    const { server, cap } = res();
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1 }] }), server);
    expect(cap.status).toBe(503);
  });

  it('probe reports configured status from the server (never the browser)', async () => {
    makeEnv();
    const { server, cap } = res();
    await handler(req('GET', undefined, '/api/checkout?probe=1'), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { configured: boolean }).configured).toBe(true);
  });

  it('probe always answers 200 with configured:false when no keys exist (client parses the body, not status)', async () => {
    makeEnv();
    delete process.env.STRIPE_SECRET_KEY;
    const { server, cap } = res();
    await handler(req('GET', undefined, '/api/checkout?probe=1'), server);
    expect(cap.status).toBe(200);
    expect((cap.body as { configured: boolean }).configured).toBe(false);
  });

  it('GET session returns a safe summary — no secrets', async () => {
    const calls = makeEnv();
    const { server, cap } = res();
    await handler(req('GET', undefined, '/api/checkout?session_id=cs_test_1'), server);
    expect(cap.status).toBe(200);
    const body = cap.body as { session: { paymentStatus: string } };
    expect(body.session.paymentStatus).toBe('paid');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(STRIPE);
    expect(raw).not.toContain(SR);
    expect(calls.some((c) => c.url.includes('/rest/v1/luxedge_orders'))).toBe(true);
  });

  it('rejects missing session_id on GET', async () => {
    makeEnv();
    const { server, cap } = res();
    await handler(req('GET', undefined, '/api/checkout'), server);
    expect(cap.status).toBe(400);
  });

  it('reserves inventory ATOMICALLY before creating the Stripe session (metadata carries the reservation id)', async () => {
    const calls = makeEnv();
    const { server, cap } = res();
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1 }], customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(200);
    const reserve = calls.find((c) => c.url.includes('/rest/v1/rpc/reserve_inventory'));
    expect(reserve).toBeTruthy();
    expect(reserve!.body).toMatchObject({ p_product_id: PRODUCT.id, p_quantity: 1 });
    expect(reserve!.body).toHaveProperty('p_expires_at');
    // Reservation happens BEFORE the Stripe session is created.
    const stripeIdx = calls.findIndex((c) => c.url.startsWith('https://api.stripe.com/v1/checkout/sessions') && c.method === 'POST');
    const reserveIdx = calls.findIndex((c) => c.url.includes('/rest/v1/rpc/reserve_inventory'));
    expect(reserveIdx).toBeGreaterThan(-1);
    expect(reserveIdx).toBeLessThan(stripeIdx);
    // Reservation id is passed to Stripe as metadata so the webhook can consume it.
    const stripeBody = String(calls[stripeIdx].body);
    expect(stripeBody).toContain('metadata%5Breservation%5D');
    expect((cap.body as { reservationId: string }).reservationId).toBeTruthy();
  });

  it('fails closed OUT_OF_STOCK (400) with NO Stripe call when stock cannot be reserved, and releases the attempt', async () => {
    const calls = makeEnv({ reserveOk: false });
    const { server, cap } = res();
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1 }], customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { code: string }).code).toBe('OUT_OF_STOCK');
    expect(calls.some((c) => c.url.startsWith('https://api.stripe.com/v1/checkout/sessions') && c.method === 'POST')).toBe(false);
    const controls = (calls as unknown as { controls: { releaseCalls: number } }).controls;
    expect(controls.releaseCalls).toBe(1); // rollback of the failed attempt
  });

  it('releases the reservation when Stripe session creation fails (stock returned immediately)', async () => {
    const calls = makeEnv({ stripeFail: true });
    const { server, cap } = res();
    await handler(req('POST', { items: [{ id: PRODUCT.id, quantity: 1 }], customer: { email: 'a@b.com' } }), server);
    expect(cap.status).toBe(400);
    const controls = (calls as unknown as { controls: { releaseCalls: number } }).controls;
    expect(controls.releaseCalls).toBe(1);
  });
});
