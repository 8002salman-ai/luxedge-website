// GET/POST /api/admin/cj-key
// Admin-only endpoint to read/write the CJ API key.
// Stores in Supabase app_settings table (key='CJ_API_KEY').
// Server-side only — key never reaches the browser.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

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
    const value = await readSetting('CJ_API_KEY');
    sendJson(res, 200, {
      configured: !!value,
      // Never return the full key — show masked version
      masked: value ? `${value.substring(0, 6)}...${value.substring(value.length - 4)}` : null,
    });
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed: { action?: string; key?: string } = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }

    if (parsed.action === 'test') {
      // Test the currently configured key (read from env or DB)
      const envKey = (process.env.CJ_API_KEY || '').trim();
      const dbKey = await readSetting('CJ_API_KEY');
      const testKey = dbKey || envKey;
      if (!testKey) {
        sendJson(res, 200, { health: 'not_configured', detail: 'No CJ API key configured' });
        return;
      }
      try {
        const authRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'api', password: testKey }),
        });
        const data = await authRes.json() as { code?: number; result?: boolean };
        sendJson(res, 200, {
          health: data.result ? 'online' : 'offline',
          detail: data.result ? 'CJ authentication succeeded' : 'CJ authentication failed — check your key',
        });
      } catch (e: any) {
        sendJson(res, 200, { health: 'offline', detail: e?.message || 'Connection failed' });
      }
      return;
    }

    if (parsed.key) {
      const trimmed = parsed.key.trim();
      if (!trimmed) {
        sendJson(res, 400, { error: 'Key cannot be empty' });
        return;
      }
      const ok = await writeSetting('CJ_API_KEY', trimmed, adminEmail);
      if (ok) {
        sendJson(res, 200, { ok: true, masked: `${trimmed.substring(0, 6)}...${trimmed.substring(trimmed.length - 4)}` });
      } else {
        sendJson(res, 500, { error: 'Failed to save key — check Supabase app_settings table exists' });
      }
      return;
    }

    sendJson(res, 400, { error: 'Missing key or action parameter' });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
