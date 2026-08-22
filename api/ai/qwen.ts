// POST /api/ai/qwen
//
// Browser → { prompt } or { messages } → this function → private Ollama
// (qwen3.5:9b) on Colab behind Cloudflare Access.
//
// The Cloudflare Access service token lives in server env vars ONLY and is
// never sent to the browser. Admin-only (same guard as /api/ai/generate).
// Body size + prompt length are capped; per-instance rate limit applies.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { qwenConfig, qwenChat, qwenGenerate } from '../_lib/qwen.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  // Admin session required — this endpoint spends real compute on the Colab box.
  if (!(await requireAdmin(req, res))) return;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const cfg = qwenConfig();
  if (!cfg) {
    sendJson(res, 501, {
      error:
        'Qwen3.5-9B-Colab not configured on server. Set QWEN_API_BASE_URL, QWEN_MODEL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET env vars and redeploy.',
    });
    return;
  }

  try {
    let text: string;
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const messages = (body.messages as { role?: string; content?: string }[])
        .filter((m) => m && (m.role === 'user' || m.role === 'system' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as string, content: m.content!.slice(0, 4000) }))
        .slice(-16);
      if (!messages.some((m) => m.role === 'user')) {
        sendJson(res, 400, { error: 'messages must include at least one user message' });
        return;
      }
      text = await qwenChat(messages);
    } else {
      const prompt = String(body.prompt || '').trim().slice(0, 12000);
      if (!prompt) {
        sendJson(res, 400, { error: 'prompt (or messages) is required' });
        return;
      }
      const system = typeof body.system === 'string' && body.system.trim() ? String(body.system).slice(0, 8000) : undefined;
      text = await qwenGenerate(prompt, system);
    }
    sendJson(res, 200, { model: cfg.model, response: text.trim(), provider: 'qwen' });
  } catch (e) {
    sendJson(res, 502, { error: (e as Error).message });
  }
}
