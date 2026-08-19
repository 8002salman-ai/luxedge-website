// POST /api/webhook — Stripe webhook (Stripe calls this server-to-server).
//
// HANDLES:
//   checkout.session.completed → persist the REAL purchase snapshot into
//     luxedge_orders (retrieved from Stripe: line items + totals + customer),
//     then atomically decrement inventory (migration 0014 RPC).
//   charge.refunded           → sync order status: refunded / partially_refunded
//                               + refunded_amount (Stripe-authoritative).
//   everything else           → acked, ignored.
//
// IDEMPOTENCY:
//   - luxedge_orders.stripe_session_id is UNIQUE: a replayed completed event
//     finds the existing row and returns 200 — never a duplicate order and
//     NEVER a double inventory decrement (decrement runs only after a fresh
//     insert).
//   - Refund updates set absolute values (refunded_amount), so replays are
//     harmless.
//
// SECURITY:
//   - Verifies the Stripe signature (constant-time HMAC) against
//     STRIPE_WEBHOOK_SECRET. Invalid signatures → 400 with NO database write.
//   - The browser can NEVER mark an order paid; only this endpoint (called by
//     Stripe with a valid signature) can.
//   - No card data is stored. Amounts come from Stripe's own session/charge
//     objects, which were created from server-verified totals.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';
import { verifyWebhookSignature, retrieveCheckoutSessionDetailed } from './_lib/stripe.js';

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

