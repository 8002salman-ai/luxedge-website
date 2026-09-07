import { describe, it, expect } from 'vitest';
import { aggregateMerchStats } from '../merch-stats';

const NOW = Date.parse('2026-09-07T12:00:00Z');

const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('aggregateMerchStats', () => {
  it('counts impressions / views / clicks / atc into their windows', () => {
    const events = [
      { event: 'view_item_list', occurred_at: daysAgo(2), item_ids: ['a', 'b'] },
      { event: 'view_item_list', occurred_at: daysAgo(20), item_ids: ['a'] },
      { event: 'view_item_list', occurred_at: daysAgo(80), item_ids: ['a'] },
      { event: 'view_item', occurred_at: daysAgo(1), item_ids: ['a'] },
      { event: 'view_item', occurred_at: daysAgo(40), item_ids: ['b'] },
      { event: 'select_item', occurred_at: daysAgo(3), item_ids: ['a'] },
      { event: 'add_to_cart', occurred_at: daysAgo(4), item_ids: ['a'] },
      { event: 'add_to_cart', occurred_at: daysAgo(60), item_ids: ['b'] },
    ];
    const agg = aggregateMerchStats(events, [], NOW);
    const a = agg.get('a')!;
    expect(a.i7).toBe(1); // 2d list only
    expect(a.i30).toBe(2);
    expect(a.i90).toBe(3);
    expect(a.v7).toBe(1);
    expect(a.v30).toBe(1);
    expect(a.c30).toBe(1);
    expect(a.a30).toBe(1);
    expect(a.m7).toBe(4); // list(2d) + view(1d) + click(3d) + atc(4d)
    const b = agg.get('b')!;
    expect(b.i90).toBe(1);
    expect(b.v30).toBe(1); // 40d ago view
    expect(b.v7).toBe(0);
  });

  it('attributes paid order lines to products with qty + revenue', () => {
    const orders = [
      {
        status: 'paid',
        created_at: daysAgo(5),
        items: [
          { id: 'x', quantity: 2, unitPrice: 19.99 },
          { id: 'y', quantity: 1, unitPrice: null }, // no price recorded — count unit only
        ],
      },
      { status: 'paid', created_at: daysAgo(120), items: [{ id: 'x', quantity: 1, unitPrice: 19.99 }] }, // outside 90d
      { status: 'refunded', created_at: daysAgo(2), items: [{ id: 'z', quantity: 1, unitPrice: 5 }] }, // excluded
    ];
    const agg = aggregateMerchStats([], orders, NOW);
    const x = agg.get('x')!;
    expect(x.o90).toBe(1);
    expect(x.q90).toBe(2);
    expect(x.r90).toBeCloseTo(39.98);
    const y = agg.get('y')!;
    expect(y.o90).toBe(1);
    expect(y.q90).toBe(1);
    expect(y.r90).toBe(0);
    expect(agg.has('z')).toBe(false);
  });

  it('is empty when nothing references a product', () => {
    expect(aggregateMerchStats([], [], NOW).size).toBe(0);
  });
});
