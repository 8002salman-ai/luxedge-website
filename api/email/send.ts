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

  let body: { to?: string; subject?: string; text?: string; html?: string } = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const to = String(body.to || '').trim().toLowerCase();
  const subject = String(body.subject || '').trim();
  const text = String(body.text || '').trim();
  const html = String(body.html || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    sendJson(res, 400, { ok: false, error: 'A valid recipient email is required.' });
    return;
  }
  if (!subject) {
    sendJson(res, 400, { ok: false, error: 'Subject is required.' });
    return;
  }
  if (!text && !html) {
    sendJson(res, 400, { ok: false, error: 'Provide text or html content.' });
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
