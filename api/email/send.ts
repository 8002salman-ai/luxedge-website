// POST /api/email/send
//
// Sends an email from sales@luxedge.us using Cloudflare's Email Sending
// (the worker `send_email` binding). Admin-authenticated. Never logs or
// returns secrets; returns only safe diagnostics.
//
// Plan note: Cloudflare Email Sending (outbound to any recipient) is
// available on the Workers Paid plan. Sending to verified destination
// addresses in the account is free on all plans. If the binding is
// missing or the send fails, we return an honest error instead of
// pretending success.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const DEFAULT_FROM = 'sales@luxedge.us';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EnvWithMail = { SEND_MAIL?: { send: (msg: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }) => Promise<void> } };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (req as any).env as EnvWithMail | undefined;
  const binding = env?.SEND_MAIL;
  if (!binding) {
    sendJson(res, 501, { ok: false, error: 'Email sending is not configured on this deployment (send_email binding missing). Add the [[send_email]] binding in wrangler.toml and redeploy.' });
    return;
  }

  let body: { to?: string; audience?: string; subject?: string; text?: string; html?: string } = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const subject = String(body.subject || '').trim();
  const text = String(body.text || '').trim();
  const html = String(body.html || '').trim();
  if (!subject) {
    sendJson(res, 400, { ok: false, error: 'Subject is required.' });
    return;
  }
  if (!text && !html) {
    sendJson(res, 400, { ok: false, error: 'Provide text or html content.' });
    return;
  }

  // Batch send to CRM leads (opt-in marketing list). Reads opted-in lead
  // emails server-side via the service role — never returns the list.
  if (body.audience === 'leads') {
    const cfg = (() => {
      const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
      const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      return url && serviceRole ? { url, serviceRole } : null;
    })();
    if (!cfg) {
      sendJson(res, 502, { ok: false, error: 'CRM leads are unavailable (Supabase service role not configured on the server).' });
      return;
    }
    let leads: Array<{ email?: string | null }> = [];
    try {
      const r = await fetch(`${cfg.url}/rest/v1/crm_leads?opted_in=eq.true&select=email`, {
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      leads = (await r.json()) as Array<{ email?: string | null }>;
    } catch {
      sendJson(res, 502, { ok: false, error: 'Could not load CRM leads from the server.' });
      return;
    }
    const emails = [...new Set(leads.map((l) => (l.email || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 200);
    if (!emails.length) {
      sendJson(res, 200, { ok: true, sent: 0, failed: 0, total: 0, message: 'No opted-in CRM leads with valid emails.' });
      return;
    }
    let sent = 0;
    const failed: string[] = [];
    for (const to of emails) {
      try {
        await binding.send({
          from: DEFAULT_FROM,
          to,
          subject,
          ...(text ? { text } : {}),
          ...(html ? { html } : {}),
        });
        sent++;
      } catch {
        failed.push(to);
      }
    }
    sendJson(res, 200, {
      ok: true,
      sent,
      failed: failed.length,
      total: emails.length,
      message: `Campaign sent to ${sent} of ${emails.length} opted-in lead${emails.length === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed` : ''}.`,
    });
    return;
  }

  const to = String(body.to || '').trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    sendJson(res, 400, { ok: false, error: 'A valid recipient email is required.' });
    return;
  }

  try {
    await binding.send({
      from: DEFAULT_FROM,
      to,
      subject,
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
    });
    sendJson(res, 200, { ok: true, sent: true, from: DEFAULT_FROM, to, subject, message: 'Email sent.' });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const hint = /paid plan|subscribe|not available|beta/i.test(msg)
      ? ' Cloudflare Email Sending to new recipients requires the Workers Paid plan (sending to your verified address is free).'
      : ' Check that luxedge.us has the required SPF/DKIM records and that the recipient is allowed.';
    sendJson(res, 200, { ok: false, sent: false, error: `Cloudflare rejected the send: ${msg.slice(0, 200)}.${hint}` });
  }
}
