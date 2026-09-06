// ============================================================================
// AUTO-PUBLISH helper — "publish products that become commerce-ready".
//
// Reads/writes the admin toggle persisted server-side (app_settings via
// /api/admin/auto-list) so the setting survives reloads and is shared across
// devices. This module only carries the flag; the actual promotion happens in
// the editor save path when the setting is on.
// ============================================================================
import { getFreshAccessToken } from '../../services/supabase';

/** Current auto-publish flag (false on any failure — never blocks saving). */
export async function getAutoPublishEnabled(): Promise<boolean> {
  try {
    const token = await getFreshAccessToken();
    const r = await fetch('/api/admin/auto-list', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const j = (await r.json()) as { enabled?: boolean };
    return j.enabled === true;
  } catch {
    return false;
  }
}

/** Persist the toggle. Returns the new state, or null on failure. */
export async function setAutoPublishEnabled(enabled: boolean): Promise<boolean | null> {
  try {
    const token = await getFreshAccessToken();
    const r = await fetch('/api/admin/auto-list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { enabled?: boolean };
    return j.enabled === true;
  } catch {
    return null;
  }
}