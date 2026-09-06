// ============================================================================
// LUXEDGE — GET/POST /api/admin/auto-list
//
// Admin-only toggle: "auto-publish products that become commerce-ready".
// Persisted in Supabase app_settings (key='PRODUCTS_AUTO_PUBLISH_READY',
// value 'true'|'false') so the setting survives reloads and is shared across
// devices. The Products page reads it on mount and, when enabled, promotes a
// freshly-saved draft to active as soon as it is commerce-ready.
//
// GET  → { enabled: boolean }
// POST → { enabled: boolean }  (401/403 via requireAdmin, 400 on bad body)
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const SETTING_KEY = 'PRODUCTS_AUTO_PUBLISH_READY';

function getSupabaseConfig() {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, key };
}

async function readSetting(key: string): Promise<string | null> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  } catch { return null; }
}

async function writeSetting(key: string, value: string, by: string): Promise<boolean> {
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
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString(), updated_by: by }),
    });
    return res.ok;
  } catch { return false; }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const adminEmail = auth.email || 'admin';

  if (req.method === 'GET') {
    const value = await readSetting(SETTING_KEY);
    sendJson(res, 200, { enabled: value === 'true' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed — GET or POST only' });
    return;
  }

  let body: { enabled?: unknown };
  try {
    body = await readJsonBody(req) as { enabled?: unknown };
  } catch {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }
  if (typeof body.enabled !== 'boolean') {
    sendJson(res, 400, { error: 'enabled must be a boolean' });
    return;
  }

  const ok = await writeSetting(SETTING_KEY, body.enabled ? 'true' : 'false', adminEmail);
  if (!ok) {
    sendJson(res, 502, { error: 'Could not save the setting (app_settings unavailable).' });
    return;
  }
  sendJson(res, 200, { enabled: body.enabled, saved: true });
}