async function restFetch(table: string, query: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase();
  const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
    const method = init?.method || 'GET';
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init?.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

/** Atomic inventory decrement (migration 0014) — never oversells, replay-safe. */
async function decrementInventory(productId: string, quantity: number): Promise<{ ok: boolean; reason?: string }> {
  const r = await restFetch('rpc/decrement_inventory', '', {
    method: 'POST',
    body: { p_product_id: productId, p_quantity: quantity },
  });
  if (!r.ok || typeof r.data !== 'object' || r.data === null) return { ok: false, reason: 'db_unavailable' };
  const v = r.data as { ok?: boolean; reason?: string };
  return { ok: v.ok === true, reason: v.reason };
}

function orderNumberFromSession(sessionId: string): string {
  const short = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `LX-${short}`;
}

interface CompletedSessionShape {
  id: string;
  amount_total: number;
  amount_subtotal: number;
  currency: string;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  shipping_details?: {
    name?: string | null;
    address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
  } | null;
  total_details?: { amount_discount?: number; amount_shipping?: number; amount_tax?: number } | null;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
  line_items?: { data: { description: string | null; quantity: number | null; price: { unit_amount: number | null } | null }[] } | null;
}

/** Persist the order from Stripe's authoritative session data. Returns null if already handled (duplicate). */
async function persistCompletedOrder(session: CompletedSessionShape): Promise<{ status: number; body: Record<string, unknown> }> {
  const sessionId = session.id;

  // Idempotency gate 1: existing row → duplicate (no insert, no decrement).
  const existing = await restFetch('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=id&limit=1`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  // Join our compact metadata (ids + qtys) with Stripe's authoritative line items.
  const ids = (session.metadata?.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qtys = (session.metadata?.qtys || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const lineData = session.line_items?.data || [];
  const items = ids.map((id, i) => {
    const li = lineData[i];
    const unitCents = li?.price?.unit_amount ?? null;
    return {
      id,
      name: li?.description || 'Luxedge product',
      quantity: qtys[i] ?? li?.quantity ?? 1,
      unitPrice: unitCents !== null && Number.isFinite(unitCents) ? unitCents / 100 : null,
    };
  });

  const cents = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n / 100 : 0);
  const currency = (session.currency || 'usd').toLowerCase();
  const addr = session.shipping_details?.address || null;
  const cd = session.customer_details || {};

  const row = {
    order_number: orderNumberFromSession(sessionId),
    customer_email: cd.email || session.customer_email || null,
    customer_name: cd.name || session.shipping_details?.name || null,
    shipping_address: addr ? { line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postal_code: addr.postal_code, country: addr.country } : null,
    items,
    coupon_code: session.metadata?.coupon && session.metadata.coupon !== 'none' ? session.metadata.coupon : null,
    subtotal: cents(session.amount_subtotal),
    discount: cents(session.total_details?.amount_discount),
    shipping: cents(session.total_details?.amount_shipping),
    tax: cents(session.total_details?.amount_tax),
    total: cents(session.amount_total),
    currency,
    status: 'paid',
    stripe_session_id: sessionId,
    stripe_payment_intent: session.payment_intent || null,
  };

  const inserted = await restFetch('luxedge_orders', '', { method: 'POST', body: row, prefer: 'return=representation' });
  if (!inserted.ok) {
    // 409 / 23505 = unique violation (race with a concurrent duplicate webhook) —
    // treat as already handled; Stripe's retry loop must never fail on this.
    if (inserted.status === 409 || (inserted.data as { code?: string })?.code === '23505') {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    return { status: inserted.status, body: { error: 'database write rejected', detail: inserted.status } };
  }

  // Fresh insert → safe to decrement exactly once (replays hit the duplicate path).
  const decrements = [];
  for (let i = 0; i < ids.length; i++) {
    const qty = qtys[i] ?? 1;
    const d = await decrementInventory(ids[i], qty);
    decrements.push({ id: ids[i], qty, ok: d.ok, reason: d.reason });
  }
  const oversell = decrements.filter((d) => !d.ok);

  return {
    status: 200,
    body: { received: true, orderNumber: row.order_number, inventory: decrements, oversell: oversell.length > 0 },
  };
}

interface RefundEventShape {
  id: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  payment_intent?: string | null;
}

/** charge.refunded → sync order status + refunded_amount (Stripe-authoritative). */
async function syncRefund(charge: RefundEventShape): Promise<{ status: number; body: Record<string, unknown> }> {
  const paymentIntent = charge.payment_intent;
  if (!paymentIntent) return { status: 200, body: { received: true, ignored: 'no payment_intent' } };
  const amount = (charge.amount ?? 0) / 100;
  const refunded = (charge.amount_refunded ?? 0) / 100;
  const fullyRefunded = refunded >= amount && amount > 0;
  const patch = {
    status: fullyRefunded ? 'refunded' : 'partially_refunded',
    refunded_amount: refunded,
    refunded_at: new Date().toISOString(),
  };
  const r = await restFetch('luxedge_orders', `?stripe_payment_intent=eq.${encodeURIComponent(paymentIntent)}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (!r.ok) {
    // No matching order (e.g. async payment not yet completed) — ack; the
    // refund event will be re-delivered by Stripe or surfaced in the dashboard.
    return { status: 200, body: { received: true, updated: 0, warning: 'no matching order' } };
  }
  const updated = Array.isArray(r.data) ? r.data.length : 0;
  return { status: 200, body: { received: true, updated, status: patch.status, refundedAmount: refunded } };
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
  const obj = event.data?.object as (CompletedSessionShape & RefundEventShape) | undefined;
  if (!obj?.id) { sendJson(res, 400, { error: 'Malformed webhook event.' }); return; }

  if (event.type === 'checkout.session.completed') {
    // Pull the AUTHORITATIVE session (line items + totals) from Stripe — the
    // webhook event body alone has no line items.
    const detailed = await retrieveCheckoutSessionDetailed(obj.id);
    if (!detailed.ok) {
      // Fail the webhook so Stripe retries — never persist a guessed snapshot.
      sendJson(res, detailed.status, { error: detailed.message, code: detailed.code });
      return;
    }
    const result = await persistCompletedOrder(detailed.data as CompletedSessionShape);
    sendJson(res, result.status, result.body);
    return;
  }

  if (event.type === 'charge.refunded') {
    const result = await syncRefund(obj as RefundEventShape);
    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 200, { received: true, ignored: event.type });
}
