import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICING_RULES,
  sanitizePricingRules,
  loadPricingRules,
  savePricingRules,
  roundToPsychological,
  computePricing,
  priceClearsMinimumMargin,
} from '../pricing';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('roundToPsychological', () => {
  it('rounds up to the nearest .99', () => {
    expect(roundToPsychological(12)).toBe(12.99);
    expect(roundToPsychological(11.01)).toBe(11.99);
    expect(roundToPsychological(0.5)).toBe(0.99);
  });
});

describe('computePricing', () => {
  it('stays UNKNOWN when supplier cost is missing (no fake margin)', () => {
    const p = computePricing(null, 4.99);
    expect(p.suggestedPrice).toBeNull();
    expect(p.grossMarginRate).toBeNull();
    expect(p.landedCost).toBeNull();
  });

  it('stays UNKNOWN when shipping cost is missing (no fake margin)', () => {
    const p = computePricing(9.99, null);
    expect(p.suggestedPrice).toBeNull();
    expect(p.grossMarginRate).toBeNull();
    expect(p.notes.some((n) => /shipping/i.test(n))).toBe(true);
  });

  it('computes landed cost, fee, price, profit and margin from real inputs', () => {
    // supplier $9.99 + shipping $4.99 = $14.98 landed.
    const p = computePricing(9.99, 4.99);
    expect(p.landedCost).toBe(14.98);
    expect(p.suggestedPrice).not.toBeNull();
    expect(p.paymentFee).not.toBeNull();
    expect(p.grossProfit).not.toBeNull();
    expect(p.grossMarginRate).not.toBeNull();
    expect(p.grossMarginRate!).toBeGreaterThan(0);
  });

  it('produces a psychologically rounded .99 price by default', () => {
    const p = computePricing(10, 5);
    expect(p.suggestedPrice).not.toBeNull();
    const cents = Math.round((p.suggestedPrice! % 1) * 100);
    expect(cents).toBe(99);
  });

  it('honors disabled psychological pricing (exact target price)', () => {
    const p = computePricing(10, 5, { ...DEFAULT_PRICING_RULES, psychologicalPricing: false });
    expect(p.suggestedPrice).toBe(p.targetPrice);
  });

  it('flags prices below the configured minimum margin', () => {
    const tight = { ...DEFAULT_PRICING_RULES, desiredMarginRate: 0.1, minMarginRate: 0.4 };
    const p = computePricing(10, 5, tight);
    expect(p.suggestedPrice).not.toBeNull();
    expect(p.belowMinMargin).toBe(true);
    expect(priceClearsMinimumMargin(p)).toBe(false);
  });

  it('clears the margin guard for healthy margins', () => {
    const p = computePricing(10, 5, { ...DEFAULT_PRICING_RULES, minMarginRate: 0.1 });
    expect(p.belowMinMargin).toBe(false);
    expect(priceClearsMinimumMargin(p)).toBe(true);
  });

  it('rejects impossible rules (fee + margin >= 100%)', () => {
    const p = computePricing(10, 5, { ...DEFAULT_PRICING_RULES, paymentFeeRate: 0.4, desiredMarginRate: 0.7 });
    expect(p.suggestedPrice).toBeNull();
    expect(p.belowMinMargin).toBe(true);
  });
});

describe('pricing rules persistence', () => {
  it('returns safe defaults when nothing is stored', () => {
    expect(loadPricingRules(memoryStorage({}))).toEqual(DEFAULT_PRICING_RULES);
  });

  it('round-trips custom rules and clamps invalid rates', () => {
    const s = memoryStorage({});
    savePricingRules({ paymentFeeRate: 0.05, desiredMarginRate: 0.45, minMarginRate: 0.3, psychologicalPricing: false }, s);
    const loaded = loadPricingRules(s);
    expect(loaded.paymentFeeRate).toBe(0.05);
    expect(loaded.desiredMarginRate).toBe(0.45);
    expect(loaded.minMarginRate).toBe(0.3);
    expect(loaded.psychologicalPricing).toBe(false);
  });

  it('recovers from corrupt storage', () => {
    expect(loadPricingRules(memoryStorage({ luxedge_pricing_rules: '{{{not json' }))).toEqual(DEFAULT_PRICING_RULES);
  });

  it('sanitizes out-of-range and NaN rates', () => {
    const clean = sanitizePricingRules({ paymentFeeRate: Number.NaN, desiredMarginRate: 2, minMarginRate: -1 });
    expect(clean.paymentFeeRate).toBe(DEFAULT_PRICING_RULES.paymentFeeRate);
    expect(clean.desiredMarginRate).toBe(0.99);
    expect(clean.minMarginRate).toBe(0);
  });
});
