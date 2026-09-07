// ============================================================================
// LUXEDGE — GET/POST /api/admin/table-columns
//
// Admin-only: persist the seller-chosen catalog column order server-side so
// the layout follows the admin across devices (not just the local browser's
// localStorage). Stored in app_settings under one key holding a JSON object
// keyed by admin email, so each admin keeps their own layout.
//
// GET  → { columns: string[] | null }   (null = never saved → client default)
// POST → { columns: string[] }          (401/403 via requireAdmin, 400 on bad body)
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const SETTING_KEY = 'ADMIN_CATALOG_COLUMN_ORDER_V1';

function getSupabaseConfig() {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, key };
}

async function readSetting(): Promise<Record<string, string[]> | null> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTING_KEY)}&select=value`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ value: string }>;
    if (!rows[0]?.value) return {};
    const parsed = JSON.parse(rows[0].value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>;
    }
    return {};
  } catch { return null; }
}

async function writeSetting(map: Record<string, string[]>, by: string): Promise<boolean> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return false;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: SETTING_KEY, value: JSON.stringify(map), updated_at: new Date().toISOString(), updated_by: by }),
    });
    return res.ok;
  } catch { return false; }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const adminEmail = (auth.email || 'admin').toLowerCase();

  if (req.method === 'GET') {
    const map = await readSetting();
    // null = storage unavailable → client falls back to localStorage/default.
    if (map === null) {
      sendJson(res, 502, { error: 'Column order unavailable (app_settings not reachable).' });
      return;
    }
    sendJson(res, 200, { columns: map[adminEmail] ?? null });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed — GET or POST only' });
    return;
  }

  let body: { columns?: unknown };
  try {
    body = await readJsonBody(req) as { columns?: unknown };
  } catch {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }
  if (!Array.isArray(body.columns) || body.columns.some((c) => typeof c !== 'string') || body.columns.length === 0) {
    sendJson(res, 400, { error: 'columns must be a non-empty array of strings' });
    return;
  }
  const columns = body.columns.slice(0, 40) as string[];

  const map = (await readSetting()) ?? {};
  map[adminEmail] = columns;
  const ok = await writeSetting(map, adminEmail);
  if (!ok) {
    sendJson(res, 502, { error: 'Could not save column order (app_settings unavailable).' });
    return;
  }
  sendJson(res, 200, { columns, saved: true });
}