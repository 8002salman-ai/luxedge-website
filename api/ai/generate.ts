// POST /api/ai/generate
//
// Browser → { provider, model, prompt, system? } → this function → provider API.
// Provider keys live in env vars only. Nothing secret is returned.
//
// SECURITY (Phase 3A): admin-only. The request must carry a valid Supabase
// access token with the admin claim (app_metadata.role = 'admin'); otherwise
// 401/403. Defense in depth on top: body size cap, prompt length cap, model
// allowlist regex, per-instance rate limit.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateWithFallback, isConfiguredFull, isValidModel, readJsonBody, sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  // Admin session required — this endpoint spends real provider credits.
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const provider = String(body.provider || '');
  const model = String(body.model || '');
  const prompt = String(body.prompt || '');
  const fallback = typeof body.fallback === 'string' && body.fallback.trim() ? String(body.fallback) : undefined;
  const system = typeof body.system === 'string' && body.system.trim() ? String(body.system) : undefined;

  if (!provider || !(await isConfiguredFull(provider))) {
    sendJson(res, 501, { error: 'AI provider not configured on server. Set the provider API key env var or attach a key in Settings → AI & Scraping Keys.' });
    return;
  }
  if (!prompt || prompt.length > 12000) {
    sendJson(res, 400, { error: 'prompt is required (max 12000 chars)' });
    return;
  }
  if (model && !isValidModel(model)) {
    sendJson(res, 400, { error: 'Invalid model identifier' });
    return;
  }
  try {
    const result = await generateWithFallback(provider, fallback, { prompt, model, system });
    sendJson(res, 200, { text: result.text, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed });
  } catch (e) {
    sendJson(res, 502, { error: (e as Error).message });
  }
}
