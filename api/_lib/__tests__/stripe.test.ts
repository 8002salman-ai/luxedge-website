// ============================================================================
// LUXEDGE — STRIPE SERVER HELPER TESTS
//
// All Stripe HTTP is mocked. Verifies: correct Authorization/version headers,
// form-encoded body shape, safe error mapping (never raw Stripe bodies with
// request context), and constant-time webhook signature verification.
// ============================================================================
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formEncode, createCheckoutSession, retrieveCheckoutSession, retrieveCheckoutSessionDetailed, verifyWebhookSignature, stripeConfigured } from '../stripe.js';

const SECRET = 'sk_test_probe_secret';
const WH = 'whsec_probe_webhook_secret';
const original = { secret: process.env.STRIPE_SECRET_KEY, wh: process.env.STRIPE_WEBHOOK_SECRET };

function webhookBody(): string {
  return JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 2500, currency: 'usd' } } });
}

function signWebhook(body: string, secret = WH, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('stripe helper', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = WH;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original.secret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original.secret;
    if (original.wh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = original.wh;
  });

  it('stripeConfigured reflects env presence only', () => {
    expect(stripeConfigured()).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeConfigured()).toBe(false);
  });

  it('formEncode produces an x-www-form-urlencoded body', () => {
    const s = formEncode({ mode: 'payment', 'metadata[items_count]': '2', empty: undefined, n: 5 });
    expect(s).toContain('mode=payment');
    expect(s).toContain('metadata%5Bitems_count%5D=2');
    expect(s).not.toContain('empty');
  });

  it('creates a Checkout Session with automatic tax, address collection and a real shipping option', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers || {}) as Record<string, string>, body: String(init?.body) });
      return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/x', payment_status: 'unpaid', amount_total: 2500, currency: 'usd', customer_email: 'a@b.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const r = await createCheckoutSession({
      lineItems: [{ name: 'Dog Toy', unitAmountCents: 2500, quantity: 1, image: 'https://img/x.jpg' }],
      shippingCents: 499,
      successUrl: 'https://luxedge.us/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://luxedge.us/checkout?cancelled=1',
      customerEmail: 'a@b.com',
      metadata: { ids: 'p1', qtys: '1', coupon: 'none' },
    });
    expect(r.ok).toBe(true);
    const call = calls[0];
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(call.headers['Stripe-Version']).toBeTruthy();
    expect(call.body).toContain('mode=payment');
    // Stripe computes tax — never a hard-coded Luxedge rate.
    expect(call.body).toContain('automatic_tax%5Benabled%5D=true');
    expect(call.body).toContain('shipping_address_collection%5Ballowed_countries%5D%5B0%5D=US');
    expect(call.body).toContain('shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Bfixed_amount%5D%5Bamount%5D=499');
    expect(call.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500');
    expect(call.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Btax_behavior%5D=exclusive');
    expect(call.body).toContain('metadata%5Bids%5D=p1');
    if (r.ok) expect(r.data.id).toBe('cs_test_123');
  });

  it('retrieves a detailed session WITH expanded line items (webhook snapshot source)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        id: 'cs_test_1', payment_status: 'paid', amount_total: 3200, amount_subtotal: 2999, currency: 'usd',
        customer_email: 'a@b.com', payment_intent: 'pi_1',
        total_details: { amount_discount: 0, amount_shipping: 499, amount_tax: 201 },
        line_items: { data: [{ id: 'li_1', description: 'Dog Toy', quantity: 1, price: { unit_amount: 2500 } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const r = await retrieveCheckoutSessionDetailed('cs_test_1');
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain('/checkout/sessions/cs_test_1?');
    expect(calls[0]).toContain('expand%5B%5D=line_items.data.price');
    if (r.ok) {
      expect(r.data.line_items?.data[0].price?.unit_amount).toBe(2500);
      expect(r.data.total_details?.amount_tax).toBe(201);
    }
  });

  it('rejects malformed session ids on detailed retrieval', async () => {
    const r = await retrieveCheckoutSessionDetailed('../../etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_session_id');
  });

  it('maps Stripe auth failures to a safe code — never the raw error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: 'Your API key expired, and communication with the Stripe API has failed.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const r = await createCheckoutSession({ lineItems: [{ name: 'x', unitAmountCents: 100, quantity: 1 }], shippingCents: 0, successUrl: 'u', cancelUrl: 'c' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Stripe's own safe code is preserved; the raw body/message is never
      // forwarded to the client (it may contain request context).
      expect(r.code).toBe('api_key_expired');
      expect(r.message).not.toContain('API key');
    }
  });

  it('retrieveCheckoutSession rejects malformed session ids', async () => {
    const r = await retrieveCheckoutSession('../../etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_session_id');
  });

  describe('webhook signature verification', () => {
    it('accepts a valid signature and returns the parsed event', () => {
      const body = webhookBody();
      const v = verifyWebhookSignature(body, signWebhook(body));
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.event.type).toBe('checkout.session.completed');
    });

    it('rejects a wrong secret', () => {
      const body = webhookBody();
      const v = verifyWebhookSignature(body, signWebhook(body, 'whsec_wrong'));
      expect(v.ok).toBe(false);
    });

    it('rejects a missing or malformed signature header', () => {
      expect(verifyWebhookSignature(webhookBody(), undefined).ok).toBe(false);
      expect(verifyWebhookSignature(webhookBody(), 'garbage').ok).toBe(false);
    });

    it('rejects stale timestamps (replay protection)', () => {
      const body = webhookBody();
      const old = Math.floor(Date.now() / 1000) - 3600;
      const v = verifyWebhookSignature(body, signWebhook(body, WH, old));
      expect(v.ok).toBe(false);
    });
  });
});
