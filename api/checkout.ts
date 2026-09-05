// POST /api/checkout            — create a Stripe-hosted Checkout Session.
//                                 Server recomputes every amount from the
//                                 real catalog (never trusts client prices).
// GET  /api/checkout?session_id=… — real session status for the success page.
// GET  /api/checkout?action=orders — recent persisted orders (admin JWT).
//
// SECURITY:
//   - Only product ids + quantity + coupon code + shipping contact are
//     accepted from the browser. Prices come from Supabase on the server.
//   - No card data ever touches Luxedge (Stripe-hosted Checkout).
//   - No Stripe secrets are returned to the browser.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from './_lib/providers.js';
import { requireAdmin } from './_lib/auth.js';
import { computeCheckoutTotals, validateCheckoutRequest, buildStripeLineItems, appBaseUrl, type CheckoutDataLoader } from './_lib/checkout.js';
import { stripeReady, createCheckoutSession, retrieveCheckoutSession, safeSessionSummary } from './_lib/stripe.js';

interface ServerProductRow {
  id: string;
  slug?: string | null;
  name?: string | null;
  price?: number | null;
  status?: string | null;
  inventory_qty?: number | null;
  image_url?: string | null;
}

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function supabaseAnon(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
}
function serviceRole(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

async function restFetch(table: string, query: string, key: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase();
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

/** Service-role RPC call (inventory reservation functions — migration 0015). */
async function rpcFetch(fn: string, body: Record<string, unknown>, key: string): Promise<{ ok: boolean; status: number; data: { ok?: boolean; reason?: string } | unknown }> {
  const base = supabaseBase();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data: { error: 'rpc rejected' } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

const loader: CheckoutDataLoader = {
  async getProducts(ids) {
    const q = ids.map((i) => `"${i}"`).join(',');
    const r = await restFetch('products', `?id=in.(${q})&select=id,slug,name,price,status,inventory_qty,image_url`, supabaseAnon());
    if (!r.ok || !Array.isArray(r.data)) return [];
    return (r.data as ServerProductRow[]).map((p) => ({
      id: p.id,
      slug: p.slug ?? '',
      name: p.name ?? 'Unnamed product',
      price: typeof p.price === 'number' ? p.price : p.price === null ? null : Number(p.price),
      status: p.status ?? 'draft',
      inventory_qty: p.inventory_qty === null || p.inventory_qty === undefined ? null : Number(p.inventory_qty),
      image_url: p.image_url || null,
    }));
  },
  async getCoupon(code) {
    const r = await restFetch('coupons', `?code=eq.${encodeURIComponent(code)}&select=code,discount_type,discount_value,min_cart_value,is_active,start_at,end_at&limit=1`, supabaseAnon());
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) return null;
    const c = r.data[0] as Record<string, unknown>;
    return {
      code: String(c.code),
      discount_type: c.discount_type === 'fixed' ? 'fixed' : 'percent',
      discount_value: Number(c.discount_value),
      min_cart_value: Number(c.min_cart_value),
      is_active: Boolean(c.is_active),
      start_at: c.start_at ? String(c.start_at) : null,
      end_at: c.end_at ? String(c.end_at) : null,
    };
  },
  async getFreeShippingSettings() {
    const r = await restFetch('store_settings', `?key=eq.free_shipping&select=value&limit=1`, supabaseAnon());
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) return {};
    const v = (r.data[0] as { value?: Record<string, unknown> }).value || {};
    return {
      freeShippingEnabled: Boolean(v.freeShippingEnabled),
      freeShippingThreshold: typeof v.freeShippingThreshold === 'number' ? v.freeShippingThreshold : Number(v.freeShippingThreshold) || 0,
    };
  },
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  // -------------------------------------------------------------------------
  // GET — probe (server is the authority on whether payment is configured)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && url.searchParams.get('probe') === '1') {
    sendJson(res, 200, { configured: await stripeReady() });
    return;
  }

  // -------------------------------------------------------------------------
  // GET — admin order list (authoritative persisted orders)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && url.searchParams.get('action') === 'orders') {
    if (!(await requireAdmin(req, res))) return;
    const key = serviceRole();
    const r = await restFetch('luxedge_orders', '?order=created_at.desc&limit=50', key);
    if (!r.ok) { sendJson(res, r.status, r.data); return; }
    sendJson(res, 200, { orders: r.data });
    return;
  }

  // -------------------------------------------------------------------------
  // GET — session / order status for the success page (public, safe summary)
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    const sessionId = (url.searchParams.get('session_id') || '').trim();
    if (!sessionId) { sendJson(res, 400, { error: 'Missing session_id parameter.' }); return; }
    if (!(await stripeReady())) { sendJson(res, 503, { error: 'Payment is not configured yet on this deployment.' }); return; }
    const session = await retrieveCheckoutSession(sessionId);
    if (!session.ok) { sendJson(res, session.status, { error: session.message }); return; }
    // Look up the persisted order for this session (service role) — real status.
    const key = serviceRole();
    const o = await restFetch('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=order_number,status,total,currency,customer_email&limit=1`, key);
    const order = o.ok && Array.isArray(o.data) && o.data.length ? (o.data[0] as Record<string, unknown>) : null;
    sendJson(res, 200, {
      session: safeSessionSummary(session.data),
      order: order
        ? { orderNumber: order.order_number, status: order.status, total: order.total, currency: order.currency, customerEmail: order.customer_email }
        : null,
    });
    return;
  }

  // -------------------------------------------------------------------------
  // POST — create the Stripe Checkout Session
  // -------------------------------------------------------------------------
  if (!(await stripeReady())) {
    sendJson(res, 503, { error: 'Payment is not configured yet on this deployment. The store owner needs to add Stripe keys.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const parsed = validateCheckoutRequest(body);
  if (!parsed.ok) { sendJson(res, 400, { error: parsed.message }); return; }

  const decision = await computeCheckoutTotals(loader, parsed.request);
  if (!decision.ok) { sendJson(res, decision.status, { error: decision.message, code: decision.code }); return; }

  const { totals } = decision;
  const base = appBaseUrl(req);
  const key = serviceRole();

  // -------------------------------------------------------------------------
  // REAL INVENTORY RESERVATION (migration 0015) — reduce available stock
  // ATOMICALLY BEFORE the customer is redirected to Stripe, so two customers
  // can never both pay for the last unit. Released on Stripe failure below,
  // and by the webhook on expiry / async-payment failure.
  // -------------------------------------------------------------------------
  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // matches Stripe Checkout's 24h session expiry
  for (const line of totals.lines) {
    const r = await rpcFetch('reserve_inventory', {
      p_reservation_id: reservationId,
      p_product_id: line.id,
      p_quantity: line.quantity,
      p_expires_at: expiresAt,
    }, key);
    const v = (r.data ?? {}) as { ok?: boolean; reason?: string };
    if (!r.ok || v.ok !== true) {
      // Roll back whatever was reserved for this attempt, then fail closed.
      await rpcFetch('release_reservation', { p_reservation_id: reservationId }, key).catch(() => null);
      sendJson(res, 400, { error: 'Some items in your cart are no longer available in stock. Please review your cart.', code: 'OUT_OF_STOCK' });
      return;
    }
  }

  // Compact, bounded snapshot for the webhook: product ids + quantities only
  // (Stripe metadata values are capped at 500 chars; carts are capped at 10
  // distinct products). The webhook joins these with Stripe's authoritative
  // line items for the persisted purchase snapshot.
  const metadata: Record<string, string> = {
    ids: totals.lines.map((l) => l.id).join(','),
    qtys: totals.lines.map((l) => String(l.quantity)).join(','),
    coupon: totals.couponCode || 'none',
    reservation: reservationId,
  };

  const session = await createCheckoutSession({
    lineItems: buildStripeLineItems(totals).map((li) => ({ name: li.name, unitAmountCents: li.unitAmountCents, quantity: li.quantity, image: li.imageUrl || undefined })),
    shippingCents: Math.round(totals.shipping * 100),
    successUrl: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/checkout?cancelled=1`,
    customerEmail: parsed.request.customer?.email || undefined,
    metadata,
  });
  if (!session.ok) {
    // The customer never reached Stripe — return the held stock immediately.
    await rpcFetch('release_reservation', { p_reservation_id: reservationId }, key).catch(() => null);
    sendJson(res, session.status, { error: session.message, code: session.code });
    return;
  }

  sendJson(res, 200, {
    url: session.data.url,
    sessionId: session.data.id,
    reservationId,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      tax: totals.tax, // 0 — Stripe automatic tax computes the real amount at checkout
      total: totals.total, // pre-tax total; Stripe adds tax on top
      currency: totals.currency,
      freeShippingApplied: totals.freeShippingApplied,
      couponCode: totals.couponCode,
      taxHandledByProvider: totals.taxHandledByProvider,
    },
  });
}
