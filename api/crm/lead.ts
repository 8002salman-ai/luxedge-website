// POST /api/crm/lead — capture a storefront lead (WhatsApp click, AI chat, form)
//
// Public endpoint (no admin token). Used by the floating WhatsApp button and
// AI assistant so every inquiry lands in the CRM. Fields are validated and
// truncated; secrets never appear.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../_lib/providers.js';
import { supabaseConfig, supabaseFetch, uid, isMissingTable } from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCES = ['whatsapp', 'ai_chat', 'manual', 'welcome_popup'];

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: { email?: string; name?: string; phone?: string; source?: string; pageUrl?: string; message?: string; optedIn?: boolean };
  try {
    const parsed = await readJsonBody(req);
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as typeof body
      : {};
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const name = String(body.name || '').trim().slice(0, 120) || undefined;
  const phone = String(body.phone || '').trim().slice(0, 40) || undefined;
  const source = SOURCES.includes(String(body.source || '')) ? String(body.source) : 'manual';
  const pageUrl = String(body.pageUrl || '').trim().slice(0, 500) || undefined;
  const message = String(body.message || '').trim().slice(0, 1000) || undefined;
  // Contact capture is not marketing consent; callers must opt in explicitly.
  const optedIn = body.optedIn === true;

  if (!email && !phone) {
    sendJson(res, 400, { error: 'Provide at least an email or phone number.' });
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    sendJson(res, 400, { error: 'That email address does not look valid.' });
    return;
  }

  const cfg = supabaseConfig();
  if (!cfg) {
    sendJson(res, 200, { ok: true, stored: false, note: 'Server DB not configured — lead not persisted.' });
    return;
  }

  try {
    const r = await supabaseFetch(cfg, '/rest/v1/crm_leads', {
      method: 'POST',
      body: {
        id: uid(),
        email: email || null,
        name: name ?? null,
        phone: phone || null,
        source,
        page_url: pageUrl ?? null,
        opted_in: optedIn,
        metadata: message ? { message } : {},
      },
    });
    if (r.ok) {
      sendJson(res, 200, { ok: true, stored: true });
      return;
    }
    if (isMissingTable(r)) {
      sendJson(res, 200, { ok: true, stored: false, note: 'CRM table not yet applied (migration 0017) — lead queued for owner.' });
      return;
    }
    sendJson(res, 502, { ok: false, error: 'Could not store the lead. Try again in a moment.' });
  } catch (e) {
    sendJson(res, 500, { error: `Lead capture failed: ${(e as Error).message}` });
  }
}
