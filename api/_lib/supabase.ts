// ============================================================================
// LUXEDGE V2 — SERVER-SIDE SUPABASE ADMIN HELPERS
//
// Single place that derives the admin (service-role) Supabase configuration
// and talks to the `app_settings` key/value table. Server-only — the service
// role key never leaves these functions. Endpoints needing Supabase admin
// access (DB-attached AI keys, CRM leads, media storage) import from here
// instead of re-extracting env vars themselves.
// ============================================================================

export interface SupabaseAdmin {
  url: string;
  serviceRole: string;
}

/** Service-role config, or null when the env vars are missing. */
export function supabaseAdmin(): SupabaseAdmin | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && serviceRole ? { url, serviceRole } : null;
}

export function supabaseHeaders(serviceRole: string, json = false): Record<string, string> {
  return json
    ? { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, 'Content-Type': 'application/json' }
    : { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };
}

/** Upsert one row in app_settings (merge-duplicates so re-saves never grow the table). */
export async function upsertAppSetting(key: string, value: string): Promise<boolean> {
  const cfg = supabaseAdmin();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/app_settings`, {
      method: 'POST',
      headers: { ...supabaseHeaders(cfg.serviceRole, true), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete one row from app_settings. Missing row is not an error. */
export async function deleteAppSetting(key: string): Promise<boolean> {
  const cfg = supabaseAdmin();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: supabaseHeaders(cfg.serviceRole),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}