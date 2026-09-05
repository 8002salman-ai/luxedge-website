// ============================================================================
// LUXEDGE — CLIENT CHECKOUT API (Stripe-hosted)
//
// The browser never sends prices to the server — only product ids +
// quantities + coupon code + shipping contact. The server recomputes every
// amount from the real catalog and creates a Stripe-hosted Checkout Session.
// Card data NEVER touches Luxedge (Stripe hosts the payment page).
// ============================================================================

export interface CheckoutCustomer {
  email: string;
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface CheckoutItemInput {
  id: string;
  quantity: number;
}

export interface CheckoutTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  /** Always 0 — no sales tax collected at launch (no Stripe Tax add-on). */
  tax: number;
  /** Final total charged — catalog prices + shipping, nothing hidden. */
  total: number;
  currency: string;
  freeShippingApplied: boolean;
  couponCode: string | null;
  /** Always false — no Stripe Tax add-on: Luxedge charges no tax and delegates nothing to the payment provider. */
  taxHandledByProvider?: boolean;
}

export interface CreateCheckoutResponse {
  url: string;
  sessionId: string;
  totals: CheckoutTotals;
}

/** Stripe is configured when the server told us so (server is the authority). */
let stripeConfiguredFlag: boolean | null = null;
export function isStripeConfigured(): boolean {
  return stripeConfiguredFlag === true;
}

export async function probeStripeConfig(): Promise<boolean> {
  try {
    const res = await fetch('/api/checkout?probe=1', { headers: { Accept: 'application/json' } });
    if (!res.ok) { stripeConfiguredFlag = false; return false; }
    // The server ALWAYS answers 200 for a probe; the configured flag lives in
    // the body. Trusting res.ok alone would report configured even when the
    // store has no keys.
    const data = (await res.json().catch(() => null)) as { configured?: boolean } | null;
    stripeConfiguredFlag = data?.configured === true;
    return stripeConfiguredFlag;
  } catch {
    stripeConfiguredFlag = false;
    return false;
  }
}

/** Create a Stripe-hosted Checkout Session from the server-verified cart. */
export async function createCheckoutSession(opts: {
  items: CheckoutItemInput[];
  couponCode?: string;
  customer?: CheckoutCustomer;
}): Promise<CreateCheckoutResponse> {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: opts.items,
      couponCode: opts.couponCode || undefined,
      customer: opts.customer,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<CreateCheckoutResponse> & { error?: string; code?: string };
  if (!res.ok) {
    const message =
      res.status === 503
        ? 'Payment is not configured yet on this deployment. The store owner needs to add Stripe keys.'
        : data.error || `Checkout error (HTTP ${res.status})`;
    const err = new Error(message) as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  if (!data.url) throw new Error('Payment provider returned no checkout URL.');
  return data as CreateCheckoutResponse;
}

export interface SessionOrderInfo {
  orderNumber: string | null;
  status: string | null;
  total: number | null;
  currency: string | null;
}

export interface CheckoutSessionStatus {
  session: { id: string; paymentStatus: string; amountTotal: number; currency: string; customerEmail: string | null } | null;
  order: SessionOrderInfo | null;
}

/** Real session/order status for the success page — never fake success. */
export async function fetchCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
  const res = await fetch(`/api/checkout?session_id=${encodeURIComponent(sessionId)}`);
  const data = (await res.json().catch(() => ({}))) as Partial<CheckoutSessionStatus> & { error?: string };
  if (!res.ok) throw new Error(data.error || `Could not verify payment status (HTTP ${res.status})`);
  return { session: data.session ?? null, order: data.order ?? null };
}
