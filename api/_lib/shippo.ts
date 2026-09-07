// ============================================================================
// LUXEDGE — SERVER-SIDE SHIPPO HELPER (raw REST, no SDK)
//
// Runs ONLY inside /api serverless functions. The Shippo token is read from
// environment variables (SHIPPO_API_KEY, a Cloudflare secret) and is never
// returned to the browser, never logged, never persisted.
//
// What lives here:
//   - US address normalization (two-letter state, ZIP format) + a safe
//     "basic" validation used whenever Shippo is not configured or is down,
//     so the storefront never blocks a real order on a third-party outage.
//   - validateShippingAddress() — Shippo USPS address validation with a
//     recommended (corrected) address surfaced to the customer for approval.
//   - fetchLiveRates() — Shippo shipment rates given real parcel weights.
//
// Only US addresses are Shippo-validated today (the store ships domestically);
// non-US destinations pass basic field validation only.
// ============================================================================

export interface ShippingAddressInput {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface NormalizedAddress {
  fullName: string;
  addressLine1: string;
  addressLine2: string | null;
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

export interface AddressValidationOutcome {
  configured: boolean;      // Shippo token present (server-side truth)
  isValid: boolean;
  messages: string[];
  normalizedAddress: NormalizedAddress;
  recommendedAddress?: NormalizedAddress; // differs from input → ask customer
  source: 'shippo' | 'basic';
  /** true when Shippo IS configured but validation could not run (outage).
   *  Scarce-offer flows (Pet Gift Drop) must fail CLOSED on this instead of
   *  pretending the address was verified. */
  unavailable?: boolean;
}

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','AS','GU','MP','PR','VI',
]);

export function shippoConfigured(): boolean {
  return !!(process.env.SHIPPO_API_KEY || '').trim();
}

function shippoKey(): string {
  return (process.env.SHIPPO_API_KEY || '').trim();
}

// ---------------------------------------------------------------------------
// Pure US normalization helpers (unit-tested)
// ---------------------------------------------------------------------------

export function normalizeUsState(state: string): string {
  const s = String(state || '').trim().toUpperCase();
  if (US_STATES.has(s)) return s;
  // Common full names → abbreviation.
  const names: Record<string, string> = {
    ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
    COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
    FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
    INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
    MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
    MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
    OREGON: 'OR', PENNSYLVANIA: 'PA', 'PUERTO RICO': 'PR', 'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
    UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', 'VIRGIN ISLANDS': 'VI',
    WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  };
  return names[s] || s;
}

/** Keep ZIP/plus-4 shapes only (normalizes whitespace; returns input otherwise). */
export function formatUsPostalCode(zip: string): string {
  const z = String(zip || '').trim();
  if (/^\d{5}$/.test(z)) return z;
  if (/^\d{5}-\d{4}$/.test(z)) return z;
  if (/^\d{9}$/.test(z)) return `${z.slice(0, 5)}-${z.slice(5)}`;
  return z;
}

export function isLikelyUsZip(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(String(zip || '').trim());
}

export function normalizeCountry(country: string): string {
  const c = String(country || '').trim();
  if (/^US$/i.test(c) || /^USA$/i.test(c) || /^UNITED STATES/i.test(c)) return 'US';
  if (/^CA$/i.test(c) || /^CANADA/i.test(c)) return 'CA';
  if (/^GB$/i.test(c) || /^UK$/i.test(c) || /^UNITED KINGDOM/i.test(c)) return 'GB';
  if (/^AU$/i.test(c) || /^AUSTRALIA/i.test(c)) return 'AU';
  return c.toUpperCase().slice(0, 2) || 'US';
}

/** Normalize + trim a raw checkout address (state/ZIP only for US). */
export function normalizeShippingAddress(input: ShippingAddressInput): NormalizedAddress {
  const country = normalizeCountry(input.country || 'United States');
  const isUs = country === 'US';
  return {
    fullName: String(input.fullName || '').trim(),
    addressLine1: String(input.addressLine1 || '').trim(),
    addressLine2: input.addressLine2 ? String(input.addressLine2).trim() : null,
    city: String(input.city || '').trim(),
    state: isUs ? normalizeUsState(input.state) : String(input.state || '').trim().toUpperCase().slice(0, 24),
    postalCode: isUs ? formatUsPostalCode(input.postalCode) : String(input.postalCode || '').trim(),
    country,
  };
}

/** Complete-ness check used by checkout + gift flow before any Shippo call. */
export function addressIsComplete(a: ShippingAddressInput): boolean {
  const n = normalizeShippingAddress(a);
  return Boolean(n.fullName && n.addressLine1 && n.city && n.state && n.postalCode && n.country);
}

