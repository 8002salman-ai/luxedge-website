// ============================================================================
// LUXEDGE — GET /api/media/status  (Admin Media Hub "Last synced" stamp)
//
// Reports when the last media sync COMPLETED and what it did, so the admin
// can see that the hourly cron (or a manual Sync click) actually ran.
//
// Written by runMediaSync() (api/media/sync.ts) into the app_settings
// key MEDIA_LAST_SYNC — every ok:true run records { at, source: 'manual' |
// 'cron', synced, created, updated }. Only successful runs record, so this
// shows how fresh /media's channel import is, not failed attempts.
//
// Admin-authenticated like the sync endpoint itself; reads with the service
// role (the value is never exposed to non-admins).
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { supabaseAdmin, supabaseHeaders } from '../_lib/supabase.js';
import { MEDIA_LAST_SYNC_KEY } from './sync.js';

export interface LastSyncInfo {
  at: string;
  source: 'manual' | 'cron';
  synced: number;
  created: number;
  updated: number;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed — GET only' });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return; // 401/403 already sent

  const cfg = supabaseAdmin();
  if (!cfg) {
    sendJson(res, 500, { error: 'Supabase is not configured on the server.' });
    return;
  }

  try {
    const r = await fetch(
      `${cfg.url}/rest/v1/app_settings?key=eq.${MEDIA_LAST_SYNC_KEY}&select=value`,
      { headers: supabaseHeaders(cfg.serviceRole), signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) {
      sendJson(res, 502, { ok: false, error: `Could not read sync state (HTTP ${r.status}).` });
      return;
    }
    const rows = (await r.json().catch(() => [])) as Array<{ value?: string }>;
    const raw = rows?.[0]?.value;
    if (!raw) {
      sendJson(res, 200, { ok: true, lastSync: null });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, lastSync: JSON.parse(raw) as LastSyncInfo });
    } catch {
      sendJson(res, 200, { ok: true, lastSync: null });
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message || 'Could not read sync state.' });
  }
}
