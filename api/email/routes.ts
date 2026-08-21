// /api/email/routes — manage Luxedge email addresses (Cloudflare Email Routing)
//
//   GET    → list custom addresses (literal rules) + destinations
//   POST   → create a new address, e.g. { name: "salman", forwardTo?: "8002salman@gmail.com" }
//   DELETE → remove an address by its local-part (name)
//
// Uses the Cloudflare API with CLOUDFLARE_API_TOKEN (server secret). The token
// is NEVER returned; without it the endpoint reports "not configured" with
// setup instructions instead of pretending.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const CF = 'https://api.cloudflare.com/client/v4';
const DEFAULT_DEST = '8002salman@gmail.com';

function envVal(key: string): string {
  return String(process.env[key] || '').trim();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const token = envVal('CLOUDFLARE_API_TOKEN');
  const zoneId = envVal('CLOUDFLARE_ZONE_ID');
  if (!token || !zoneId) {
    sendJson(res, 200, {
      configured: false,
      message: 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID are not set on the server. Add them as Cloudflare worker secrets and redeploy to manage addresses from here. (Until then, addresses can be created in the Cloudflare dashboard → Email Routing.)',
      routes: [],
    });
    return;
  }

  const cf = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(CF + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let j: { success?: boolean; errors?: { code?: number; message?: string }[]; result?: unknown } = {};
    try { j = JSON.parse(text); } catch { j = { success: false, errors: [{ message: text.slice(0, 120) }] }; }
    return { ok: r.ok && !!j.success, status: r.status, data: j.result, errors: (j.errors || []).map((e) => e.message) };
  };

  try {
    // GET — list literal (custom-address) rules + destinations
    if (req.method === 'GET') {
      const [rulesRes, destRes] = await Promise.all([
        cf('GET', `/zones/${zoneId}/email/routing/rules`),
        cf('GET', `/accounts/${envVal('CLOUDFLARE_ACCOUNT_ID') || 'ACCOUNT_ID'}/email/routing/addresses`),
      ]);
      const rules = Array.isArray(rulesRes.data) ? (rulesRes.data as { id?: string; name?: string; enabled?: boolean; matchers?: { type?: string; field?: string; value?: string }[]; actions?: { type?: string; value?: string[] }[] }[]) : [];
      const dests = Array.isArray(destRes.data) ? (destRes.data as { email?: string; verified?: string | null }[]).filter((d) => d.email) : [];
      const addresses = rules
        .filter((r) => (r.matchers || []).some((m) => m.type === 'literal' && m.field === 'to'))
        .map((r) => {
          const matcher = (r.matchers || []).find((m) => m.type === 'literal');
          const local = String(matcher?.value || '').split('@')[0];
          return {
            id: r.id,
            address: matcher?.value || '',
            local,
            forwardsTo: (r.actions || []).find((a) => a.type === 'forward')?.value?.[0] || '',
            enabled: !!r.enabled,
          };
        });
      sendJson(res, 200, {
        configured: true,
        catchAllForwardsTo: DEFAULT_DEST,
        destinations: dests.map((d) => ({ email: d.email, verified: !!d.verified })),
        routes: addresses,
      });
      return;
    }

    // POST — create an address: { name: "salman", forwardTo?: "8002salman@gmail.com" }
    if (req.method === 'POST') {
      let body: { name?: string; forwardTo?: string } = {};
      try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); return; }
      const local = String(body.name || '').trim().toLowerCase().replace(/@.*$/, '');
      const forwardTo = String(body.forwardTo || '').trim().toLowerCase() || DEFAULT_DEST;
      if (!local || !/^[a-z0-9._%+-]+$/.test(local)) { sendJson(res, 400, { error: 'Enter a valid address name (letters, numbers, dot, dash).' }); return; }
      const address = `${local}@luxedge.us`;
      const created = await cf('POST', `/zones/${zoneId}/email/routing/rules`, {
        matchers: [{ field: 'to', type: 'literal', value: address }],
        actions: [{ type: 'forward', value: [forwardTo] }],
        enabled: true,
        name: `${address} -> ${forwardTo}`,
      });
      if (!created.ok) { sendJson(res, 400, { error: `Cloudflare rejected the address: ${created.errors.join('; ') || 'unknown'}` }); return; }
      sendJson(res, 200, { ok: true, address, forwardsTo: forwardTo, message: `${address} created — emails now forward to ${forwardTo}.` });
      return;
    }

    // DELETE — remove an address by local-part: ?name=salman
    if (req.method === 'DELETE') {
      const url = new URL(req.url || '/', 'http://local');
      const local = String(url.searchParams.get('name') || '').trim().toLowerCase().replace(/@.*$/, '');
      if (!local) { sendJson(res, 400, { error: 'name query param required' }); return; }
      const listRes = await cf('GET', `/zones/${zoneId}/email/routing/rules`);
      const rules = Array.isArray(listRes.data) ? (listRes.data as { id?: string; matchers?: { type?: string; field?: string; value?: string }[] }[]) : [];
      const rule = rules.find((r) => (r.matchers || []).some((m) => m.type === 'literal' && String(m.value || '').split('@')[0] === local));
      if (!rule?.id) { sendJson(res, 404, { error: `No address found for ${local}@luxedge.us` }); return; }
      const del = await cf('DELETE', `/zones/${zoneId}/email/routing/rules/${rule.id}`);
      if (!del.ok) { sendJson(res, 400, { error: `Cloudflare rejected the delete: ${del.errors.join('; ') || 'unknown'}` }); return; }
      sendJson(res, 200, { ok: true, address: `${local}@luxedge.us`, message: `${local}@luxedge.us deleted.` });
      return;
    }
  } catch (e) {
    sendJson(res, 500, { error: `Could not reach Cloudflare: ${(e as Error).message}` });
  }
}
