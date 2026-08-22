// POST /api/crm/subscribe — storefront newsletter signup (footer form)
//
// Public (no admin token): a visitor enters their email to subscribe to the
// Luxedge newsletter. Server-side truth rules:
//   - email is required + validated.
//   - The lead is stored in `crm_leads` with source = newsletter (visible in
//     Admin → CRM (Leads), exportable as CSV for HubSpot).
//   - Duplicate emails are not inserted twice — the existing row is returned.
//   - If `crm_leads` does not exist yet (migration 0017 pending), the request
//     still succeeds for the visitor with `leadSaved: false` + an honest note.
//   - Never logs or returns secrets. No coupon is minted (newsletter ≠ offer).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../_lib/providers.js';
import { supabaseConfig, supabaseFetch, uid, isMissingTable } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: { email?: string; name?: string; pageUrl?: string };
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 120) || undefined;
  const pageUrl = String(body.pageUrl || '').trim().slice(0, 500) || undefined;

  if (!email || !EMAIL_RE.test(email)) {
    sendJson(res, 400, { error: 'Enter a valid email address to subscribe.' });
    return;
  }

  const cfg = supabaseConfig();
  if (!cfg) {
    // Fail soft for the visitor in local/dev: acknowledge but be honest.
    sendJson(res, 200, {
      ok: true,
      leadSaved: false,
      message: 'Thanks for subscribing!',
      note: 'Server database not configured — lead was not persisted.',
    });
    return;
  }

  try {
    // 1. Reuse an existing newsletter lead for this email if one exists.
    const existing = await supabaseFetch(
      cfg,
      `/rest/v1/crm_leads?email=eq.${encodeURIComponent(email)}&source=eq.newsletter&select=id&limit=1`,
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      sendJson(res, 200, {
        ok: true,
        leadSaved: true,
        alreadySubscribed: true,
        message: 'You are already subscribed — thanks!',
      });
      return;
    }

    // 2. Store the lead (newsletter). Missing table → honest leadSaved:false.
    const leadRes = await supabaseFetch(cfg, '/rest/v1/crm_leads', {
      method: 'POST',
      body: {
        id: uid(),
        email,
        name: name ?? null,
        phone: null,
        source: 'newsletter',
        page_url: pageUrl ?? null,
        coupon_code: null,
        coupon_used: false,
        opted_in: true,
        metadata: { subscribed_via: 'footer_newsletter' },
      },
    });

    if (isMissingTable(leadRes)) {
      sendJson(res, 200, {
        ok: true,
        leadSaved: false,
        message: 'Thanks for subscribing!',
        note: 'CRM table is not created yet — run migration 0017 (crm_leads) to persist leads.',
      });
      return;
    }

    if (!leadRes.ok) {
      sendJson(res, 502, {
        ok: false,
        error: 'Could not save your subscription. Please try again in a moment.',
      });
      return;
    }

    sendJson(res, 200, { ok: true, leadSaved: true, message: 'Thanks for subscribing! 🐾' });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: 'Subscription service is temporarily unavailable.' });
  }
}
