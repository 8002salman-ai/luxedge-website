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

/**
 * Server-side provider priority — the ORDER of keys that actually work for
 * this deployment. When the client asks for a provider whose key is NOT
 * attached (e.g. DeepSeek before any DeepSeek key existed), the server routes
 * to the first CONFIGURED provider in this chain instead of failing, so admin
 * AI features (SEO, marketing, imports) always work as long as ANY key exists.
 * openrouter (MiniMax M3 free) and gemini (gemini-3.5-flash free) are the two
 * verified-working keys; the rest follow as fallbacks when attached later.
 */
export const PROVIDER_PRIORITY: { id: string; model: string }[] = [
  { id: 'openrouter', model: 'minimax/minimax-m3:free' },
  { id: 'gemini', model: 'gemini-3.5-flash' },
  { id: 'deepseek', model: 'deepseek-v4-flash' },
  { id: 'openai', model: 'gpt-4o-mini' },
  { id: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { id: 'codex', model: 'gpt-5-codex' },
];

/**
 * Resolve the provider this request should actually use. Returns the requested
 * provider when it is configured; otherwise the first configured provider in
 * PROVIDER_PRIORITY with a model to use; or null when NO provider has a key.
 */
export async function resolveAiProvider(requested: string): Promise<{ provider: string; model: string } | null> {
  if (requested && (await isConfiguredFull(requested))) return { provider: requested, model: '' };
  for (const p of PROVIDER_PRIORITY) {
    if (p.id === requested) continue;
    if (await isConfiguredFull(p.id)) return { provider: p.id, model: p.model };
  }
  return null;
}

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
  const requestedModel = String(body.model || '');
  const prompt = String(body.prompt || '');
  const fallback = typeof body.fallback === 'string' && body.fallback.trim() ? String(body.fallback) : undefined;
  const system = typeof body.system === 'string' && body.system.trim() ? String(body.system) : undefined;

  // The requested provider wins when its key is configured; otherwise route to
  // the first configured provider in PROVIDER_PRIORITY (the working key first)
  // so AI features never dead-end on a missing optional key. 501 only when NO
  // provider key exists at all.
  const resolved = await resolveAiProvider(provider);
  if (!resolved) {
    sendJson(res, 501, { error: 'AI provider not configured on server. Attach a key in AI Hub → Attach Key or set a provider API key env var.' });
    return;
  }
  // When the requested provider was substituted, drop the client's model too
  // (it belongs to the other provider) and use the resolved provider's model.
  const model = resolved.provider === provider ? requestedModel : resolved.model;
  if (!prompt || prompt.length > 12000) {
    sendJson(res, 400, { error: 'prompt is required (max 12000 chars)' });
    return;
  }
  if (model && !isValidModel(model)) {
    sendJson(res, 400, { error: 'Invalid model identifier' });
    return;
  }
  try {
    const result = await generateWithFallback(resolved.provider, fallback, { prompt, model, system });
    sendJson(res, 200, { text: result.text, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed });
  } catch (e) {
    sendJson(res, 502, { error: (e as Error).message });
  }
}
