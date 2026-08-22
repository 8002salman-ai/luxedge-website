// GET /api/ai/qwen/health
//
// Detailed health of the private Qwen (Ollama on Colab) provider:
//   - Cloudflare Access authentication: PASS/FAIL
//   - Ollama runtime: ONLINE/OFFLINE
//   - model: qwen3.5:9b + whether it is present in /api/tags
//   - short generation test: PASS/FAIL
//
// Never returns credential values. Admin-only, like every /api/ai/* endpoint.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { qwenHealth } from '../_lib/qwen.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;
  try {
    const health = await qwenHealth();
    sendJson(res, 200, health);
  } catch {
    // qwenHealth never throws, but fail closed with an honest UNKNOWN state.
    sendJson(res, 200, {
      configured: false,
      cloudflareAuth: 'UNKNOWN',
      ollama: 'UNKNOWN',
      model: 'qwen3.5:9b',
      modelFound: false,
      generation: 'SKIPPED',
      error: 'Health check failed',
    });
  }
}
