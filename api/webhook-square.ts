// ============================================================================
// LUXEDGE — Square Webhook Handler
//
// Receives payment notifications from Square, verifies signature, and
// reconciles payment state with Luxedge orders. Idempotent: repeated
// webhooks do not create duplicate orders.
//
// SECURITY: Signature verified server-side. Never trust browser callbacks.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';

function supabaseBase(): string { return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''); }
function serviceRole(): string { return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(); }

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

// Square signature verification (HMAC-SHA256)
async function verifySquareSignature(
  body: string,
  signatureHeader: string,
  signatureKey: string,
  url: string,
): Promise<boolean> {
  if (!signatureKey || !signatureHeader) return false;
  try {
    // Square sends: hmacsha256=<base64>
    const parts = Object.fromEntries(signatureHeader.split(';').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), (v || '').trim()];
    }));
    const hmac = parts['hmacsha256'];
    if (!hmac) return false;

    // Compute HMAC of the full URL + body
    const encoder = new TextEncoder();
    const keyData = encoder.encode(signatureKey);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const messageData = encoder.encode(url + body);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return computed === hmac;
  } catch { return false; }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  const squareSig = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';

  // Read raw body for signature verification
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
  if (squareSig) {
    const sigHeader = req.headers['x-square-hmacsha256-signature'] as string || '';
    const url = `https://${req.headers.host || 'luxedge.us'}${req.url || '/api/webhook/square'}`;
    const valid = await verifySquareSignature(rawBody, sigHeader, squareSig, url);
    if (!valid) { sendJson(res, 401, { error: 'Invalid signature' }); return; }
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const event = (body ?? {}) as Record<string, unknown>;
  const eventType = String(event.type || '');
  const eventData = (event.data ?? {}) as Record<string, unknown>;
  const dataObj = (eventData.object ?? {}) as Record<string, unknown>;
  const paymentObj = (dataObj.payment ?? {}) as Record<string, unknown>;
  const paymentId = String(paymentObj.id || '');
  const status = String(paymentObj.status || '');
  const orderNote = String(paymentObj.note || '');

  // Only process completed payments
  if (eventType !== 'payment.completed' && eventType !== 'payment.updated') {
    sendJson(res, 200, { ok: true, ignored: true, eventType });
    return;
  }

  if (!paymentId || status !== 'COMPLETED') {
    sendJson(res, 200, { ok: true, ignored: true, status });
    return;
  }

  // Find the order by Square payment ID (idempotent)
  let r = await restFetch('luxedge_orders',
    `?payment_provider=eq.square&payment_provider_payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`);

  // Fallback: try order_number from note field
  if ((!r.ok || !Array.isArray(r.data) || r.data.length === 0) && orderNote) {
    r = await restFetch('luxedge_orders',
      `?order_number=eq.${encodeURIComponent(orderNote)}&limit=1`);
  }

  if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
    // Order already exists — mark paid if pending
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

  // No matching order found — log for manual review
  console.error('[Square Webhook] No matching order for payment:', paymentId);
  sendJson(res, 200, { ok: true, warning: 'No matching order found', paymentId });
}
