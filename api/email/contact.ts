// POST /api/email/contact
//
// Public contact-form endpoint. Sends a visitor's message to hello@luxedge.us
// using Cloudflare Email Sending (the worker `send_email` binding) from
// sales@luxedge.us, with the visitor's address as reply_to so a reply from
// the support inbox reaches them directly.
//
// Abuse controls (all server-side):
//   - Tight per-IP rate limit (3 submissions / 10 min per warm instance —
//     a contact form needs far less than the shared 30/min limiter).
//   - Honeypot field: real browsers leave `website` empty; a filled honeypot
//     is answered with fake success and NEVER sends an email.
//   - Topic allowlist + field length caps.
//
// Never logs or returns secrets; returns only safe diagnostics.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, clientIp } from '../_lib/providers.js';

const DEFAULT_FROM = 'sales@luxedge.us';
const SUPPORT_INBOX = 'hello@luxedge.us';

const TOPICS = [
  'Order Question',
  'Shipping & Tracking',
  'Returns & Refunds',
  'Product Inquiry',
  'Technical Support',
  'Other',
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Per-IP rate limiter (dedicated to the contact form). In-memory per warm
// instance — same honest boundary as the shared limiter in providers.ts.
// ---------------------------------------------------------------------------
const CONTACT_WINDOW_MS = 10 * 60_000;
const CONTACT_MAX_PER_WINDOW = 3;
const contactHits = new Map<string, number[]>();

export function contactRateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (contactHits.get(key) || []).filter((t) => now - t < CONTACT_WINDOW_MS);
  if (arr.length >= CONTACT_MAX_PER_WINDOW) {
    contactHits.set(key, arr);
    return true;
  }
  arr.push(now);
  contactHits.set(key, arr);
  return false;
}

/** Test-only hook: clear the contact limiter so tests are deterministic. */
export function __resetContactLimiterForTests(): void {
  contactHits.clear();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EnvWithMail = { SEND_MAIL?: { send: (msg: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }) => Promise<void> } };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req, 20_000);
  } catch {
    sendJson(res, 400, { error: 'Invalid request body.' });
    return;
  }

  // Honeypot: bots that fill the hidden `website` field get a fake success
  // and never trigger an email or consume the human rate limit.
  if (String(body.website || '').trim()) {
    sendJson(res, 200, { ok: true, sent: true, message: 'Your message has been received. We typically reply within 24 hours.' });
    return;
  }

  const ip = clientIp(req);
  if (contactRateLimited(`contact:${ip}`)) {
    sendJson(res, 429, { error: 'Too many messages from this device. Please wait a few minutes and try again.' });
    return;
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const topic = String(body.topic || '').trim();
  const message = String(body.message || '').trim();

  if (name.length < 2 || name.length > 120) {
    sendJson(res, 400, { error: 'Please enter your name.' });
    return;
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    sendJson(res, 400, { error: 'Please enter a valid email address.' });
    return;
  }
  if (!(TOPICS as readonly string[]).includes(topic)) {
    sendJson(res, 400, { error: 'Please choose a topic from the list.' });
    return;
  }
  if (message.length < 10 || message.length > 4000) {
    sendJson(res, 400, { error: 'Please write a message of at least 10 characters.' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (req as any).env as EnvWithMail | undefined;
  const binding = env?.SEND_MAIL;
  if (!binding) {
    sendJson(res, 501, { ok: false, sent: false, error: 'Contact form email is not configured on this deployment (send_email binding missing). Add the [[send_email]] binding in wrangler.toml and redeploy.' });
    return;
  }

  try {
    await binding.send({
      from: DEFAULT_FROM,
      to: SUPPORT_INBOX,
      reply_to: email,
      subject: `Contact form — ${topic} — ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${message}`,
    });
    sendJson(res, 200, { ok: true, sent: true, message: 'Your message has been received. We typically reply within 24 hours.' });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const hint = /paid plan|subscribe|not available|beta/i.test(msg)
      ? ' Cloudflare Email Sending to new recipients requires the Workers Paid plan (sending to your verified address is free).'
      : '';
    sendJson(res, 502, { ok: false, sent: false, error: `We could not send your message right now: ${msg.slice(0, 200)}.${hint}` });
  }
}