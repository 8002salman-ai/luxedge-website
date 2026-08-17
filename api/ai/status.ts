// GET /api/ai/status
//
// Returns which providers have keys configured on the server (booleans only).
// Never returns keys or any secret material. Admin-only (Phase 3A) — the
// storefront never needs this; only the admin AI Hub consumes it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROVIDER_ENV, PROVIDER_NAMES, isConfigured, defaultModelFor, sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const providers = Object.keys(PROVIDER_ENV).map((id) => ({
    id,
    name: PROVIDER_NAMES[id] || id,
    configured: isConfigured(id),
    model: defaultModelFor(id),
  }));
  sendJson(res, 200, {
    backend: providers.some((p) => p.configured) ? 'configured' : 'missing',
    providers,
  });
}
