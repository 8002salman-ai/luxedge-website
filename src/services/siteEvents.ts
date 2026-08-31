// ============================================================================
// SITE EVENTS — first-party traffic analytics
//
// The storefront records lightweight events (page_view, view_item, add_to_cart,
// begin_checkout, purchase, search, ...) into Supabase so the Admin "Traffic
// Overview" can show real visitor numbers and charts. This is independent of
// Google: GA4 still receives the same events via gtag, but our dashboard reads
// from this table.
//
// SECURITY (see supabase/migrations/0023_site_events.sql):
//   * Any visitor records events with the ANON key (INSERT only; RLS).
//   * Only an authenticated admin role may SELECT for the dashboard.
// Recording is fire-and-forget and must NEVER break the storefront.
// ============================================================================

import { getSupabaseConfig, getFreshAccessToken } from './supabase';

const VID_KEY = 'luxedge_vid';
const SID_KEY = 'luxedge_sid';

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to Math.random */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ids(): { visitor: string; session: string } {
  let visitor = '';
  let session = '';
  try {
    visitor = localStorage.getItem(VID_KEY) || '';
    if (!visitor) {
      visitor = makeId();
      localStorage.setItem(VID_KEY, visitor);
    }
    session = sessionStorage.getItem(SID_KEY) || '';
    if (!session) {
      session = makeId();
      sessionStorage.setItem(SID_KEY, session);
    }
  } catch {
    visitor = visitor || makeId();
    session = session || makeId();
  }
  return { visitor, session };
}

function detectDevice(ua: string): string {
  if (/(iPad|Tablet)/i.test(ua)) return 'tablet';
  if (/(Mobi|Android|iPhone|iPod)/i.test(ua)) return 'mobile';
  return 'desktop';
}

export interface TrackParams {
  [key: string]: unknown;
}

/**
 * Record an event for first-party analytics. Fire-and-forget: swallows every
 * error (network, storage, missing table) so analytics can never break the
 * storefront. Admin paths and the admin panel itself are never recorded.
 */
export function recordSiteEvent(name: string, params: TrackParams = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const cfg = getSupabaseConfig();
    if (!cfg) return;

    const path = window.location.pathname + window.location.search;
    if (path.startsWith('/admin')) return; // keep public traffic honest

    const { visitor, session } = ids();

    let referrer = '';
    try {
      const raw = document.referrer || '';
      referrer = raw.startsWith(window.location.origin) ? '' : raw;
    } catch {
      /* ignore */
    }

    const items = params.items;
    let item_ids: string[] | null = null;
    if (Array.isArray(items)) {
      item_ids = items.map((i) => String((i as { item_id?: unknown; id?: unknown })?.item_id ?? (i as { id?: unknown })?.id ?? '')).filter(Boolean).slice(0, 20);
    }
    if (item_ids && item_ids.length === 0) item_ids = null;

    const body: Record<string, unknown> = {
      event: name,
      path,
      referrer: referrer || null,
      visitor_id: visitor,
      session_id: session,
      device: detectDevice(navigator.userAgent),
      utm_source: params.campaign_source ? String(params.campaign_source) : null,
      utm_medium: params.campaign_medium ? String(params.campaign_medium) : null,
      utm_campaign: params.campaign_name ? String(params.campaign_name) : null,
      item_ids: item_ids || null,
    };

    fetch(`${cfg.url}/rest/v1/site_events`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }).catch(() => {
      /* ignore — best-effort analytics */
    });
  } catch {
    /* never throw, never break the storefront */
  }
}

export interface SiteEventRow {
  event: string;
  path: string;
  referrer: string | null;
  visitor_id: string | null;
  session_id: string | null;
  device: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  item_ids: unknown | null;
  occurred_at: string;
}

/**
 * Fetch the last `days` of events as a signed-in admin. Throws on auth
 * failure or an unreadable response (e.g. the table is not migrated yet).
 */
export async function fetchSiteEvents(days = 30): Promise<SiteEventRow[]> {
  const cfg = getSupabaseConfig();
  const token = await getFreshAccessToken();
  if (!cfg) return [];
  if (!token) throw new Error('Sign in as admin to view traffic analytics.');

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const url =
    `${cfg.url}/rest/v1/site_events?select=event,path,referrer,visitor_id,` +
    `session_id,device,utm_source,utm_medium,utm_campaign,item_ids,occurred_at` +
    `&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.asc&limit=50000`;

  const res = await fetch(url, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    throw new Error('Analytics table is not ready (run migration 0023).');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Sign in as admin to view traffic analytics.');
  }
  if (!res.ok) throw new Error(`Could not load analytics (HTTP ${res.status}).`);
  return (await res.json()) as SiteEventRow[];
}