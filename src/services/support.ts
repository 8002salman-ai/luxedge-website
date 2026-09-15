// ============================================================================
// LUXEDGE — SUPPORT CONTACT (client)
//
// The public support channel is EMAIL. A support phone number exists, but it is
// not published: it is released only to a signed-in customer who has actually
// placed an order (or an admin), and it is fetched from /api/support/contact
// rather than written here.
//
// WHY IT IS NOT A CONSTANT: the support number used to be hardcoded across the
// footer, every policy page, the FAQ, the pre-rendered HTML and the
// Organization schema — so it was public and scrapable. A number that ships in
// the browser bundle is public no matter what the UI chooses to render, which
// is why the value lives server-side and arrives only when the caller is
// eligible. Do not add the number to this file.
// ============================================================================

export const SUPPORT_EMAIL = 'hello@luxedge.us';
export const SUPPORT_HOURS = 'Mon–Fri, 9AM–6PM CT';

export interface CustomerSupportContact {
  phone: string;
  hours: string;
  email: string;
}

/** What a caller is told when they are not a customer yet — never an error they caused. */
export const SUPPORT_CUSTOMER_ONLY_NOTE =
  'Phone support is available once you have placed an order. Email us and we will help.';

export interface SupportContactResult {
  /** The phone number, present only for an eligible customer. */
  contact: CustomerSupportContact | null;
  /** True when the server confirmed the session but it has no order yet. */
  customerOnly: boolean;
  /** True when the lookup itself failed (offline, 5xx) — not the same as "not a customer". */
  unavailable: boolean;
}

/**
 * Ask the server for the customer-only support number.
 *
 * Callers must pass the current access token. A null/absent token short-circuits
 * to "not eligible" without a request, so signed-out visitors never touch the
 * endpoint. Failure modes are distinguished on purpose: "we could not check"
 * must not be shown to a real customer as "you are not a customer".
 */
export async function loadSupportContact(
  getToken: () => string | null,
): Promise<SupportContactResult> {
  const token = getToken();
  if (!token) return { contact: null, customerOnly: false, unavailable: false };
  try {
    const res = await fetch('/api/support/contact', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = (await res.json()) as Partial<CustomerSupportContact>;
      if (body?.phone) {
        return {
          contact: {
            phone: body.phone,
            hours: body.hours || SUPPORT_HOURS,
            email: body.email || SUPPORT_EMAIL,
          },
          customerOnly: false,
          unavailable: false,
        };
      }
      return { contact: null, customerOnly: false, unavailable: true };
    }
    if (res.status === 403) return { contact: null, customerOnly: true, unavailable: false };
    // 401 (expired session) and 5xx both mean "we could not establish eligibility".
    return { contact: null, customerOnly: false, unavailable: true };
  } catch {
    return { contact: null, customerOnly: false, unavailable: true };
  }
}

/** Build a mailto: link for the public support address, with an optional subject. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
