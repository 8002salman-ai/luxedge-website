// GET /api/omnisend/status
//
// Reports whether the Omnisend API key is configured on the server and (when
// configured) tests the connection against the real Omnisend API — returning
// account/audience metadata only, NEVER the key itself.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const OMNISEND_API = 'https://api.omnisend.com/v3';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const key = (process.env.OMNISEND_API_KEY || '').trim();
  if (!key) {
    sendJson(res, 200, { configured: false, connected: false, message: 'OMNISEND_API_KEY is not set on the server. Add it in your hosting environment (e.g. Cloudflare → luxedge-production → Settings → Variables) and redeploy.' });
    return;
  }

  try {
    const r = await fetch(`${OMNISEND_API}/contacts?limit=1`, {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const status = r.status;
      const message =
        status === 401 ? 'Omnisend rejected the API key (401 Unauthorized). Double-check the key in your Omnisend account → Settings → API keys.' :
        status === 403 ? 'The key works but lacks permission for this request (403). Ensure it has contacts/campaigns read access.' :
        `Omnisend returned HTTP ${status}.`;
      sendJson(res, 200, { configured: true, connected: false, status, message, detail: text.slice(0, 160) });
      return;
    }
    const j = (await r.json().catch(() => ({}))) as { total?: number; contacts?: unknown[] };
    const total = typeof j.total === 'number' ? j.total : undefined;
    sendJson(res, 200, {
      configured: true,
      connected: true,
      message: 'Connected to Omnisend successfully.',
      audience: total ?? (Array.isArray(j.contacts) ? j.contacts.length : undefined),
      platform: 'omnisend',
    });
  } catch (e) {
    sendJson(res, 200, { configured: true, connected: false, message: `Could not reach Omnisend: ${(e as Error).message}` });
  }
}
