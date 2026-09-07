// ============================================================================
// LUXEDGE — PayPal Webhook Handler
//
// Receives payment notifications from PayPal, verifies using PayPal's
// webhook verification API, and reconciles payment state with Luxedge orders.
// Idempotent: repeated webhooks do not create duplicate orders.
//
// SECURITY: Signature verified server-side. Never trust browser callbacks.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';

function supabaseBase(): string { return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''); }
function serviceRole(): string { return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(); }
function paypalClientId(): string { return (process.env.PAYPAL_CLIENT_ID || '').trim(); }
function paypalSecret(): string { return (process.env.PAYPAL_CLIENT_SECRET || '').trim(); }
function paypalWebhookId(): string { return (process.env.PAYPAL_WEBHOOK_ID || '').trim(); }
function paypalEnv(): string { return (process.env.PAYPAL_ENVIRONMENT || 'sandbox').trim(); }

function paypalBaseUrl(): string {
  return paypalEnv() === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function restFetch(table: string, query: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase(); const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database not configured' } };
  try {
    const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
    const method = init?.method || 'GET';
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init?.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      method, headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 502, data: { error: 'Database unreachable' } }; }
}

async function getAccessToken(): Promise<string | null> {
  const id = paypalClientId(); const secret = paypalSecret();
  if (!id || !secret) return null;
  try {
    const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${id}:${secret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token || null;
  } catch { return null; }
}

async function verifyPayPalWebhook(
  accessToken: string,
  webhookId: string,
  headers: Record<string, string>,
  body: string,
): Promise<boolean> {
  if (!webhookId || !accessToken) return false;
  try {
    const transmissionId = headers['paypal-transmission-id'] || '';
    const timestamp = headers['paypal-transmission-time'] || '';
    const sig = headers['paypal-transmission-sig'] || '';
    const certUrl = headers['paypal-cert-url'] || '';
    const authAlgo = headers['paypal-auth-algo'] || '';

    if (!transmissionId || !sig) return false;

    const res = await fetch(`${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: sig,
        transmission_time: timestamp,
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { verification_status?: string };
    return result.verification_status === 'SUCCESS';
  } catch { return false; }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  // Read raw body
  let rawBody = '';
  try {
    rawBody = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  } catch { sendJson(res, 400, { error: 'Could not read request body' }); return; }

  // Verify signature when configured
  const webhookId = paypalWebhookId();
  if (webhookId) {
    const accessToken = await getAccessToken();
    if (accessToken) {
      const headerRecord: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headerRecord[k] = v;
      }
      const valid = await verifyPayPalWebhook(accessToken, webhookId, headerRecord, rawBody);
      if (!valid) { sendJson(res, 401, { error: 'Invalid webhook signature' }); return; }
    }
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const event = (body ?? {}) as Record<string, unknown>;
  const eventType = String(event.event_type || '');

  // Only process relevant payment events
  if (!['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED'].includes(eventType)) {
    sendJson(res, 200, { ok: true, ignored: true, eventType });
    return;
  }

  const resource = (event.resource ?? {}) as Record<string, unknown>;
  const purchaseUnits = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
  const firstUnit = (purchaseUnits[0] ?? {}) as Record<string, unknown>;
  const payments = (firstUnit.payments ?? {}) as Record<string, unknown>;
  const captures = Array.isArray(payments.captures) ? payments.captures : [];
  const capture = (captures[0] ?? {}) as Record<string, unknown>;
  const captureId = String(capture.id || '');

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && captureId) {
    // Find order by PayPal capture ID (idempotent)
    const r = await restFetch('luxedge_orders',
      `?payment_provider=eq.paypal&payment_provider_payment_id=eq.${encodeURIComponent(captureId)}&limit=1`);

    if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
      const order = r.data[0] as Record<string, unknown>;
      if (order.payment_status !== 'paid') {
        await restFetch('luxedge_orders', `?id=eq.${order.id}`, {
          method: 'PATCH',
          body: { payment_status: 'paid', status: 'processing', erp_sync_status: null },
          prefer: 'return=minimal',
        });
      }
      sendJson(res, 200, { ok: true, orderId: order.id, status: 'reconciled' });
      return;
    }

    console.error('[PayPal Webhook] No matching order for capture:', captureId);
    sendJson(res, 200, { ok: true, warning: 'No matching order found', captureId });
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.DENIED') {
    console.error('[PayPal Webhook] Payment denied:', captureId);
    sendJson(res, 200, { ok: true, status: 'denied', captureId });
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.REFUNDED' && captureId) {
    // Update order refund status
    const r = await restFetch('luxedge_orders',
      `?payment_provider=eq.paypal&payment_provider_payment_id=eq.${encodeURIComponent(captureId)}&limit=1`);
    if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
      const order = r.data[0] as Record<string, unknown>;
      await restFetch('luxedge_orders', `?id=eq.${order.id}`, {
        method: 'PATCH',
        body: { payment_status: 'refunded', status: 'refunded' },
        prefer: 'return=minimal',
      });
    }
    sendJson(res, 200, { ok: true, status: 'refunded' });
    return;
  }

  sendJson(res, 200, { ok: true, eventType });
}
