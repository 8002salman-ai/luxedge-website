// ============================================================================
// LUXEDGE — SERVER-SIDE CHECKOUT MATH (authoritative pricing)
//
// The browser NEVER submits prices. It submits { productId, quantity } +
// a coupon code + shipping contact. THIS module re-reads the catalog from
// Supabase, validates every item (exists, sellable status, stock), applies
// the coupon and free-shipping rule from the store settings, and computes
// the chargeable total. Stripe then charges exactly this server-computed
// amount.
//
// Pure functions here are unit-tested (price tampering, coupon math,
// shipping threshold) with a mocked data loader.
// ============================================================================

import type { IncomingMessage } from 'node:http';

export const DEFAULT_SHIPPING_RATE = 4.99;
export const TAX_RATE = 0.0825; // TX 8.25% estimate — matches the storefront cart display

export interface CheckoutItemInput {
  id: string;
  quantity: number;
}

export interface CheckoutRequest {
  items: CheckoutItemInput[];
  couponCode?: string;
  customer?: { email?: string; name?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string };
}

export interface ServerProduct {
  id: string;
  slug: string;
  name: string;
  price: number | null;
  status: string;
  inventory_qty: number | null;
  image_url?: string | null;
}

export interface ServerCoupon {
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_cart_value: number;
  is_active: boolean;
  start_at: string | null;
  end_at: string | null;
}

export interface FreeShippingSettings {
  freeShippingEnabled?: boolean;
  freeShippingThreshold?: number;
}

export interface CheckoutLine {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  imageUrl: string | null;
}

export interface CheckoutTotals {
  lines: CheckoutLine[];
  subtotal: number;
  discount: number;
  discountType: 'percent' | 'fixed' | null;
  couponCode: string | null;
  discountedSubtotal: number;
  shipping: number;
  freeShippingApplied: boolean;
  tax: number;
  total: number;
  currency: 'USD';
}

export interface CheckoutError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type CheckoutDecision = { ok: true; totals: CheckoutTotals; products: ServerProduct[] } | CheckoutError;

export interface CheckoutDataLoader {
  getProducts(ids: string[]): Promise<ServerProduct[]>;
  getCoupon(code: string): Promise<ServerCoupon | null>;
  getFreeShippingSettings(): Promise<FreeShippingSettings>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateCheckoutRequest(body: unknown): { ok: true; request: CheckoutRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Invalid request body.' };
  const b = body as Record<string, unknown>;
  const rawItems = b.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return { ok: false, message: 'Your cart is empty.' };
  if (rawItems.length > 50) return { ok: false, message: 'Too many items in the cart.' };
  const items: CheckoutItemInput[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id.trim() : '';
    const qty = typeof it.quantity === 'number' ? Math.floor(it.quantity) : Number(it.quantity);
    if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) return { ok: false, message: 'Invalid product id in cart.' };
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return { ok: false, message: 'Invalid quantity in cart.' };
    if (seen.has(id)) return { ok: false, message: 'Duplicate product in cart.' };
    seen.add(id);
    items.push({ id, quantity: qty });
  }
  const couponCode = typeof b.couponCode === 'string' && b.couponCode.trim() ? b.couponCode.trim().toUpperCase().slice(0, 40) : undefined;
  const c = (b.customer ?? {}) as Record<string, unknown>;
  const customer = {
    email: typeof c.email === 'string' ? c.email.trim().slice(0, 200) : undefined,
    name: typeof c.name === 'string' ? c.name.trim().slice(0, 200) : undefined,
    phone: typeof c.phone === 'string' ? c.phone.trim().slice(0, 40) : undefined,
    address: typeof c.address === 'string' ? c.address.trim().slice(0, 300) : undefined,
    city: typeof c.city === 'string' ? c.city.trim().slice(0, 120) : undefined,
    state: typeof c.state === 'string' ? c.state.trim().slice(0, 2) : undefined,
    zip: typeof c.zip === 'string' ? c.zip.trim().slice(0, 10) : undefined,
  };
  if (customer.email && !customer.email.includes('@')) return { ok: false, message: 'A valid email is required for the order.' };
  return { ok: true, request: { items, couponCode, customer } };
}

function couponDiscount(coupon: ServerCoupon, subtotal: number): number {
  // Minimum cart value applies to BOTH percent and fixed coupons: below the
  // minimum, no discount (a percent coupon cannot silently bypass it).
  if (subtotal < coupon.min_cart_value) return 0;
  if (coupon.discount_type === 'percent') {
    return round2((Math.max(0, subtotal) * coupon.discount_value) / 100);
  }
  return Math.min(subtotal, coupon.discount_value);
}

