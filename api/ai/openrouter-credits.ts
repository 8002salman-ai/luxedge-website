// GET /api/ai/openrouter-credits
//
// OpenRouter credit balance, checked server-side so the key never ships
// to the browser. Rate-limited per instance (no real auth yet — Phase 3).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isConfigured, providerKey, sendJson, rateLimited, clientIp } from '../_lib/providers';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!isConfigured('openrouter')) {
    sendJson(res, 501, { error: 'OpenRouter not configured on server (missing OPENROUTER_API_KEY env var)' });
    return;
  }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${providerKey('openrouter')}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      sendJson(res, 502, { error: `OpenRouter credit check failed (HTTP ${r.status})` });
      return;
    }
    const d = await r.json();
    sendJson(res, 200, { total: d?.data?.limit || 0, used: d?.data?.usage || 0 });
  } catch {
    sendJson(res, 502, { error: 'OpenRouter credit check failed' });
  }
}
