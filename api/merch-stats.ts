// ============================================================================
// LUXEDGE — GET /api/merch-stats (public)
//
// Smart-merchandising aggregate feed. The storefront's ranking engine
// (src/features/catalog/merchandising.ts) consumes compact per-product counts
// so product grids can order by real, recent performance — while the raw
// analytics stay server-side (no N+1, no raw-event download to browsers).
//
// DATA (all REAL first-party records — nothing is fabricated):
//   site_events (migration 0023/0024):
//     view_item_list → list impressions (i7/i30/i90)
//     select_item    → card clicks        (c30)
//     view_item      → product-page views (v7/v30)
//     add_to_cart    → cart additions     (a30)
//     purchase       → purchase events    (momentum window only)
//   luxedge_orders (migration 0013, paid statuses only):
//     paid orders / units / revenue per product line (o90/q90/r90)
//
// Windows: impressions & views tracked at 7/30/90d; commerce at 30/90d;
// momentum is any-touch activity in the last 7 days. Bayesian smoothing and
// the weighted score are applied client-side (see merchandising.ts) because
// visual quality is a client-side measurement.
//
// SECURITY: this endpoint is intentionally public (anonymous) — the response
// contains aggregate product-performance counts only, never visitor PII. The
// aggregation itself runs with the service-role key, which never leaves the
// worker.
//
// CACHE: 15-minute in-memory TTL (same pattern as other api/* handlers). The
// hourly cron also pre-warms it so storefront requests rarely pay the cost.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers';
import { supabaseAdmin, supabaseHeaders } from './_lib/supabase';

const CACHE_TTL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 60; // up to 60k events / 60k orders per pass

interface Counts {
  i7: number; i30: number; i90: number;
  v7: number; v30: number;
  c30: number; a30: number;
  o90: number; q90: number; r90: number;
  m7: number; m30: number;
}

const ZERO = (): Counts => ({ i7: 0, i30: 0, i90: 0, v7: 0, v30: 0, c30: 0, a30: 0, o90: 0, q90: 0, r90: 0, m7: 0, m30: 0 });

interface EventRow {
  event?: string | null;
  occurred_at?: string | null;
  item_ids?: unknown;
}

interface OrderRow {
  items?: unknown;
  created_at?: string | null;
  status?: string | null;
}

export interface AggregatedProduct extends Counts {
  id: string;
}

let cached: { at: number; products: AggregatedProduct[] } | null = null;

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString();
}

/** Extract referenced product ids from an event's item_ids (string | string[] | object). */
function idsOf(itemIds: unknown): string[] {
  if (typeof itemIds === 'string') return itemIds ? [itemIds] : [];
  if (Array.isArray(itemIds)) {
    return itemIds.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (itemIds && typeof itemIds === 'object') {
    return Object.values(itemIds as Record<string, unknown>).filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

/**
 * Pure aggregation — exported for tests. Walks event + paid-order rows and
 * returns per-product counts keyed by product id.
 */
export function aggregateMerchStats(
  events: EventRow[],
  orders: OrderRow[],
  now: number = Date.now(),
): Map<string, Counts> {
  const acc = new Map<string, Counts>();
  const at = (id: string): Counts => {
    let c = acc.get(id);
    if (!c) { c = ZERO(); acc.set(id, c); }
    return c;
  };
  const d7 = now - 7 * 86_400_000;
  const d90 = now - 90 * 86_400_000;

  for (const e of events) {
    const event = e.event || '';
    const t = e.occurred_at ? Date.parse(e.occurred_at) : NaN;
    const inWindow = (days: number) => Number.isFinite(t) && t >= now - days * 86_400_000;
    const isList = event === 'view_item_list';
    for (const id of idsOf(e.item_ids)) {
      const c = at(id);
      // Any-touch momentum (all event kinds, incl. orders handled below).
      c.m30 += 1;
      if (inWindow(7)) c.m7 += 1;
      if (!isList) {
        if (event === 'view_item') {
          c.v30 += 1;
          if (inWindow(7)) c.v7 += 1;
        } else if (event === 'select_item') {
          c.c30 += 1;
        } else if (event === 'add_to_cart') {
          c.a30 += 1;
        }
        continue;
      }
      // view_item_list → list impressions only.
      if (inWindow(90)) c.i90 += 1;
      if (inWindow(30)) c.i30 += 1;
      if (inWindow(7)) c.i7 += 1;
    }
  }

  const PAID = new Set(['paid', 'processing', 'shipped', 'delivered']);
  for (const o of orders) {
    if (!o.items || !Array.isArray(o.items)) continue;
    if (o.status && !PAID.has(o.status)) continue;
    const t = o.created_at ? Date.parse(o.created_at) : NaN;
    if (!(Number.isFinite(t) && t >= d90)) continue;
    for (const line of o.items as unknown[]) {
      if (!line || typeof line !== 'object') continue;
      const l = line as { id?: unknown; quantity?: unknown; unitPrice?: unknown };
      if (typeof l.id !== 'string' || !l.id) continue;
      const c = at(l.id);
      const qty = Number(l.quantity);
      const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
      c.o90 += 1;
      c.q90 += q;
      const up = Number(l.unitPrice);
      if (Number.isFinite(up) && up > 0)      c.r90 = Math.round((c.r90 + up * q) * 100) / 100;
      c.m30 += 1;
      if (Number.isFinite(t) && t >= d7) c.m7 += 1;
    }
  }
  return acc;
}

async function restList<T>(cfg: { url: string; serviceRole: string }, table: string, query: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const res = await fetch(`${cfg.url}/rest/v1/${table}${query}&limit=${PAGE_SIZE}`, {
      headers: {
        ...supabaseHeaders(cfg.serviceRole),
        Range: `${start}-${start + PAGE_SIZE - 1}`,
        Prefer: 'count=exact',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Compute fresh stats and store them in the in-memory cache. Returns ok flag. */
export async function recomputeMerchStats(): Promise<boolean> {
  const cfg = supabaseAdmin();
  if (!cfg) return false;
  try {
    const now = Date.now();
    const [events, orders] = await Promise.all([
      restList<EventRow>(
        cfg,
        'site_events',
        `?select=event,occurred_at,item_ids&occurred_at=gte.${encodeURIComponent(isoDaysAgo(90, now))}&event=in.(view_item_list,view_item,select_item,add_to_cart,purchase)`,
      ),
      restList<OrderRow>(
        cfg,
        'luxedge_orders',
        `?select=items,created_at,status,coupon_code&status=in.(paid,processing,shipped,delivered)&coupon_code=not.eq.PET-GIFT-DROP&created_at=gte.${encodeURIComponent(isoDaysAgo(180, now))}`,
      ),
    ]);
    if (!events || !orders) return false;
    const agg = aggregateMerchStats(events, orders, now);
    const products: AggregatedProduct[] = [];
    for (const [id, c] of agg) {
      products.push({ id, ...c });
    }
    cached = { at: now, products };
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed — GET only' });
    return;
  }
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    sendJson(res, 200, { ok: true, at: new Date(cached.at).toISOString(), products: cached.products });
    return;
  }
  const ok = await recomputeMerchStats();
  if (!ok) {
    // A stats outage must never break the storefront: the client falls back
    // to flag/availability ordering when ok !== true.
    sendJson(res, 200, { ok: false, reason: 'unavailable' });
    return;
  }
  sendJson(res, 200, { ok: true, at: new Date(cached!.at).toISOString(), products: cached!.products });
}
