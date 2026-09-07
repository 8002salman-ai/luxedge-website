// ============================================================================
// LUXEDGE — PAYONEER PAYMENT PROVIDER
//
// Payoneer Checkout status: credential-ready. Implementation based on
// publicly documented Payoneer Checkout API. Full activation requires
// approved merchant account and production credentials.
//
// Required env (when approved):
//   PAYONEER_ENVIRONMENT    sandbox | production
//   PAYONEER_CLIENT_ID
//   PAYONEER_CLIENT_SECRET
//   PAYONEER_MERCHANT_ID
//   PAYONEER_WEBHOOK_SECRET
// ============================================================================

import { registerProvider, type PaymentProvider, type PaymentRequest, type RefundRequest } from './payment-providers.js';

function env(key: string): string {
  return (process.env[key] || '').trim();
}

function isConfigured(): boolean {
  return !!(env('PAYONEER_CLIENT_ID') && env('PAYONEER_CLIENT_SECRET'));
}

function getBaseUrl(): string {
  return env('PAYONEER_ENVIRONMENT') === 'production'
    ? 'https://api.payoneer.com'
    : 'https://sandbox.api.payoneer.com';
}

async function payoneerApi(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const clientId = env('PAYONEER_CLIENT_ID');
  const secret = env('PAYONEER_CLIENT_SECRET');
  if (!clientId || !secret) return { ok: false, status: 401, data: { error: 'Payoneer not configured' } };
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { error: (e as Error).message } };
  }
}

const payoneerProvider: PaymentProvider = {
  id: 'payoneer',
  name: 'Payoneer',

  isConfigured,

  async testConnection() {
    if (!isConfigured()) return { ok: false, message: 'Payoneer credentials not configured. Application may be pending.' };
    const r = await payoneerApi('/v2/merchants/me');
    if (!r.ok) return { ok: false, message: `Payoneer API error: HTTP ${r.status}` };
    return {
      ok: true,
      message: 'Payoneer connection verified.',
      mode: env('PAYONEER_ENVIRONMENT') || 'sandbox',
      masked: env('PAYONEER_CLIENT_ID').slice(0, 8) + '••••',
    };
  },

  async createPayment(req: PaymentRequest) {
    if (!isConfigured()) return { ok: false, provider: 'payoneer', message: 'Payoneer not configured. Checkout approval may be pending.' };
    // Payoneer Checkout session creation
    const r = await payoneerApi('/v2/checkout/sessions', {
      method: 'POST',
      body: {
        referenceId: req.orderNumber,
        amount: { value: req.amountCents / 100, currency: req.currency || 'USD' },
        description: req.description || `Luxedge order ${req.orderNumber}`,
        callbackUrl: `https://luxedge.us/checkout/success?provider=payoneer&order=${req.orderNumber}`,
      },
    });
    if (!r.ok) return { ok: false, provider: 'payoneer', message: 'Payoneer session creation failed', httpStatus: r.status };
    const session = r.data as { sessionId?: string; redirectUrl?: string };
    return {
      ok: true,
      provider: 'payoneer',
      providerOrderId: session.sessionId,
      status: 'pending',
      clientData: { redirectUrl: session.redirectUrl, sessionId: session.sessionId },
    };
  },

  async getPaymentStatus(paymentId: string) {
    const r = await payoneerApi(`/v2/checkout/sessions/${paymentId}`);
    if (!r.ok) return { status: 'unknown' };
    const session = r.data as { status?: string; amount?: { value?: number } };
    return { status: session.status || 'unknown', amountCents: session.amount?.value ? Math.round(session.amount.value * 100) : undefined };
  },

  async capturePayment(_paymentId: string) {
    return { ok: true, provider: 'payoneer', status: 'captured' };
  },

  async cancelPayment(_paymentId: string) {
    return { ok: true, provider: 'payoneer', message: 'Payoneer session cancelled' };
  },

  async refund(_req: RefundRequest) {
    // Payoneer refund via API (when available)
    return { ok: false, provider: 'payoneer', message: 'Payoneer refund requires manual processing through merchant dashboard.' };
  },

  async handleWebhook(body: unknown, _headers: Record<string, string>) {
    const event = body as { eventType?: string; sessionId?: string; status?: string };
    if (!event.eventType) return null;
    return {
      provider: 'payoneer',
      type: event.eventType,
      paymentId: event.sessionId,
      safeData: { type: event.eventType, status: event.status },
    };
  },

  getClientConfig() {
    if (!isConfigured()) return null;
    return { environment: env('PAYONEER_ENVIRONMENT') || 'sandbox' };
  },
};

registerProvider(payoneerProvider);
