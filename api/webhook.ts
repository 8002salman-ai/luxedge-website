// POST /api/webhook — Stripe webhook (Stripe calls this server-to-server).
//
// Handles checkout.session.completed by persisting the order into
// luxedge_orders (migration 0013) with the service-role key. Idempotent:
// luxedge_orders.stripe_session_id is UNIQUE, so a replayed webhook simply
// finds the existing row and returns 200 — never a duplicate order.
//
// SECURITY:
//   - Verifies the Stripe signature (constant-time HMAC) against
//     STRIPE_WEBHOOK_SECRET. Invalid signatures → 400.
//   - The browser can NEVER mark an order paid; only this endpoint (called
//     by Stripe with a valid signature) can flip a payment to paid.
//   - No card data is stored. Amounts come from Stripe's own session
//     object (which was created from server-verified totals).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';
import { verifyWebhookSignature } from './_lib/stripe.js';

function serviceRole(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}

function readRawBody(req: IncomingMessage, maxBytes = 200_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function restInsert(table: string, row: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase();
  const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const res = await fetch(`${base}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data: { error: 'database request rejected', rawStatus: res.status } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

async function restSelect(table: string, query: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase();
  const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data: { error: 'database request rejected' } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

function orderNumberFromSession(sessionId: string): string {
  const short = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `LX-${short}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  const rawBody = await readRawBody(req).catch(() => '');
  const sig = req.headers['stripe-signature'] as string | undefined;
  const verified = verifyWebhookSignature(rawBody, sig);
  if (!verified.ok) {
    sendJson(res, 400, { error: verified.message });
    return;
  }

  const { event } = verified;
  const obj = event.data?.object;
  if (!obj?.id) { sendJson(res, 400, { error: 'Malformed webhook event.' }); return; }

  // Only completion matters for order creation. Other events are acked.
  if (event.type !== 'checkout.session.completed') {
    sendJson(res, 200, { received: true, ignored: event.type });
    return;
  }

  const sessionId = obj.id;

  // Idempotency: a unique stripe_session_id means a replay finds the row.
  const existing = await restSelect('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=id&limit=1`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    sendJson(res, 200, { received: true, duplicate: true });
    return;
  }

  const amountTotal = Number(obj.amount_total ?? 0) / 100;
  const currency = (obj.currency || 'usd').toLowerCase();
  const itemsCount = Number(obj.metadata?.items_count || 1);

  const row = {
    order_number: orderNumberFromSession(sessionId),
    customer_email: obj.customer_email || null,
    items: [{ sessionId, itemsCount, currency }],
    total: amountTotal,
    currency,
    status: 'paid',
    stripe_session_id: sessionId,
    stripe_payment_intent: obj.payment_intent || null,
  };

  const inserted = await restInsert('luxedge_orders', row);
  if (!inserted.ok) {
    // 23505 = unique violation (race with a concurrent duplicate webhook) —
    // treat as already handled, never fail the webhook retry loop.
    const raw = inserted.data as { rawStatus?: number; error?: string };
    if (raw.rawStatus === 409 || raw.rawStatus === 400) {
      sendJson(res, 200, { received: true, duplicate: true });
      return;
    }
    sendJson(res, inserted.status, { error: inserted.data });
    return;
  }
  sendJson(res, 200, { received: true, orderNumber: row.order_number });
}
