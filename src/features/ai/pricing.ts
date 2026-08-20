// ============================================================================
// LUXEDGE V2 — CONFIGURABLE PRICING RULES
//
// Pure, deterministic pricing model used by the AI Product Listing System.
// Selling price is derived from REAL inputs only: supplier cost + shipping
// (landed cost) + payment fee + desired margin, with optional psychological
// rounding. When any required input is UNKNOWN, the result stays UNKNOWN —
// we never fabricate a margin.
//
// Config lives in localStorage (no secrets — these are business rules).
// ============================================================================

export interface PricingRules {
  /** Payment/transaction fee as a fraction of the selling price (0.029 ≈ 2.9%). */
  paymentFeeRate: number;
  /** Desired gross margin as a fraction of the selling price (0.5 = 50%). */
  desiredMarginRate: number;
  /** Minimum allowed gross margin; below this the price needs manual approval. */
  minMarginRate: number;
  /** Round suggested prices to consumer-friendly .99 endings. */
  psychologicalPricing: boolean;
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  paymentFeeRate: 0.029,
  desiredMarginRate: 0.5,
  minMarginRate: 0.25,
  psychologicalPricing: true,
};

const PRICING_RULES_KEY = 'luxedge_pricing_rules';

function clampRate(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, 0), 0.99);
}

export function sanitizePricingRules(input: Partial<PricingRules> | null | undefined): PricingRules {
  const s = input || {};
  return {
    paymentFeeRate: clampRate(Number(s.paymentFeeRate), DEFAULT_PRICING_RULES.paymentFeeRate),
    desiredMarginRate: clampRate(Number(s.desiredMarginRate), DEFAULT_PRICING_RULES.desiredMarginRate),
    minMarginRate: clampRate(Number(s.minMarginRate), DEFAULT_PRICING_RULES.minMarginRate),
    psychologicalPricing: s.psychologicalPricing !== false,
  };
}

export function loadPricingRules(storage?: Pick<Storage, 'getItem'>): PricingRules {
  try {
    const raw = (storage || (typeof window !== 'undefined' ? window.localStorage : null))?.getItem(PRICING_RULES_KEY);
    if (!raw) return { ...DEFAULT_PRICING_RULES };
    return sanitizePricingRules(JSON.parse(raw) as Partial<PricingRules>);
  } catch {
    return { ...DEFAULT_PRICING_RULES };
  }
}

export function savePricingRules(rules: PricingRules, storage?: Pick<Storage, 'setItem'>): void {
  const clean = sanitizePricingRules(rules);
  (storage || (typeof window !== 'undefined' ? window.localStorage : null))?.setItem(PRICING_RULES_KEY, JSON.stringify(clean));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round up to a .99 retail ending (12.00 → 12.99, 11.01 → 11.99, 12.99 → 12.99). */
export function roundToPsychological(n: number): number {
  return Math.max(0.99, Math.ceil(n + 0.01) - 0.01);
}

export interface PricingResult {
  supplierCost: number | null;
  shippingCost: number | null;
  landedCost: number | null;
  /** Payment fee in dollars, computed from the suggested price (null if unknown). */
  paymentFee: number | null;
  /** Exact price that achieves the desired margin (null if inputs unknown). */
  targetPrice: number | null;
  /** Owner-facing suggested price after psychological rounding (null if unknown). */
  suggestedPrice: number | null;
  grossProfit: number | null;
  grossMarginRate: number | null;
  /** True when the suggested price would fall below the configured minimum margin. */
  belowMinMargin: boolean;
  notes: string[];
}

/**
 * Compute suggested pricing from real cost inputs. Every output is UNKNOWN
 * (null) unless supplier cost AND shipping cost are both provided — the two
 * facts a real landed cost requires.
 */
export function computePricing(
  supplierCost: number | null,
  shippingCost: number | null,
  rules: PricingRules = DEFAULT_PRICING_RULES,
): PricingResult {
  const r = sanitizePricingRules(rules);
  const notes: string[] = [];
  const unknown = (msg: string): PricingResult => {
    notes.push(msg);
    return {
      supplierCost,
      shippingCost,
      landedCost: null,
      paymentFee: null,
      targetPrice: null,
      suggestedPrice: null,
      grossProfit: null,
      grossMarginRate: null,
      belowMinMargin: false,
      notes,
    };
  };

  if (supplierCost === null) return unknown('Supplier cost UNKNOWN — cannot price.');
  if (shippingCost === null) return unknown('Shipping cost UNKNOWN — cannot price.');
  if (supplierCost < 0 || shippingCost < 0) return unknown('Negative cost input rejected.');

  const landedCost = round2(supplierCost + shippingCost);
  // Solve P = (L + P·F) / (1 - M)  →  P = L / (1 - F - M)
  const denominator = 1 - r.paymentFeeRate - r.desiredMarginRate;
  if (denominator <= 0) {
    return {
      supplierCost,
      shippingCost,
      landedCost,
      paymentFee: null,
      targetPrice: null,
      suggestedPrice: null,
      grossProfit: null,
      grossMarginRate: null,
      belowMinMargin: true,
      notes: ['Fee rate + desired margin exceed 100% — pricing is impossible with these rules.'],
    };
  }

  const targetPrice = round2(landedCost / denominator);
  const suggestedPrice = round2(r.psychologicalPricing ? roundToPsychological(targetPrice) : targetPrice);
  const paymentFee = round2(suggestedPrice * r.paymentFeeRate);
  const grossProfit = round2(suggestedPrice - landedCost - paymentFee);
  const grossMarginRate = suggestedPrice > 0 ? round2(grossProfit / suggestedPrice) : null;
  const belowMinMargin = grossMarginRate !== null && grossMarginRate < r.minMarginRate;

  notes.push(`Landed cost $${landedCost.toFixed(2)} (supplier $${supplierCost.toFixed(2)} + shipping $${shippingCost.toFixed(2)}).`);
  notes.push(`Payment fee $${paymentFee.toFixed(2)} (${(r.paymentFeeRate * 100).toFixed(1)}%).`);
  notes.push(`Suggested price $${suggestedPrice.toFixed(2)} targets a ${(r.desiredMarginRate * 100).toFixed(0)}% margin (${r.psychologicalPricing ? 'rounded to .99' : 'no psychological rounding'}).`);
  if (belowMinMargin) notes.push(`Below minimum margin (${(r.minMarginRate * 100).toFixed(0)}%) — manual approval required.`);

  return {
    supplierCost,
    shippingCost,
    landedCost,
    paymentFee,
    targetPrice,
    suggestedPrice,
    grossProfit,
    grossMarginRate,
    belowMinMargin,
    notes,
  };
}

/** Whether a computed price clears the minimum-margin guard. */
export function priceClearsMinimumMargin(p: PricingResult): boolean {
  return p.suggestedPrice !== null && p.grossMarginRate !== null && !p.belowMinMargin;
}
