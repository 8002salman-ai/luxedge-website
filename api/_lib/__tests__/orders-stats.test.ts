import { describe, it, expect } from 'vitest';
import { computeOrderStats, isPaidOrder, orderNetTotal, type OrderStatsRow } from '../orders-stats.js';

function row(partial: Partial<OrderStatsRow>): OrderStatsRow {
  return { status: 'paid', total: 0, refunded_amount: 0, created_at: '2026-09-01T12:00:00Z', ...partial };
}

const NOW = new Date('2026-09-08T12:00:00Z');

describe('isPaidOrder', () => {
  it.each([
    ['paid', true], ['processing', true], ['shipped', true], ['delivered', true], ['partially_refunded', true],
    ['pending', false], ['awaiting_payment', false], ['failed', false], ['cancelled', false], ['refunded', false],
    ['', false], [null, false],
  ])('status %s → %s', (status, expected) => {
    expect(isPaidOrder(row({ status: status as string | null }))).toBe(expected);
  });
});

describe('orderNetTotal', () => {
  it('subtracts refunded totals, floored at zero', () => {
    expect(orderNetTotal(row({ total: 100, refunded_amount: 30 }))).toBe(70);
    expect(orderNetTotal(row({ total: 100, refunded_amount: 100 }))).toBe(0);
    expect(orderNetTotal(row({ total: 100, refunded_amount: 150 }))).toBe(0);
    expect(orderNetTotal(row({ total: 100, refunded_amount: 0 }))).toBe(100);
    expect(orderNetTotal(row({ total: null }))).toBe(0);
  });
});

describe('computeOrderStats', () => {
  it('pending pre-payment rows never inflate revenue, orders, or AOV', () => {
    const stats = computeOrderStats([
      row({ status: 'paid', total: 100 }),
      row({ status: 'paid', total: 50 }),
      row({ status: 'pending', total: 9999 }),
      row({ status: 'awaiting_payment', total: 8888 }),
      row({ status: 'failed', total: 7777 }),
      row({ status: 'cancelled', total: 6666 }),
    ], NOW);
    expect(stats.revenue).toBe(150);
    expect(stats.paidCount).toBe(2);
    expect(stats.aov).toBe(75);
  });

  it('fully refunded rows never count; partial refunds deduct from revenue', () => {
    const stats = computeOrderStats([
      row({ status: 'refunded', total: 100, refunded_amount: 100 }),
      row({ status: 'partially_refunded', total: 100, refunded_amount: 30 }),
      row({ status: 'paid', total: 40 }),
    ], NOW);
    expect(stats.paidCount).toBe(2); // paid + partially_refunded
    expect(stats.revenue).toBe(110); // (100-30) + 40
    expect(stats.aov).toBe(55);
  });

  it('refunded_amount on a paid row still deducts (Stripe-authoritative)', () => {
    const stats = computeOrderStats([row({ total: 100, refunded_amount: 25 })], NOW);
    expect(stats.revenue).toBe(75);
    expect(stats.paidCount).toBe(1);
  });

  it('aggregates correctly beyond 50 rows (no page cap)', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row({ total: 10 + i }));
    const stats = computeOrderStats(rows, NOW);
    const expected = rows.reduce((s, o) => s + Number(o.total), 0);
    expect(stats.paidCount).toBe(120);
    expect(stats.revenue).toBe(expected);
    expect(stats.aov).toBeCloseTo(expected / 120, 6);
  });

  it('buckets the last 7 days, oldest first, paid-only', () => {
    const iso = (daysAgo: number) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString();
    };
    const stats = computeOrderStats([
      row({ total: 10, created_at: iso(0) }), // today
      row({ total: 20, created_at: iso(1) }),
      row({ total: 40, created_at: iso(6) }),
      row({ total: 80, created_at: iso(7) }), // outside the window
      row({ status: 'pending', total: 500, created_at: iso(0) }),
    ], NOW);
    expect(stats.days).toHaveLength(7);
    expect(stats.days[6].total).toBe(10); // today (last bucket)
    expect(stats.days[5].total).toBe(20); // 1 day ago
    expect(stats.days[0].total).toBe(40); // 6 days ago
    expect(stats.days.reduce((s, d) => s + d.total, 0)).toBe(70); // 7-day sum, pending excluded
  });

  it('returns zeroed stats for an empty order set', () => {
    const stats = computeOrderStats([], NOW);
    expect(stats).toEqual({ revenue: 0, paidCount: 0, aov: 0, days: expect.any(Array) });
    expect(stats.days).toHaveLength(7);
  });
});