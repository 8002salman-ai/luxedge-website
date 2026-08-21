// Shared helpers for the CRM endpoints. The Supabase service role key lives
// server-side only and is NEVER returned in responses.
export function supabaseConfig(): { url: string; serviceRole: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRole) return null;
  return { url, serviceRole };
}

export function uid(len = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function couponCode(prefix = 'LUX10'): string {
  return `${prefix}-${uid(8).toUpperCase()}`;
}

export async function supabaseFetch(
  cfg: { url: string; serviceRole: string },
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(cfg.url + path, {
    method: init?.method || 'GET',
    headers: {
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 200); }
  return { ok: r.ok, status: r.status, data };
}

/** True when the error is a missing crm_leads table (migration not applied yet). */
export function isMissingTable(e: { ok: boolean; status: number; data: unknown }): boolean {
  // PostgREST reports a missing table as PGRST205 / relation does not exist / 42P01.
  return !e.ok && /crm_leads|PGRST205|42P01|relation .* does not exist/i.test(JSON.stringify(e.data || ''));
}
