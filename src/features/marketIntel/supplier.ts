// ============================================================================
// LUXEDGE — SUPPLIER ECONOMICS
//
// Connects product intelligence to the PET Supplier Database: unit cost, MOQ,
// shipping, USA warehouse, landed cost, delivery time. Profit/ROI math is
// deterministic and only runs on real numbers.
// ============================================================================

import type { ProfitEconomics, SupplierEconomicsEvidence } from './types';

export interface EconomicsInput {
  unitCost: number | null;
  shippingCost: number | null;
  /** Recommended retail multiplier (Luxedge default 2.5x landed). */
  markupMultiplier?: number;
}

/** Landed cost = unit cost + shipping (both must be present). */
export function landedCost(input: EconomicsInput): number | null {
  if (input.unitCost === null || input.unitCost === undefined) return null;
  if (input.shippingCost === null || input.shippingCost === undefined) return null;
  return Math.round((input.unitCost + input.shippingCost) * 100) / 100;
}

export function profitEconomics(input: EconomicsInput): ProfitEconomics {
  const landed = landedCost(input);
  const mult = input.markupMultiplier ?? 2.5;
  const target = landed !== null ? Math.round(landed * mult * 100) / 100 : null;
  const net = landed !== null && target !== null ? Math.round((target - landed) * 100) / 100 : null;
  const marginPct = landed !== null && net !== null && target !== null ? Math.round((net / target) * 1000) / 10 : null;
  const roiPct = landed !== null && net !== null ? Math.round((net / landed) * 1000) / 10 : null;
  return { landedCost: landed, targetSellingPrice: target, expectedNetProfit: net, marginPct, roiPct };
}

/** Map a supplier-database match onto evidence. Missing fields stay null. */
export function supplierEvidenceFromMatch(match: {
  supplierName?: string | null;
  unitCost?: number | null;
  shippingCost?: number | null;
  moq?: number | null;
  usaWarehouse?: boolean | null;
  deliveryMin?: number | null;
  deliveryMax?: number | null;
}): SupplierEconomicsEvidence {
  return {
    status: 'AVAILABLE',
    supplierName: match.supplierName ?? null,
    unitCost: match.unitCost ?? null,
    shippingCost: match.shippingCost ?? null,
    landedCost: landedCost({ unitCost: match.unitCost ?? null, shippingCost: match.shippingCost ?? null }),
    moq: match.moq ?? null,
    usaWarehouse: match.usaWarehouse ?? null,
    deliveryDays:
      match.deliveryMin !== null && match.deliveryMax !== null
        ? { min: match.deliveryMin ?? null, max: match.deliveryMax ?? null }
        : undefined,
  };
}
