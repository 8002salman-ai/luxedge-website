// ============================================================================
// LUXEDGE — GET /api/admin/product-stats
//
// First-party per-product interest stats for the Catalog listing page
// (Views + Interest columns). One request, tiny response — the aggregation
// runs server-side via the service role so the browser never downloads raw
// analytics rows (no N+1, no per-visit Supabase egress).
//
// Data is REAL site_events analytics only:
//   views    — count of `view_item` events whose item_ids include the product
//   interest — count of `add_to_cart` events for the product (the strongest
//              persisted interest signal Luxedge has today; there is no
//              wishlist/favorites system, so this is deliberately NOT called
//              "watchers" or "saved")
// Window: last 90 days, capped at 50,000 events per pass (same cap as the
// Traffic dashboard) — a larger catalog never inflates egress. Products with
// no events simply have no entry (the UI shows "—").
//
// Response: { windowDays: 90, stats: { [productId]: { views, views7d,
//            views30d, interest } }, unavailable?: string }
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { supabaseAdmin } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';

interface ProductStats {
  views: number;
  views7d: number;
  views30d: number;
  interest: number;
}

const WINDOW_DAYS = 90;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k events max per pass, same cap as the Traffic dashboard

// In-worker TTL cache: the catalog page polls this on every mount; a 5-minute
// cache keeps repeat visits free of any Supabase round-trip.
let cachedStats: { at: number; data: Record<string, ProductStats> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface EventRow {
  item_ids?: unknown;
  occurred_at?: string | null;
}

function itemIds(row: EventRow): string[] {
  return Array.isArray(row.item_ids)
    ? row.item_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
}

async function fetchPass(
  cfg: { url: string; serviceRole: string },
  url: string,
): Promise<EventRow[] | null> {
  const r = await fetch(url, {
    headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (r.status === 404 || !r.ok) return null;
  return (await r.json()) as EventRow[];
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed — GET only' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  if (cachedStats && Date.now() - cachedStats.at < CACHE_TTL_MS) {
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats: cachedStats.data });
    return;
  }

  const cfg = supabaseAdmin();
  if (!cfg) {
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats: {}, unavailable: 'Analytics service not configured server-side.' });
    return;
  }

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    const stats: Record<string, ProductStats> = {};
    const now = Date.now();
    const cut7 = now - 7 * 86400000;
    const cut30 = now - 30 * 86400000;

    const countEvent = (id: string, ts: number | null, isCart: boolean) => {
      const entry = stats[id] ?? { views: 0, views7d: 0, views30d: 0, interest: 0 };
      if (isCart) {
        entry.interest += 1;
      } else {
        entry.views += 1;
        if (ts !== null) {
          if (ts >= cut7) entry.views7d += 1;
          if (ts >= cut30) entry.views30d += 1;
        }
      }
      stats[id] = entry;
    };

    // Pass 1: view_item (with timestamps for 7d/30d windows).
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${cfg.url}/rest/v1/site_events` +
        `?select=${encodeURIComponent('item_ids,occurred_at')}` +
        `&event=eq.view_item` +
        `&occurred_at=gte.${encodeURIComponent(since)}` +
        `&order=occurred_at.desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const rows = await fetchPass(cfg, url);
      if (!rows) break;
      for (const row of rows) {
        const ts = row.occurred_at ? Date.parse(row.occurred_at) : null;
        const t = Number.isNaN(ts as number) ? null : (ts as number);
        for (const id of itemIds(row)) countEvent(id, t, false);
      }
      if (rows.length < PAGE_SIZE) break;
    }

    // Pass 2: add_to_cart (interest). Separate pass keeps view_item and
    // add_to_cart counts distinct and avoids double counting.
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${cfg.url}/rest/v1/site_events` +
        `?select=${encodeURIComponent('item_ids')}` +
        `&event=eq.add_to_cart` +
        `&occurred_at=gte.${encodeURIComponent(since)}` +
        `&order=occurred_at.desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const rows = await fetchPass(cfg, url);
      if (!rows) break;
      for (const row of rows) for (const id of itemIds(row)) countEvent(id, null, true);
      if (rows.length < PAGE_SIZE) break;
    }

    cachedStats = { at: Date.now(), data: stats };
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats });
  } catch (e) {
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats: {}, unavailable: (e as Error).message });
  }
}