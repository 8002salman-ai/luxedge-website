// POST /api/crm/assistant — storefront AI assistant (DeepSeek)
//
// Public, rate-limited chat for site visitors: answers questions about the
// store, products, shipping, returns, pets. It is a sales/help assistant, NOT
// a publishing tool — it can never create/update products, orders or prices.
//
//   { message: string, history?: [{role:'user'|'assistant', content:string}] }
//
// The DeepSeek key stays server-side. A hard cap on history + message length
// prevents abuse. Falls back to a friendly canned reply if the provider fails
// so the visitor never sees a broken widget.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, rateLimited, clientIp, generateWithRetry, isConfigured } from '../_lib/providers.js';
import { supabaseConfig, supabaseFetch, uid, isMissingTable } from './_lib.js';

const SYSTEM = `You are Luxie, the friendly AI assistant for LUXEDGE (luxedge.us), a premium pet essentials store based in Irving, Texas, USA.

Help visitors with:
- Store questions (products, categories, what's in stock)
- Shipping policy (USA shipping, delivery times), returns, orders
- Pet advice that is SAFE and general (never medical prescriptions; if a pet may be sick, gently recommend a veterinarian)
- Anything else about Luxedge

Rules:
- Be warm, concise, and helpful. Use short paragraphs or bullet lists.
- NEVER invent products, prices, stock levels, discounts or facts you are not certain of. If you don't know, say you are not sure and suggest contacting the store via WhatsApp (+1 440-941-8002) or sales@luxedge.us.
- NEVER promise delivery dates or stock availability.
- You cannot place orders, change prices, or publish products. Offer the storefront links (/shop, /cart, /checkout) and contact info instead.
- Keep answers under ~180 words.`;

interface Msg { role: string; content: string }

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    sendJson(res, 429, { error: 'Too many messages — please slow down and try again shortly.' });
    return;
  }

  let body: { message?: string; history?: Msg[] };
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const message = String(body.message || '').trim().slice(0, 800);
  if (!message) {
    sendJson(res, 400, { error: 'Message is required.' });
    return;
  }

  // Build the message list: system + last ~8 turns + current message.
  const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 2000)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  messages.push({ role: 'user', content: message });

  // Persist the lead (ai_chat source) so the owner sees every chat in the CRM.
  const cfg = supabaseConfig();
  if (cfg) {
    try {
      const pageUrl = String(req.headers.referer || '').slice(0, 500) || undefined;
      const r = await supabaseFetch(cfg, '/rest/v1/crm_leads', {
        method: 'POST',
        body: {
          id: uid(),
          email: null,
          name: 'AI chat visitor',
          source: 'ai_chat',
          page_url: pageUrl ?? null,
          opted_in: false,
          metadata: { last_message: message.slice(0, 300) },
        },
      });
      if (r.ok || isMissingTable(r)) {
        // fine — lead stored, or table pending
      }
    } catch {
      // lead persistence is best-effort; never fail the chat because of it
    }
  }

  if (!isConfigured('deepseek')) {
    sendJson(res, 200, {
      reply: 'Thanks for your message! Our team will get back to you shortly. For instant help, message us on WhatsApp (+1 440-941-8002) or email sales@luxedge.us.',
      provider: 'canned',
      leadStored: false,
    });
    return;
  }

  try {
    const text = await generateWithRetry('deepseek', {
      prompt: messages.map((m) => `${m.role === 'user' ? 'Customer' : 'Luxie'}: ${m.content}`).join('\n\n'),
      model: 'deepseek-v4-flash',
      system: SYSTEM,
    });
    sendJson(res, 200, { reply: text.trim(), provider: 'deepseek', model: 'deepseek-v4-flash' });
  } catch {
    sendJson(res, 200, {
      reply: 'I hit a small snag on my side. Please try again in a moment — or reach us instantly on WhatsApp (+1 440-941-8002) / sales@luxedge.us.',
      provider: 'canned',
      leadStored: true,
    });
  }
}
