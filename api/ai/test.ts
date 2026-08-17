// POST /api/ai/test
//
// Server-side connection test for a provider. The key never leaves the server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, testProvider } from '../_lib/providers';

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
  const model = typeof body.model === 'string' && body.model ? String(body.model) : undefined;
  if (!provider) {
    sendJson(res, 400, { error: 'provider is required' });
    return;
  }
  const result = await testProvider(provider, model);
  sendJson(res, result.ok ? 200 : 200, result);
}