function couponIsLive(coupon: ServerCoupon): { ok: true } | { ok: false; reason: string } {
  if (!coupon.is_active) return { ok: false, reason: 'This coupon is no longer active.' };
  const now = Date.now();
  if (coupon.start_at && new Date(coupon.start_at).getTime() > now) return { ok: false, reason: 'This coupon is not active yet.' };
  if (coupon.end_at && new Date(coupon.end_at).getTime() < now) return { ok: false, reason: 'This coupon has expired.' };
  return { ok: true };
}

/**
 * Compute authoritative totals. `loader` reads the real catalog/settings.
 * Every rule here is server-side; the client cannot override amounts.
 */
export async function computeCheckoutTotals(loader: CheckoutDataLoader, request: CheckoutRequest): Promise<CheckoutDecision> {
  const ids = request.items.map((i) => i.id);
  const products = await loader.getProducts(ids);

  const lines: CheckoutLine[] = [];
  for (const item of request.items) {
    const p = products.find((x) => x.id === item.id);
    if (!p) return { ok: false, status: 400, code: 'PRODUCT_NOT_FOUND', message: 'An item in your cart is no longer available.' };
    if (p.status !== 'active' && p.status !== 'published') {
      return { ok: false, status: 400, code: 'PRODUCT_UNAVAILABLE', message: `"${p.name}" is no longer available for purchase.` };
    }
    if (p.price === null || p.price === undefined || p.price <= 0) {
      return { ok: false, status: 400, code: 'PRICE_UNAVAILABLE', message: `"${p.name}" has no listed price.` };
    }
    if (p.inventory_qty !== null && p.inventory_qty !== undefined && p.inventory_qty <= 0) {
      return { ok: false, status: 400, code: 'OUT_OF_STOCK', message: `"${p.name}" is out of stock.` };
    }
    const unitPrice = Number(p.price);
    lines.push({
      id: p.id,
      name: p.name,
      unitPrice,
      quantity: item.quantity,
      lineTotal: round2(unitPrice * item.quantity),
      imageUrl: p.image_url || null,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  // Coupon — validated against the live table, never client-supplied math.
  let discount = 0;
  let discountType: 'percent' | 'fixed' | null = null;
  let couponCode: string | null = null;
  if (request.couponCode) {
    const coupon = await loader.getCoupon(request.couponCode);
    if (!coupon) return { ok: false, status: 400, code: 'COUPON_INVALID', message: 'That coupon code is not valid.' };
    const live = couponIsLive(coupon);
    if (!live.ok) return { ok: false, status: 400, code: 'COUPON_INVALID', message: live.reason };
    // A discount can never exceed the order value (no negative subtotal).
    discount = Math.min(couponDiscount(coupon, subtotal), subtotal);
    discountType = coupon.discount_type;
    couponCode = coupon.code;
  }

  const discountedSubtotal = round2(Math.max(0, subtotal - discount));

  // Shipping — free over the configured threshold (store_settings), else flat
  // rate. The threshold applies to the RAW subtotal (matches the storefront
  // "Free Shipping $50+" claim and the cart display).
  const settings = await loader.getFreeShippingSettings();
  const freeShippingEnabled = settings.freeShippingEnabled ?? false;
  const threshold = settings.freeShippingThreshold ?? 0;
  const freeShippingApplied = freeShippingEnabled && subtotal >= threshold;
  const shipping = freeShippingApplied ? 0 : DEFAULT_SHIPPING_RATE;

  const tax = round2(discountedSubtotal * TAX_RATE);
  const total = round2(discountedSubtotal + shipping + tax);
  if (total <= 0) return { ok: false, status: 400, code: 'EMPTY_TOTAL', message: 'Order total must be greater than zero.' };

  return {
    ok: true,
    totals: {
      lines,
      subtotal,
      discount,
      discountType,
      couponCode,
      discountedSubtotal,
      shipping,
      freeShippingApplied,
      tax,
      total,
      currency: 'USD',
    },
    products,
  };
}

/** Safe base URL for Stripe success/cancel redirects (never expose secrets). */
export function appBaseUrl(req: IncomingMessage): string {
  const origin = (req.headers.origin || '').trim();
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/$/, '');
  const host = (req.headers.host || '').trim();
  if (host) return `http://${host}`;
  return 'https://luxedge.us';
}
