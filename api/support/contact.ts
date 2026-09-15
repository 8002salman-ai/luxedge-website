// GET /api/support/contact — the customer-only support phone number.
//
// WHY THIS IS AN ENDPOINT AND NOT A CONSTANT IN THE UI
//
// The owner does not publish a support phone number. Public contact is email
// only. The number is released to someone who is already a customer — a signed
// in user who has actually placed an order — or to an admin.
//
// That gate can only work server-side. A phone number written into the React
// source ships in the browser bundle, where anyone can read it with devtools;
// "customers only" would be a claim the code does not back. The number
// therefore lives only in this file and in the SUPPORT_PHONE binding, and is
// returned only after the request's own verified session is matched against a
// real order.
//
// SECURITY:
//   - The identity is taken from the VERIFIED token, never from a query param,
//     so a caller cannot ask for another customer's eligibility.
//   - Order evidence is read with the service-role key on the server only; no
//     key or raw order row is ever returned to the browser.
//   - No order row is echoed back — only the support phone, hours and email.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { userAuth } from '../_lib/auth.js';
import { isAdminClaim } from '../_lib/jwt.js';

/**
 * Public support identity. Safe to state publicly: the email is already on
 * every page and in the policies.
 */
export const SUPPORT_EMAIL = 'hello@luxedge.us';
export const SUPPORT_HOURS = 'Mon–Fri, 9AM–6PM CT';

/**
 * Server-only fallback for the support line. Set SUPPORT_PHONE to override it
 * without a code change. This module is imported by the worker/api layer only —
 * nothing under src/ may import it, or the number becomes public again.
 */
const SUPPORT_PHONE_FALLBACK = '+1 (440) 941-8002';

function serviceRole(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function supabaseUrl(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}

async function restFetch(
  table: string,
  query: string,
  key: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/${table}${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database unreachable.' } };
  }
}

/**
 * True when this email has at least one persisted order. Orders are written by
 * the payment webhook, so the row exists only after a real payment attempt —
 * exactly the "is this person already a customer" signal the owner described.
 */
async function hasPlacedOrder(email: string, key: string): Promise<boolean> {
  const q = `?customer_email=ilike.${encodeURIComponent(email)}&select=order_number&limit=1`;
  const r = await restFetch('luxedge_orders', q, key);
  return r.ok && Array.isArray(r.data) && r.data.length > 0;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const auth = await userAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error, email: SUPPORT_EMAIL });
    return;
  }

  const isAdmin = isAdminClaim(auth.payload);
  const email = (auth.payload.email || '').trim().toLowerCase();

  let eligible = isAdmin;
  if (!eligible && email) {
    const key = serviceRole();
    if (!key) {
      // Fail closed: never release the number because a key is missing.
      sendJson(res, 503, { error: 'Support contact lookup is not configured on this deployment.', email: SUPPORT_EMAIL });
      return;
    }
    eligible = await hasPlacedOrder(email, key);
  }

  if (!eligible) {
    // Honest gate, not an error the customer caused: they simply are not a
    // customer yet, and email is always available.
    sendJson(res, 403, {
      error: 'Phone support is available to customers with an order. Email us and we will help.',
      email: SUPPORT_EMAIL,
      hours: SUPPORT_HOURS,
    });
    return;
  }

  const phone = (process.env.SUPPORT_PHONE || '').trim() || SUPPORT_PHONE_FALLBACK;
  sendJson(res, 200, { phone, hours: SUPPORT_HOURS, email: SUPPORT_EMAIL });
}