export function basicValidation(a: ShippingAddressInput): AddressValidationOutcome {
  const n = normalizeShippingAddress(a);
  const messages: string[] = [];
  if (n.country === 'US') {
    if (n.state.length !== 2 || !US_STATES.has(n.state)) messages.push('Enter a two-letter US state code (e.g. TX for Texas).');
    if (!isLikelyUsZip(n.postalCode)) messages.push('Enter a valid 5-digit US ZIP code.');
  } else {
    if (!n.postalCode) messages.push('Enter a postal code.');
  }
  return {
    configured: shippoConfigured(),
    isValid: messages.length === 0,
    messages,
    normalizedAddress: n,
    source: 'basic',
  };
}

// ---------------------------------------------------------------------------
// Shippo REST transport (server-only)
// ---------------------------------------------------------------------------

async function shippoRequest<T>(path: string, init?: { method?: string; body?: Record<string, unknown> }): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const key = shippoKey();
  if (!key) return { ok: false, status: 503, message: 'Shippo is not configured on this deployment.' };
  try {
    const res = await fetch(`https://api.goshippo.com${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `ShippoToken ${key}`,
        'Content-Type': 'application/json',
        'SHIPPO-API-VERSION': '2018-02-08',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = (data as { detail?: string; message?: string; title?: string }) || {};
      const msg = err.detail || err.title || err.message || `Shippo error (HTTP ${res.status}).`;
      return { ok: false, status: res.status, message: msg.slice(0, 300) };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 502, message: 'Shipping provider is unreachable right now.' };
  }
}

interface ShippoAddressObject {
  object_id?: string;
  street1?: string;
  street2?: string | null;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  validation_results?: { is_valid?: boolean; messages?: { text?: string; source?: string; type?: string; code?: string }[] };
}

function toShippoAddress(n: NormalizedAddress): Record<string, unknown> {
  const country = n.country === 'US' ? 'US' : n.country;
  const obj: Record<string, unknown> = {
    name: n.fullName || 'Luxedge customer',
    street1: n.addressLine1,
    city: n.city,
    state: n.state,
    zip: n.postalCode,
    country: country || 'US',
  };
  if (n.addressLine2) obj.street2 = n.addressLine2;
  return obj;
}

/**
 * Validate a shipping address. Shippo (USPS) is consulted for US addresses
 * when configured; when Shippo is absent/down the basic (format-level)
 * validation result is returned so real orders are never blocked on a
 * third-party outage. When Shippo returns a *changed* (normalized) address
 * the outcome carries it as `recommendedAddress` — the storefront must ask
 * the customer before silently shipping somewhere else.
 */
export async function validateShippingAddress(input: ShippingAddressInput): Promise<AddressValidationOutcome> {
  const n = normalizeShippingAddress(input);
  const basic = basicValidation(input);
  const isUs = n.country === 'US';
  if (!isUs || !shippoConfigured()) return basic;  const res = await shippoRequest<ShippoAddressObject>('/addresses/', {
    method: 'POST',
    body: { ...toShippoAddress(n), validate: true },
  });
  if (!res.ok) {
    // Shippo is configured but unreachable/failing → surface that so scarce
    // gift claims can fail closed instead of shipping blind. Paid orders may
    // choose to continue on format-level validation.
    return { ...basic, configured: true, source: 'basic' as const, unavailable: true };
  }

  const addr = res.data;
  const messages =
    addr.validation_results?.messages
      ?.map((m) => m.text?.trim())
      .filter((t): t is string => Boolean(t)) ?? [];

  const validated: NormalizedAddress = {
    ...n,
    addressLine1: addr.street1?.trim() || n.addressLine1,
    addressLine2: addr.street2?.trim() || n.addressLine2,
    city: addr.city?.trim() || n.city,
    state: (addr.state || n.state).trim(),
    postalCode: formatUsPostalCode(addr.zip || n.postalCode),
  };

  const norm = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const changed =
    norm(validated.addressLine1) !== norm(n.addressLine1) ||
    norm(validated.city) !== norm(n.city) ||
    norm(validated.state) !== norm(n.state) ||
    validated.postalCode !== n.postalCode;

  const isValid = Boolean(addr.validation_results?.is_valid);
  return {
    configured: true,
    isValid,
    messages: isValid ? [] : messages.length ? messages : basic.messages,
    normalizedAddress: validated,
    recommendedAddress: changed ? validated : undefined,
    source: 'shippo',
  };
}

/**
 * True when Shippo is configured AND reachable right now. Used by callers who
 * must fail closed on a Shippo outage (e.g. the Pet Gift Drop claim).
 */
export function outcomeWasVerified(o: AddressValidationOutcome): boolean {
  return o.source === 'shippo' && o.unavailable !== true;
}

/**
 * Fetch live US domestic rates from Shippo for a destination + parcel weights.
 * `lineItems` are [{ weightOz, quantity }]. Returns rates sorted cheapest
 * first. Errors are safe, unauthenticated messages.
 */
export async function fetchLiveRates(params: {
  address: ShippingAddressInput;
  lineItems: { weightOz: number; quantity: number }[];
}): Promise<{ ok: true; rates: ShippoRate[] } | { ok: false; status: number; message: string }> {
  const n = normalizeShippingAddress(params.address);
  if (!shippoConfigured()) return { ok: false, status: 503, message: 'Live carrier rates are not configured yet — flat-rate shipping applies.' };
  if (n.country !== 'US') return { ok: false, status: 422, message: 'Live carrier rates are available for US addresses only — flat-rate shipping applies.' };

  // Build one parcel per distinct product (weight * qty), like a real shipment.
  const parcels = params.lineItems
    .filter((li) => li.quantity > 0 && li.weightOz > 0)
    .map((li) => ({
      length: '10',
      width: '8',
      height: '4',
      distance_unit: 'in',
      weight: String(Math.max(1, Math.round(li.weightOz * li.quantity))),
      mass_unit: 'oz',
    }));
  if (parcels.length === 0) return { ok: false, status: 422, message: 'Some items in your cart are missing shipping weight — flat-rate shipping applies.' };

  // Address object (not validated — rates only care about the destination).
  const addrRes = await shippoRequest<ShippoAddressObject>('/addresses/', {
    method: 'POST',
    body: toShippoAddress(n),
  });
  if (!addrRes.ok) return { ok: false, status: addrRes.status, message: addrRes.message };

  // The address_from must be a real Shippo address object. Use a stable
  // "Luxedge fulfilment" placeholder created per call when no dedicated
  // shipper object exists yet — but only when SHIPPO_FROM_* envs are set.
  const fromName = (process.env.SHIPPO_FROM_NAME || '').trim();
  const fromStreet = (process.env.SHIPPO_FROM_ADDRESS || '').trim();
  const fromCity = (process.env.SHIPPO_FROM_CITY || '').trim();
  const fromState = (process.env.SHIPPO_FROM_STATE || '').trim();
  const fromZip = (process.env.SHIPPO_FROM_ZIP || '').trim();
  const fromConfigured = Boolean(fromName && fromStreet && fromCity && fromState && fromZip);
  if (!fromConfigured) return { ok: false, status: 503, message: 'Live carrier rates need a configured ship-from address — flat-rate shipping applies.' };

  const fromRes = await shippoRequest<ShippoAddressObject>('/addresses/', {
    method: 'POST',
    body: {
      name: fromName,
      street1: fromStreet,
      city: fromCity,
      state: fromState,
      zip: fromZip,
      country: 'US',
    },
  });
  if (!fromRes.ok) return { ok: false, status: fromRes.status, message: fromRes.message };

  const shipment = await shippoRequest<{ rates?: Array<Record<string, unknown>>; object_id?: string }>('/shipments/', {
    method: 'POST',
    body: {
      address_from: fromRes.data.object_id,
      address_to: addrRes.data.object_id,
      parcels,
      async: false,
    },
  });
  if (!shipment.ok) return { ok: false, status: shipment.status, message: shipment.message };

  // Map Shippo's wire shape (object_id/servicelevel/days) into the clean
  // camelCase rate the storefront + order row use.
  const mapRate = (raw: Record<string, unknown>): ShippoRate | null => {
    const id = String(raw.object_id || raw.objectId || '');
    const amount = Number(raw.amount);
    if (!id || !Number.isFinite(amount) || amount <= 0) return null;
    const sl = (raw.servicelevel ?? {}) as Record<string, unknown>;
    const provider = String(raw.provider || raw.carrier || sl.name || 'Carrier');
    const serviceName = String(sl.name || raw.service_name || raw.servicelevel_name || 'Standard');
    const daysNum = Number(raw.days ?? raw.estimated_days ?? NaN);
    const estimatedDays = Number.isFinite(daysNum) && daysNum >= 0 ? Math.round(daysNum) : null;
    return {
      objectId: id,
      provider,
      serviceName,
      amount,
      currency: String(raw.currency || 'USD').toUpperCase(),
      estimatedDays,
      durationTerms: raw.duration_terms ? String(raw.duration_terms) : null,
    };
  };
  const rawRates = Array.isArray(shipment.data.rates)
    ? (shipment.data.rates as Array<Record<string, unknown>>).map(mapRate).filter((r): r is ShippoRate => r !== null)
    : [];
  const rates = rawRates.sort((a, b) => a.amount - b.amount);

  return { ok: true, rates };
}
