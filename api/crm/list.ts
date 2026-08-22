// GET /api/crm/list — admin-only CRM leads
//
//   ?search=...      matches email/name/phone/coupon_code
//   ?source=...      welcome_popup | whatsapp | ai_chat | manual
//   ?couponUsed=1    only leads whose coupon was used
//   ?format=csv      plain-text CSV for Excel/HubSpot import
//
// Only the admin role (verified server-side) may read leads. No secrets ever.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { supabaseConfig, supabaseFetch } from './_lib.js';

interface LeadRow {
  id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  source?: string | null;
  page_url?: string | null;
  coupon_code?: string | null;
  coupon_used?: boolean | null;
  coupon_used_at?: string | null;
  opted_in?: boolean | null;
  metadata?: unknown;
  created_at?: string | null;
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const cfg = supabaseConfig();
  if (!cfg) {
    sendJson(res, 503, { error: 'Server database not configured. Set VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.' });
    return;
  }

  const url = new URL(req.url || '/', 'http://local');
  const search = url.searchParams.get('search') || '';
  const source = url.searchParams.get('source') || '';
  const couponUsed = url.searchParams.get('couponUsed') || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);
  const format = url.searchParams.get('format') || 'json';

  try {
    // Build a PostgREST query. Search matches are handled client-side for
    // flexibility; we fetch the most recent leads and filter in memory.
    const q = [
      '/rest/v1/crm_leads?select=*',
      `&order=created_at.desc`,
      `&limit=${limit}`,
    ].join('');
    const r = await supabaseFetch(cfg, q);
    if (!r.ok) {
      sendJson(res, 502, { error: 'Could not load leads from the database.' });
      return;
    }
    let rows = (Array.isArray(r.data) ? r.data : []) as LeadRow[];
    if (source) rows = rows.filter((x) => x.source === source);
    if (couponUsed === '1') rows = rows.filter((x) => x.coupon_used);
    if (couponUsed === '0') rows = rows.filter((x) => !x.coupon_used);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((x) =>
        [x.email, x.name, x.phone, x.coupon_code, x.id].some((f) => f && String(f).toLowerCase().includes(s)),
      );
    }

    if (format === 'csv') {
      // HubSpot contact import uses firstname/lastname (not a combined name).
      // email/phone map to standard HubSpot properties; everything else is a
      // custom property the owner maps once in the import wizard.
      const header = ['id', 'email', 'firstname', 'lastname', 'phone', 'source', 'page_url', 'coupon_code', 'coupon_used', 'coupon_used_at', 'opted_in', 'created_at'];
      const lines = [header.map(csvCell).join(',')];
      for (const row of rows) {
        const fullName = (row.name || '').trim();
        const sp = fullName.indexOf(' ');
        const firstname = sp === -1 ? fullName : fullName.slice(0, sp);
        const lastname = sp === -1 ? '' : fullName.slice(sp + 1).trim();
        lines.push([row.id, row.email, firstname, lastname, row.phone, row.source, row.page_url, row.coupon_code, row.coupon_used ? 'true' : 'false', row.coupon_used_at, row.opted_in ? 'true' : 'false', row.created_at].map(csvCell).join(','));
      }
      sendText(res, 200, lines.join('\n'));
      return;
    }

    sendJson(res, 200, {
      total: rows.length,
      leads: rows,
    });
  } catch (e) {
    sendJson(res, 500, { error: `CRM list failed: ${(e as Error).message}` });
  }
}
