// ============================================================================
// LUXEDGE — GET /api/admin/blog-stats
//
// First-party per-post view counts for the Blog Manager listing page (Views
// column). One request, tiny response — the aggregation runs server-side via
// the service role so the browser never downloads raw analytics rows (no N+1,
// no per-visit Supabase egress).
//
// Data is REAL site_events analytics only:
//   views    — count of `page_view` events whose path matches /blog/<slug>
//   views7d  — same, restricted to the last 7 days
//   views30d — same, restricted to the last 30 days
// Paths are normalized (trailing slash stripped, query dropped) so
// /blog/my-post and /blog/my-post/ count as one page.
//
// Window: last 90 days, capped at 50,000 events per pass (same cap as the
// Traffic dashboard). Posts with no events simply have no entry (the UI shows
// "—").
//
// Response: { windowDays: 90, stats: { [slug]: { views, views7d, views30d } },
//            unavailable?: string }
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { supabaseAdmin } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';

interface BlogStats {
  views: number;
  views7d: number;
  views30d: number;
}

const WINDOW_DAYS = 90;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k events max per pass, same cap as the Traffic dashboard

// In-worker TTL cache: the blog manager polls this on every mount; a 5-minute
// cache keeps repeat visits free of any Supabase round-trip.
let cachedStats: { at: number; data: Record<string, BlogStats> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Normalize a stored path: strip query, drop trailing slash. */
function normalizePath(raw: string): string {
  let p = raw.split('?')[0] ?? '';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
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
    const stats: Record<string, BlogStats> = {};
    const now = Date.now();
    const cut7 = now - 7 * 86400000;
    const cut30 = now - 30 * 86400000;

    // page_view rows carry the article path. Blog paths only — the like filter
    // keeps the download small while the trailing-normalization still handles
    // sub-paths (/blog/my-post and /blog/my-post/ both land on the post).
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${cfg.url}/rest/v1/site_events` +
        `?select=${encodeURIComponent('path,occurred_at')}` +
        `&event=eq.page_view` +
        `&path=like./blog/*` +
        `&occurred_at=gte.${encodeURIComponent(since)}` +
        `&order=occurred_at.desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const r = await fetch(url, {
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (r.status === 404 || !r.ok) break;
      const rows = (await r.json()) as { path?: string; occurred_at?: string | null }[];
      for (const row of rows) {
        const path = normalizePath(row.path || '');
        const m = path.match(/^\/blog\/([^/]+)$/);
        if (!m) continue; // /blog listing itself, /blog/write, etc.
        const slug = m[1];
        const ts = row.occurred_at ? Date.parse(row.occurred_at) : null;
        const t = Number.isNaN(ts as number) ? null : (ts as number);
        const entry = stats[slug] ?? { views: 0, views7d: 0, views30d: 0 };
        entry.views += 1;
        if (t !== null) {
          if (t >= cut7) entry.views7d += 1;
          if (t >= cut30) entry.views30d += 1;
        }
        stats[slug] = entry;
      }
      if (rows.length < PAGE_SIZE) break;
    }

    cachedStats = { at: Date.now(), data: stats };
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats });
  } catch (e) {
    sendJson(res, 200, { windowDays: WINDOW_DAYS, stats: {}, unavailable: (e as Error).message });
  }
}