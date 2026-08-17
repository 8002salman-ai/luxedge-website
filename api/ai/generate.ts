// POST /api/ai/generate
//
// Browser → { provider, model, prompt, system? } → this function → provider API.
// Provider keys live in env vars only. Nothing secret is returned.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { generate, isConfigured, readJsonBody, sendJson } from '../_lib/providers';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
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
  const system = typeof body.system === 'string' && body.system.trim() ? String(body.system) : undefined;

  if (!provider || !isConfigured(provider)) {
    sendJson(res, 501, { error: 'AI provider not configured on server. Set the provider API key env var (see .env.example) and redeploy.' });
    return;
  }
  if (!prompt || prompt.length > 12000) {
    sendJson(res, 400, { error: 'prompt is required (max 12000 chars)' });
    return;
  }
  try {
    const text = await generate(provider, { prompt, model, system });
    sendJson(res, 200, { text, provider, model });
  } catch (e) {
    sendJson(res, 502, { error: (e as Error).message });
  }
}
