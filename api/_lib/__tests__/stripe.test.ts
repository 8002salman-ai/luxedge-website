// ============================================================================
// LUXEDGE — STRIPE SERVER HELPER TESTS
//
// All Stripe HTTP is mocked. Verifies: correct Authorization/version headers,
// form-encoded body shape, safe error mapping (never raw Stripe bodies with
// request context), and constant-time webhook signature verification.
// ============================================================================
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formEncode, createCheckoutSession, retrieveCheckoutSession, verifyWebhookSignature, stripeConfigured } from '../stripe.js';

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

  it('creates a Checkout Session with the secret key and correct shape', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers || {}) as Record<string, string>, body: String(init?.body) });
      return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/x', payment_status: 'unpaid', amount_total: 2500, currency: 'usd', customer_email: 'a@b.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const r = await createCheckoutSession({
      lineItems: [{ name: 'Luxedge order', unitAmountCents: 2500, quantity: 1 }],
      successUrl: 'https://luxedge.us/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://luxedge.us/checkout?cancelled=1',
      customerEmail: 'a@b.com',
      metadata: { items_count: '1', coupon: 'none' },
    });
    expect(r.ok).toBe(true);
    const call = calls[0];
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(call.headers['Stripe-Version']).toBeTruthy();
    expect(call.body).toContain('mode=payment');
    expect(call.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500');
    expect(call.body).toContain('metadata%5Bitems_count%5D=1');
    if (r.ok) expect(r.data.id).toBe('cs_test_123');
  });

  it('maps Stripe auth failures to a safe code — never the raw error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: 'Your API key expired, and communication with the Stripe API has failed.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const r = await createCheckoutSession({ lineItems: [{ name: 'x', unitAmountCents: 100, quantity: 1 }], successUrl: 'u', cancelUrl: 'c' });
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
