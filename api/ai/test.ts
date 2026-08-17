// POST /api/ai/test
//
// Server-side connection test for a provider. The key never leaves the server.
// Admin-only (Phase 3A): valid Supabase admin JWT required (401/403 otherwise).
// Rate-limited per instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, testProvider, rateLimited, clientIp, isValidModel } from '../_lib/providers';
import { requireAdmin } from '../_lib/auth';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const provider = String(body.provider || '');
  const model = typeof body.model === 'string' && body.model ? String(body.model) : undefined;
  if (!provider) {
    sendJson(res, 400, { error: 'provider is required' });
    return;
  }
  if (model && !isValidModel(model)) {
    sendJson(res, 400, { error: 'Invalid model identifier' });
    return;
  }
  const result = await testProvider(provider, model);
  sendJson(res, 200, result);
}
