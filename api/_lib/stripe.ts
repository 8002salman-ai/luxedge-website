// ============================================================================
// LUXEDGE — SERVER-SIDE STRIPE HELPER (raw REST, no SDK)
//
// Runs ONLY inside /api serverless functions. The Stripe secret key and
// webhook secret are read exclusively from environment variables and are
// never returned to the browser, never logged, never persisted.
//
// The client only ever receives a Stripe-hosted Checkout URL / session id.
// Prices are always computed SERVER-SIDE from the Luxedge catalog — the
// client cannot influence the charged amount (see api/checkout.ts).
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.stripe.com/v1';

/** True when STRIPE_SECRET_KEY is configured (test or live). */
export function stripeConfigured(): boolean {
  return !!((process.env.STRIPE_SECRET_KEY || '').trim());
}

function secretKey(): string {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

function webhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

/** application/x-www-form-urlencoded body for the Stripe REST API. */
export function formEncode(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export interface StripeErrorResult {
  ok: false;
  status: number;
  code: string;      // safe error code (e.g. 'stripe_error')
  message: string;   // safe message — never raw Stripe bodies (may contain request context)
}

export type StripeResult<T> = { ok: true; data: T } | StripeErrorResult;

async function stripeRequest<T>(path: string, init?: { method?: string; body?: string }): Promise<StripeResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body: init?.body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = (data as { error?: { type?: string; code?: string; message?: string } })?.error;
      const code = err?.code || (res.status === 401 ? 'stripe_auth_failed' : 'stripe_error');
      const message = err?.type
        ? `Payment provider rejected the request (${err.type}).`
        : `Payment provider error (HTTP ${res.status}).`;
      return { ok: false, status: res.status, code, message };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 502, code: 'stripe_unreachable', message: 'Payment provider is unreachable right now.' };
  }
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
  payment_status: string;
  amount_total: number;
  currency: string;
  customer_email: string | null;
  metadata?: Record<string, string> | null;
}

/** Create a Stripe-hosted Checkout Session (server-trusted amounts only). */
export async function createCheckoutSession(params: {
  lineItems: { name: string; unitAmountCents: number; quantity: number; image?: string }[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}): Promise<StripeResult<CheckoutSessionResult>> {
  const parts = new URLSearchParams();
  parts.set('mode', 'payment');
  parts.set('success_url', params.successUrl);
  parts.set('cancel_url', params.cancelUrl);
  if (params.customerEmail) parts.set('customer_email', params.customerEmail);
  for (const [k, v] of Object.entries(params.metadata || {})) {
    parts.set(`metadata[${k}]`, v);
  }
  params.lineItems.forEach((li, i) => {
    parts.set(`line_items[${i}][quantity]`, String(li.quantity));
    parts.set(`line_items[${i}][price_data][currency]`, 'usd');
    parts.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(li.unitAmountCents)));
    parts.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.image) parts.set(`line_items[${i}][price_data][product_data][images][0]`, li.image);
  });
  const r = await stripeRequest<CheckoutSessionResult>('/checkout/sessions', { method: 'POST', body: parts.toString() });
  return r;
}

/** Retrieve a Checkout Session (used by the success page — real status only). */
export async function retrieveCheckoutSession(sessionId: string): Promise<StripeResult<CheckoutSessionResult>> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { ok: false, status: 400, code: 'invalid_session_id', message: 'Invalid checkout session id.' };
  }
  return stripeRequest<CheckoutSessionResult>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Verify a Stripe webhook signature (HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the webhook secret; constant-time compare).
 * Returns the parsed event payload or a safe failure.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): { ok: true; event: StripeWebhookEvent } | { ok: false; message: string } {
  const secret = webhookSecret();
  if (!secret) return { ok: false, message: 'Stripe webhook is not configured on this deployment.' };
  if (!signatureHeader) return { ok: false, message: 'Missing stripe-signature header.' };
  const parts = signatureHeader.split(',').map((p) => p.trim());
  let timestamp = '';
  let signature = '';
  for (const p of parts) {
    if (p.startsWith('t=')) timestamp = p.slice(2);
    if (p.startsWith('v1=')) signature = p.slice(3);
  }
  if (!timestamp || !signature) return { ok: false, message: 'Malformed stripe-signature header.' };
  // Tolerate small clock drift (±5 min) but reject clearly stale replays.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return { ok: false, message: 'Webhook timestamp is outside the tolerance window.' };
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, message: 'Invalid webhook signature.' };
  }
  try {
    const event = JSON.parse(rawBody) as StripeWebhookEvent;
    return { ok: true, event };
  } catch {
    return { ok: false, message: 'Webhook payload is not valid JSON.' };
  }
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      customer_email?: string | null;
      payment_intent?: string | null;
      metadata?: Record<string, string> | null;
    };
  };
}

/** Safe structured summary for the success page (never secrets). */
export function safeSessionSummary(r: CheckoutSessionResult): Record<string, unknown> {
  return {
    id: r.id,
    paymentStatus: r.payment_status,
    amountTotal: r.amount_total,
    currency: r.currency,
    customerEmail: r.customer_email,
  };
}
