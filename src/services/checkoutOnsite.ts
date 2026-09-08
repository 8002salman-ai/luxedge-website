// ============================================================================
// LUXEDGE — CLIENT API FOR ON-SITE CHECKOUT
//
// Thin fetch wrappers for the on-site (PaymentElement) checkout. The browser
// NEVER sends prices or a payment status — only product ids + quantities +
// coupon code + contact + shipping address + a chosen Shippo rate object id.
// All amounts come back from the server / Stripe.
// ============================================================================

export interface CheckoutAddress {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface ShippoRate {
  objectId: string;
  provider: string;
  serviceName: string;
  amount: number;
  currency: string;
  estimatedDays: number | null;
  durationTerms: string | null;
}

export interface AddressValidationResult {
  configured: boolean;
  isValid: boolean;
  messages: string[];
  normalizedAddress: CheckoutAddress;
  recommendedAddress?: CheckoutAddress;
  source: 'shippo' | 'basic';
}

export interface OnsiteCheckoutConfig {
  stripeConfigured: boolean;
  stripePublishableKey: string | null;
  stripeMode: 'test' | 'live' | null;
  shippoConfigured: boolean;
  // Multi-provider engine fields
  activeCardProvider?: string | null;
  hasPaypal?: boolean;
  anyProviderReady?: boolean;
  cardClientConfig?: Record<string, string> | null;
  paypalClientConfig?: Record<string, string> | null;
}

export async function fetchOnsiteConfig(opts: { signal?: AbortSignal } = {}): Promise<OnsiteCheckoutConfig> {
  const res = await fetch('/api/checkout/onsite', { headers: { Accept: 'application/json' }, signal: opts.signal });
  const data = (await res.json().catch(() => null)) as Partial<OnsiteCheckoutConfig> | null;
  if (!res.ok || !data) {
    return { stripeConfigured: false, stripePublishableKey: null, stripeMode: null, shippoConfigured: false };
  }
  return {
    stripeConfigured: data.stripeConfigured === true && !!data.stripePublishableKey,
    stripePublishableKey: data.stripePublishableKey || null,
    stripeMode: data.stripeMode === 'live' ? 'live' : data.stripeMode === 'test' ? 'test' : null,
    shippoConfigured: data.shippoConfigured === true,
    activeCardProvider: data.activeCardProvider || null,
    hasPaypal: data.hasPaypal || false,
    anyProviderReady: data.anyProviderReady || false,
    cardClientConfig: data.cardClientConfig || null,
    paypalClientConfig: data.paypalClientConfig || null,
  };
}

export async function validateCheckoutAddress(
  address: CheckoutAddress,
  opts: { signal?: AbortSignal } = {},
): Promise<AddressValidationResult> {
  const res = await fetch('/api/shippo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validate', address }),
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => null)) as Partial<AddressValidationResult> & { error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error || 'Address validation is temporarily unavailable.');
  }
  return data as AddressValidationResult;
}

export interface RatesLineItem {
  productId: string;
  quantity: number;
}

/** Live rates for a completed address + cart (server computes weights). */
export async function fetchCheckoutRates(
  address: CheckoutAddress,
  items: RatesLineItem[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ rates: ShippoRate[] }> {
  const res = await fetch('/api/shippo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'rates',
      address: {
        fullName: address.fullName,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      },
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    }),
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => null)) as { rates?: ShippoRate[]; error?: string } | null;
  if (!res.ok || !data) {
    throw new Error((data as { error?: string } | null)?.error || 'Could not load shipping rates.');
  }
  return { rates: Array.isArray(data.rates) ? data.rates : [] };
}

export interface OnsiteTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  shippingMethod: string;
  tax: number;
  total: number;
  currency: string;
  freeShippingApplied: boolean;
  couponCode: string | null;
}

export interface OnsiteIntentResult {
  ok: boolean;
  paymentIntentId: string;
  clientSecret: string | null;
  orderNumber: string;
  reservationId: string;
  totals: OnsiteTotals;
  address: { line1: string; line2?: string | null; city: string; state: string; zip: string; country: string };
}

/** Start the on-site order: server validates cart + address + shipping rate,
 * reserves inventory, persists the pending order and creates the PaymentIntent. */
export async function startOnsiteCheckout(opts: {
  items: RatesLineItem[];
  couponCode?: string;
  email: string;
  phone?: string;
  fullName: string;
  address: CheckoutAddress;
  shippingRateId?: string;
}): Promise<OnsiteIntentResult> {
  const res = await fetch('/api/checkout/onsite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: opts.items.map((i) => ({ id: i.productId, quantity: i.quantity })),
      couponCode: opts.couponCode || undefined,
      email: opts.email,
      phone: opts.phone || undefined,
      fullName: opts.fullName,
      address: {
        line1: opts.address.addressLine1,
        line2: opts.address.addressLine2 || undefined,
        city: opts.address.city,
        state: opts.address.state,
        zip: opts.address.postalCode,
        country: opts.address.country,
      },
      shippingRateId: opts.shippingRateId || undefined,
    }),
  });
  const data = (await res.json().catch(() => null)) as Partial<OnsiteIntentResult> & { error?: string; code?: string } | null;
  if (!res.ok) {
    const err = new Error(data?.error || `Checkout could not start (HTTP ${res.status}).`) as Error & { code?: string };
    err.code = data?.code;
    throw err;
  }
  if (!data?.clientSecret) throw new Error('Payment provider returned no client secret.');
  return data as OnsiteIntentResult;
}

/**
 * Verify a payment after confirmPayment. NEVER trusts the client: the server
 * retrieves the PaymentIntent from Stripe and promotes the pending order only
 * when the intent is truly succeeded (amount + order matched).
 */
export async function verifyOnsitePayment(orderNumber: string, paymentIntentId: string): Promise<{ paid: boolean; orderNumber: string }> {
  const res = await fetch('/api/checkout/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber, paymentIntentId }),
  });
  const data = (await res.json().catch(() => null)) as { paid?: boolean; orderNumber?: string; error?: string } | null;
  if (!res.ok) throw new Error(data?.error || 'Could not verify payment right now.');
  return { paid: data?.paid === true, orderNumber: data?.orderNumber || orderNumber };
}
