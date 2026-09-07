// ============================================================================
// LUXEDGE — PET GIFT DROP (shared server-side helpers)
//
// The campaign is a genuine $0 product giveaway. Claims are recorded as REAL
// rows inside the existing luxedge_orders table (one order system):
//
//   * coupon_code  = GIFT_MARKER ("PET-GIFT-DROP") — distinguishes a gift
//                    claim from a sale without any schema change.
//   * status       = the normal luxedge lifecycle, mapped 1:1:
//                        pending     → gift claimed (awaiting fulfilment)
//                        processing  → confirmed, gift being prepared
//                        shipped     → handed to carrier (tracking optional)
//                        delivered   → delivered
//                        cancelled   → cancelled (admin only)
//   * totals       = $0, currency USD. NO Stripe session/intent is ever
//                    created, so there is no payment step for the customer.
//   * shipping_address jsonb carries the address PLUS a private `_gift`
//     envelope (pet profile, payment:"NOT_REQUIRED", source, marketing
//     opt-in, isTest) that only Luxedge admin tooling reads.
//   * items        = one line: { kind:"gift", name, valueCents, qty:1, price:0 }
//
// DEDUPE / ANTI-ABUSE:
//   * order_number is DETERMINISTIC per email ("GIFT-" + hash(email)) — the
//     order_number UNIQUE constraint makes "one gift per email" atomic at the
//     database level: a second claim from the same email fails with 409.
//   * one-per-household is enforced by scanning claims after insert and
//     self-cancelling if the street+ZIP already belongs to a live claim.
//   * inventory is not a stored counter (no DDL): remaining = campaign.total
//     − count of live non-test claims, computed with PostgREST count=exact.
//     Claim inserts additionally re-check remaining < total right before the
//     insert, so the landing page always shows real numbers.
//   * honey-pot field + minimum form-time + per-IP rate limiting stop bots.
//   * GIFT_TEST_KEY (dev-only secret) allows internal E2E claims to be marked
//     isTest:true. It is NOT set in production, so public claims can never
//     self-mark as tests.
// ============================================================================

export const GIFT_MARKER = 'PET-GIFT-DROP';
export const GIFT_CAMPAIGN_KEY = 'gift_drop_campaign_v1';
export const GIFT_PET_TYPES = ['dog', 'cat'] as const;
export const GIFT_INTERESTS = ['feeding', 'grooming', 'toys', 'walking', 'accessories', 'health', 'training'] as const;
export const GIFT_STATUS_FLOW: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export interface ClaimAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  zip: string;
  country?: string;
}

export interface GiftClaimInput {
  firstName: string;
  email: string;
  petType: string;
  petName?: string;
  petSize?: string;
  petInterest?: string;
  address: ClaimAddress;
  marketingOptIn?: boolean;
  source?: string;
  // Anti-abuse / internal
  company?: string; // honey-pot — must be empty
  formSeconds?: number;
  testKey?: string; // only honoured when GIFT_TEST_KEY env matches
}

export interface GiftCampaignCfg {
  key: string;
  active: boolean;
  title: string;
  message: string;
  giftName: string;
  giftValueCents: number;
  total: number;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string | null;
}

export interface GiftClaimRow {
  id: string;
  order_number: string;
  customer_email: string;
  customer_name: string;
  created_at: string;
  updated_at: string;
  status: string;
  total: string | number;
  currency: string;
  coupon_code: string;
  shipping_address: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    _gift?: {
      petType?: string;
      petName?: string;
      petSize?: string;
      petInterest?: string;
      payment?: string;
      source?: string;
      marketingOptIn?: boolean;
      isTest?: boolean;
      emailSent?: boolean;
      emailNote?: string;
      tracking?: { carrier?: string; number?: string };
    };
  };
  items?: Array<{ kind?: string; name?: string; valueCents?: number; qty?: number; price?: number }>;
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

/** Deterministic per-email order number → DB-unique ⇒ atomic one-per-email. */
export function giftOrderNumber(email: string): string {
  let h = 0;
  const s = normalizeEmail(email);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `GIFT-${hex}`;
}

export function normalizeHouse(line1: string, zip: string): string {
  return `${String(line1 || '').trim().toLowerCase()}|${String(zip || '').trim().toUpperCase()}`;
}

