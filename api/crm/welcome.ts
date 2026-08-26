// POST /api/crm/welcome — storefront welcome popup
//
// Public (no admin token): a visitor enters their email to claim the 10%
// welcome coupon. Server-side truth rules:
//   - email is required + validated; name/phone optional.
//   - A unique 10% coupon is created in the real `coupons` table (single use,
//     so it can actually be applied at checkout).
//   - The lead is stored in `crm_leads` for the CRM (welcome_popup source).
//   - If the same email already claimed a welcome coupon, the existing code is
//     returned instead of minting a duplicate.
//   - If `crm_leads` does not exist yet (migration 0017 pending), the coupon is
//     still created and returned — the visitor never loses the offer — with
//     `leadSaved: false` + a clear note for the owner.
//   - Never logs or returns secrets.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../_lib/providers.js';
import { supabaseConfig, supabaseFetch, uid, couponCode, isMissingTable } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// coupons.id is uuid in the live schema; PostgREST rejects non-uuid ids.
const uuidv4 = (): string => {
  // crypto.randomUUID exists in Node 19+/Workers; fall back to a manual v4.
  const rnd = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  return rnd;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: { email?: string; name?: string; phone?: string; pageUrl?: string; optedIn?: boolean };
  try {
    const parsed = await readJsonBody(req);
    // JSON null/arrays/primitives are not valid request objects. Treat them
    // as empty input so the route returns its normal 400 validation response.
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as typeof body
      : {};
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 120) || undefined;
  const phone = String(body.phone || '').trim().slice(0, 40) || undefined;
  const pageUrl = String(body.pageUrl || '').trim().slice(0, 500) || undefined;
  // Marketing consent must be explicit; claiming a coupon is not consent.
  const optedIn = body.optedIn === true;

  if (!email || !EMAIL_RE.test(email)) {
    sendJson(res, 400, { error: 'Enter a valid email address to claim your 10% welcome coupon.' });
    return;
  }

  const cfg = supabaseConfig();
  if (!cfg) {
    // Never display a coupon that was not persisted and therefore cannot be
    // redeemed. Fail closed until the server database is configured.
    sendJson(res, 503, {
      ok: false,
      error: 'Welcome offers are temporarily unavailable. Please try again shortly.',
      note: 'Set VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the server.',
    });
    return;
  }

  try {
    // 1. Reuse an existing welcome coupon for this email if one exists.
    const existing = await supabaseFetch(
      cfg,
      `/rest/v1/crm_leads?email=eq.${encodeURIComponent(email)}&source=eq.welcome_popup&select=id,coupon_code&limit=1`,
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      const prior = existing.data[0] as { coupon_code?: string };
      sendJson(res, 200, {
        ok: true,
        leadSaved: true,
        couponCode: prior.coupon_code || '',
        message: 'You already have a welcome coupon — here it is again. 🎉',
      });
      return;
    }

    // 2. Mint a real, single-use 10% coupon in the coupons table.
    const code = couponCode();
    const couponBody = {
      id: uuidv4(),
      code,
      description: 'Welcome 10% off — claimed via the Luxedge welcome popup',
      discount_type: 'percent',
      discount_value: 10,
      min_cart_value: 0,
      eligible_product_ids: [],
      eligible_category_ids: [],
      start_at: null,
      end_at: null,
      usage_limit: 1,
      used_count: 0,
      is_active: true,
    };
    const couponRes = await supabaseFetch(cfg, '/rest/v1/coupons', { method: 'POST', body: couponBody });
    if (!couponRes.ok) {
      // A coupon that was not persisted must never be presented as redeemable.
      sendJson(res, 502, {
        ok: false,
        error: 'Could not create the welcome coupon in the catalog. Try again in a moment.',
      });
      return;
    }

    // 3. Store the lead (welcome_popup). If crm_leads is missing (0017 not yet
    //    applied), the coupon is still valid — report leadSaved honestly.
    const leadRes = await supabaseFetch(cfg, '/rest/v1/crm_leads', {
      method: 'POST',
      body: {
        id: uid(),
        email,
        name: name ?? null,
        phone: phone ?? null,
        source: 'welcome_popup',
        page_url: pageUrl ?? null,
        coupon_code: code,
        coupon_used: false,
        opted_in: optedIn,
        metadata: { claimed_via: 'welcome_popup', coupon_discount: 10 },
      },
    });

    sendJson(res, 200, {
      ok: true,
      leadSaved: leadRes.ok,
      couponCode: code,
      message: leadRes.ok
        ? 'Welcome! Your 10% coupon is ready below. 🎉'
        : isMissingTable(leadRes)
          ? 'Coupon created. (Lead list needs migration 0017 — ask the owner to apply it.)'
          : 'Coupon created.',
    });
  } catch (e) {
    sendJson(res, 500, { error: `Welcome coupon failed: ${(e as Error).message}` });
  }
}
