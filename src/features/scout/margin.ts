// ============================================================================
// LUXEDGE V2 — SCOUT PRICING / MARGIN MODEL
//
// Calculated separately from the opportunity score. The proposed Luxedge
// price is an INFERRED suggestion (landed cost × markup, rounded to a
// consumer-friendly .99), never a verified market price.
//
// When shipping cost is unknown the landed cost is null, margin confidence
// is LOW, and the candidate must not be auto-approved.
// ============================================================================

import type { MarginCalc } from './types';

export const DEFAULT_MARKUP = 2.5;
export const MIN_AUTO_APPROVE_MARGIN_PCT = 0.25;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round up to the nearest .99 retail price (e.g. 12.00 → 12.99, 11.01 → 11.99). */
function toRetail(n: number): number {
  const ceil = Math.ceil(n);
  return Math.max(0.99, ceil - 0.01);
}

export interface MarginInput {
  supplierPrice: number | null;
  shippingCost: number | null;
  /** Suggested retail markup over landed cost. Default 2.5. */
  markup?: number;
}

export function calculateMargin(input: MarginInput): MarginCalc {
  const { supplierPrice, shippingCost } = input;
  const markup = input.markup ?? DEFAULT_MARKUP;
  const notes: string[] = [];

  const landedCost = supplierPrice !== null && shippingCost !== null
    ? round2(supplierPrice + shippingCost)
    : null;
  const proposedLuxedgePrice = landedCost !== null ? toRetail(landedCost * markup) : null;
  const grossMarginDollars = landedCost !== null && proposedLuxedgePrice !== null
    ? round2(proposedLuxedgePrice - landedCost)
    : null;
  const grossMarginPct = proposedLuxedgePrice !== null && grossMarginDollars !== null
    ? round2(grossMarginDollars / proposedLuxedgePrice)
    : null;

  if (supplierPrice === null) notes.push('Supplier price UNKNOWN — landed cost cannot be computed.');
  if (shippingCost === null) notes.push('Shipping cost UNKNOWN — margin confidence LOW, do not auto-approve.');
  if (supplierPrice !== null && shippingCost !== null) {
    notes.push(`Landed cost ${landedCost} (supplier ${supplierPrice} + shipping ${shippingCost}).`);
    notes.push(`Suggested Luxedge price ${proposedLuxedgePrice} is INFERRED (${markup}× landed, rounded to .99).`);
  }

  // Spec: when shipping/cost is unknown, margin confidence is LOW — the
  // candidate must not be auto-approved regardless of supplier price.
  const confidence: MarginCalc['confidence'] =
    supplierPrice !== null && shippingCost !== null ? 'high' : 'low';

  return {
    supplierPrice,
    shippingCost,
    landedCost,
    proposedLuxedgePrice,
    grossMarginDollars,
    grossMarginPct,
    confidence,
    notes,
  };
}

/** Whether the margin model is strong enough to allow auto-approval. */
export function marginAllowsAutoApprove(m: MarginCalc): boolean {
  return m.confidence === 'high' && m.grossMarginPct !== null && m.grossMarginPct >= MIN_AUTO_APPROVE_MARGIN_PCT;
}