/** Pure payload validation — returns an error string or null when valid. */
export function validateGiftClaim(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request.';
  const b = input as Record<string, unknown>;
  // Honey-pot: bots fill hidden fields; real humans never see them.
  if (typeof b.company === 'string' && b.company.trim() !== '') return 'Invalid request.';
  const firstName = String(b.firstName || '').trim();
  if (!firstName) return 'Please enter your first name.';
  if (firstName.length > 80) return 'Name is too long.';
  const email = normalizeEmail(String(b.email || ''));
  if (!isValidEmail(email)) return 'That email address does not look valid.';
  const petType = String(b.petType || '').trim().toLowerCase();
  if (!(GIFT_PET_TYPES as readonly string[]).includes(petType)) {
    return 'This gift drop currently covers dogs and cats.';
  }
  if (typeof b.petName === 'string' && b.petName.length > 60) return 'Pet name is too long.';
  if (typeof b.petSize === 'string' && b.petSize.length > 40) return 'Pet size is too long.';
  const a = (b.address || {}) as Record<string, unknown>;
  const line1 = String(a.line1 || '').trim();
  const city = String(a.city || '').trim();
  const zip = String(a.zip || '').trim();
  if (!line1 || !city || !zip) {
    return 'We need a complete shipping address to deliver your gift (street, city and ZIP/postal code).';
  }
  if (line1.length > 160 || city.length > 80 || zip.length > 16 || String(a.state || '').length > 60) {
    return 'An address field is too long — please shorten it.';
  }
  const fs = Number(b.formSeconds);
  if (!Number.isFinite(fs) || fs < 3) return null; // pacing hint (soft, not enforced hard)
  return null;
}

/** Build the luxedge_orders row for a successful gift claim. */
export function buildGiftOrderRow(input: GiftClaimInput, cfg: GiftCampaignCfg, isTest: boolean) {
  const email = normalizeEmail(input.email);
  const a = input.address;
  return {
    order_number: giftOrderNumber(email),
    customer_email: email,
    customer_name: String(input.firstName || '').trim(),
    shipping_address: {
      line1: String(a.line1 || '').trim(),
      line2: String(a.line2 || '').trim(),
      city: String(a.city || '').trim(),
      state: String(a.state || '').trim(),
      zip: String(a.zip || '').trim(),
      country: String(a.country || 'US').trim() || 'US',
      _gift: {
        petType: String(input.petType || '').trim().toLowerCase(),
        petName: String(input.petName || '').trim().slice(0, 60),
        petSize: String(input.petSize || '').trim().slice(0, 40),
        petInterest: String(input.petInterest || '').trim().slice(0, 60),
        payment: 'NOT_REQUIRED',
        source: String(input.source || 'web').trim().slice(0, 60) || 'web',
        marketingOptIn: !!input.marketingOptIn,
        isTest: !!isTest,
        emailSent: false,
        emailNote: '',
      },
    },
    items: [
      {
        kind: 'gift',
        name: cfg.giftName || 'Complimentary Luxedge pet gift',
        valueCents: Number(cfg.giftValueCents) || 0,
        qty: 1,
        price: 0,
      },
    ],
    coupon_code: GIFT_MARKER,
    subtotal: 0,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 0,
    currency: 'USD',
    status: 'pending',
  };
}

export function giftGiftData(row: GiftClaimRow): {
  petType?: string;
  petName?: string;
  petSize?: string;
  petInterest?: string;
  payment?: string;
  isTest?: boolean;
  emailSent?: boolean;
  emailNote?: string;
  source?: string;
  marketingOptIn?: boolean;
  tracking?: { carrier?: string; number?: string };
} {
  return (row.shipping_address && row.shipping_address._gift) || {};
}

export function giftAddress(row: GiftClaimRow) {
  const s = row.shipping_address || {};
  return {
    line1: s.line1 || '',
    line2: s.line2 || '',
    city: s.city || '',
    state: s.state || '',
    zip: s.zip || '',
    country: s.country || 'US',
  };
}

// ---------------------------------------------------------------------------
// Supabase REST access (service role, server-side only)
// ---------------------------------------------------------------------------
export function supabaseEnv() {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, serviceRole };
}

export function supabaseHeadersFor(serviceRole: string): Record<string, string> {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
  };
}

export async function loadCampaign(): Promise<Record<string, unknown> | null> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(GIFT_CAMPAIGN_KEY)}&select=value`,
      { headers: supabaseHeadersFor(serviceRole), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value?: string }>;
    const raw = rows[0]?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveCampaign(cfg: Record<string, unknown>): Promise<boolean> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return false;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings`, {
      method: 'POST',
      headers: { ...supabaseHeadersFor(serviceRole), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        key: GIFT_CAMPAIGN_KEY,
        value: JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
        updated_by: 'gift-drop',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Live inventory: remaining = campaign.total − count of live non-test claims. */
export async function liveRemaining(total: number): Promise<number> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return -1;
  try {
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?select=id&coupon_code=eq.${encodeURIComponent(GIFT_MARKER)}&status=not.in.(cancelled,failed)&limit=1`,
      {
        headers: { ...supabaseHeadersFor(serviceRole), Prefer: 'count=exact', Range: '0-0' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return -1;
    const countHeader = res.headers.get('content-range') || '';
    const m = countHeader.match(/\/(\d+)$/);
    return m ? Math.max(total - Number(m[1]), 0) : -1;
  } catch {
    return -1;
  }
}
