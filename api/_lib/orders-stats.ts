// ============================================================================
// LUXEDGE — ORDER AGGREGATION (paid-only, server-authoritative)
//
// The admin dashboard used to sum whatever page of orders the client received
// (capped at 50 rows). That made Revenue/Orders/AOV wrong the moment more
// orders existed, and it counted `pending` pre-payment rows and full refunds
// as revenue. All aggregation now lives HERE, computed over the FULL order
// set on the server, with paid-only semantics:
//
//   - statuses that count as paid: paid, processing, shipped, delivered,
//     partially_refunded (money was received)
//   - `pending` / `awaiting_payment` / `failed` / `cancelled` never count
//   - fully-refunded rows (`refunded`) never count
//   - revenue contribution per paid order = max(0, total - refunded_amount)
//     (refunded totals are subtracted, including partial refunds)
//
// The webhook (api/webhook.ts) is the only writer of these statuses and sets
// `refunded_amount`/`refunded_at` from Stripe charge.refunded events.
// ============================================================================

export interface OrderStatsRow {
  status?: string | null;
  total?: number | null;
  refunded_amount?: number | null;
  created_at?: string | null;
}

export interface OrderStats {
  /** Net paid revenue over the full order set (refunds subtracted). */
  revenue: number;
  /** Paid orders (pending/awaiting/failed/cancelled/fully-refunded excluded). */
  paidCount: number;
  /** revenue / paidCount (0 when there are no paid orders). */
  aov: number;
  /** Last 7 days, oldest → today, each bucket = net paid revenue that day. */
  days: { label: string; total: number }[];
}

const PAID_STATUSES = new Set(['paid', 'processing', 'shipped', 'delivered', 'partially_refunded']);

export function isPaidOrder(o: OrderStatsRow): boolean {
  return PAID_STATUSES.has(String(o.status || ''));
}

/** Net revenue contribution: total minus anything refunded (floored at 0). */
export function orderNetTotal(o: OrderStatsRow): number {
  const total = Number(o.total || 0);
  const refunded = Number(o.refunded_amount || 0);
  return Math.max(0, total - refunded);
}

export function computeOrderStats(rows: OrderStatsRow[], now: Date = new Date()): OrderStats {
  let revenue = 0;
  let paidCount = 0;

  const days: { label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), total: 0 });
  }

  for (const o of rows) {
    if (!isPaidOrder(o)) continue;
    const net = orderNetTotal(o);
    revenue += net;
    paidCount += 1;
    const t = o.created_at ? new Date(o.created_at) : null;
    if (t && !Number.isNaN(t.getTime())) {
      // Bucket by local calendar day; ignore anything older than the window.
      const day = new Date(t);
      day.setHours(0, 0, 0, 0);
      const idx = days.findIndex((_, i) => {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (6 - i));
        return start.getTime() === day.getTime();
      });
      if (idx >= 0) days[idx].total += net;
    }
  }

  return { revenue, paidCount, aov: paidCount ? revenue / paidCount : 0, days };
}