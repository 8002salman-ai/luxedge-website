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

// ----------------------------------------------------------------------------
// Key resolution — env vars FIRST (tests / wrangler secrets), then the admin-
// attached keys stored server-side in Supabase app_settings (`PAYMENT_STRIPE_*`)
// so the owner can configure payments from Admin → Payments without a redeploy.
// Cached for 60s like the CJ key; `resetStripeKeyCache()` invalidates after a
// save/clear so the next call sees the change immediately.
// ----------------------------------------------------------------------------
const APP_SETTINGS = 'PAYMENT_STRIPE';
const CACHE_TTL = 60_000;
let cache: { secretKey: string; webhookSecret: string; ts: number } | null = null;

/** Test-only / admin-save hook: forget the cached resolution. */
export function resetStripeKeyCache(): void {
  cache = null;
}

async function readAppSetting(suffix: string): Promise<string> {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRole) return '';
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${APP_SETTINGS}_${suffix}&select=value`, {
      headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return '';
    const rows = (await res.json()) as Array<{ value?: string }>;
    return rows[0]?.value?.trim() || '';
  } catch {
    return '';
  }
}

async function resolveKeys(): Promise<{ secretKey: string; webhookSecret: string }> {
  const envKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  const envWh = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (envKey && envWh) return { secretKey: envKey, webhookSecret: envWh };
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) return { secretKey: envKey || cache.secretKey, webhookSecret: envWh || cache.webhookSecret };
  const dbSecret = envKey ? '' : await readAppSetting('SECRET_KEY');
  const dbWh = envWh ? '' : await readAppSetting('WEBHOOK_SECRET');
  cache = { secretKey: dbSecret, webhookSecret: dbWh, ts: now };
  return { secretKey: envKey || dbSecret, webhookSecret: envWh || dbWh };
}

/** True when STRIPE_SECRET_KEY is configured via env (test or live). */
export function stripeConfigured(): boolean {
  return !!((process.env.STRIPE_SECRET_KEY || '').trim());
}

/** True when a secret key is configured via env OR the admin-attached app_settings key. */
export async function stripeReady(): Promise<boolean> {
  if (stripeConfigured()) return true;
  await resolveKeys();
  return !!cache?.secretKey;
}

async function secretKey(): Promise<string> {
  return (process.env.STRIPE_SECRET_KEY || '').trim() || (await resolveKeys()).secretKey;
}

async function webhookSecret(): Promise<string> {
  return (process.env.STRIPE_WEBHOOK_SECRET || '').trim() || (await resolveKeys()).webhookSecret;
}

export const STRIPE_SETTING_KEYS = {
  secretKey: `${APP_SETTINGS}_SECRET_KEY`,
  webhookSecret: `${APP_SETTINGS}_WEBHOOK_SECRET`,
} as const;

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
  const authKey = await secretKey();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${authKey}`,
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

/**
 * Create a Stripe-hosted Checkout Session (server-trusted amounts only).
 *
 * TAX IS NOT COMPUTED BY LUXEDGE. `automatic_tax[enabled]=true` makes Stripe
 * collect the shipping address and calculate the applicable tax with Stripe
 * Tax. Luxedge only ever sets the pre-tax goods amounts and shipping; the
 * customer's final total (incl. tax) is decided by Stripe at checkout.
 */
export async function createCheckoutSession(params: {
  lineItems: { name: string; unitAmountCents: number; quantity: number; image?: string }[];
  shippingCents: number;
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

  // Stripe computes tax (never a hard-coded store rate). Address is required
  // for tax + shipping. USA-only for launch (expandable later).
  parts.set('automatic_tax[enabled]', 'true');
  parts.set('shipping_address_collection[allowed_countries][0]', 'US');

  // CARD-ONLY for launch: immediate payment methods only, so
  // checkout.session.completed with payment_status=paid is the normal
  // fulfillment path. The webhook still verifies payment_status and handles
  // async events defensively (they should not occur in card-only mode).
  parts.set('payment_method_types[0]', 'card');

  // Shipping as a proper Stripe shipping option (taxed by Stripe Tax).
  parts.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  parts.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(Math.max(0, Math.round(params.shippingCents))));
  parts.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  parts.set('shipping_options[0][shipping_rate_data][display_name]', 'Standard shipping (7–14 days)');

  for (const [k, v] of Object.entries(params.metadata || {})) {
    parts.set(`metadata[${k}]`, v);
  }
  params.lineItems.forEach((li, i) => {
    parts.set(`line_items[${i}][quantity]`, String(li.quantity));
    parts.set(`line_items[${i}][price_data][currency]`, 'usd');
    parts.set(`line_items[${i}][price_data][unit_amount]`, String(Math.max(1, Math.round(li.unitAmountCents))));
    parts.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
    parts.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.image) parts.set(`line_items[${i}][price_data][product_data][images][0]`, li.image);
  });
  const r = await stripeRequest<CheckoutSessionResult>('/checkout/sessions', { method: 'POST', body: parts.toString() });
  return r;
}

export interface DetailedLineItem {
  id: string;
  description: string | null;
  quantity: number | null;
  price: { unit_amount: number | null } | null;
}

/** Full session with line items + totals — used by the webhook for the REAL purchase snapshot. */
export interface DetailedCheckoutSession extends CheckoutSessionResult {
  amount_subtotal: number;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  shipping_details?: {
    name?: string | null;
    phone?: string | null;
    address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
  } | null;
  total_details?: { amount_discount?: number; amount_shipping?: number; amount_tax?: number } | null;
  payment_intent?: string | null;
  line_items?: { data: DetailedLineItem[] } | null;
}

/**
 * Retrieve a Checkout Session WITH its line items (Stripe-authoritative
 * snapshot: names, unit amounts, quantities) — used only by the webhook.
 */
export async function retrieveCheckoutSessionDetailed(sessionId: string): Promise<StripeResult<DetailedCheckoutSession>> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { ok: false, status: 400, code: 'invalid_session_id', message: 'Invalid checkout session id.' };
  }
  const q = '?expand%5B%5D=line_items.data.price';
  return stripeRequest<DetailedCheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}${q}`);
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
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): Promise<{ ok: true; event: StripeWebhookEvent } | { ok: false; message: string }> {
  const secret = await webhookSecret();
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
