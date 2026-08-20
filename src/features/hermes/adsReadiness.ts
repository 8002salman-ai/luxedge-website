// ============================================================================
// LUXEDGE — ADS READINESS (planning input only, Luxedge economics authority)
//
// Computes a deterministic ads-readiness assessment from LUXEDGE's own
// verified product economics. Hermes ads intelligence is research only; the
// numbers here come from Luxedge's cost/price data, never from Hermes claims.
//
// Honesty rules:
//   - Unknown economics stay UNKNOWN (null), never treated as zero.
//   - `allowableCac` is intentionally null unless the owner sets a target
//     ratio — Luxedge never invents a budget.
//   - `breakEvenCac` = contribution margin per unit (one sale's contribution
//     covers that acquisition spend).
//   - This NEVER launches a campaign or spends money.
// ============================================================================

import type { AdsReadinessLevel } from './types';

export interface AdsEconomicsInput {
  sellingPrice: number | null;
  landedCost: number | null;
  estimatedVariableCosts: number | null;
}

export interface AdsReadinessResult {
  grossMargin: number | null;            // % (0..100)
  contributionMargin: number | null;     // $ per unit
  breakEvenCac: number | null;           // $ per unit (when contribution known)
  allowableCac: number | null;           // always null until owner sets a target
  readiness: AdsReadinessLevel;
  assessment: string;
}

/** Deterministic thresholds — documented Luxedge business rules. */
const POSSIBLE_MARGIN = 20;   // ≥20% gross margin → ads "possible"
const PROMISING_MARGIN = 35;  // ≥35% → "promising"
const STRONG_MARGIN = 50;     // ≥50% with real contribution → "strong"

export function computeAdsReadiness(input: AdsEconomicsInput): AdsReadinessResult {
  const { sellingPrice, landedCost, estimatedVariableCosts } = input;

  let grossMargin: number | null = null;
  if (sellingPrice && sellingPrice > 0 && landedCost !== null && landedCost >= 0) {
    grossMargin = Math.round(((sellingPrice - landedCost) / sellingPrice) * 10000) / 100;
  }

  // Contribution margin only when variable costs are ACTUALLY known — an
  // unknown variable cost is not zero.
  let contributionMargin: number | null = null;
  if (sellingPrice && sellingPrice > 0 && landedCost !== null && landedCost >= 0 && estimatedVariableCosts !== null && estimatedVariableCosts >= 0) {
    contributionMargin = Math.round((sellingPrice - landedCost - estimatedVariableCosts) * 100) / 100;
  }

  const breakEvenCac = contributionMargin !== null && contributionMargin > 0 ? contributionMargin : null;
  const allowableCac = null; // owner-set target required — never invented

  let readiness: AdsReadinessLevel;
  let assessment: string;
  if (sellingPrice === null || sellingPrice <= 0 || landedCost === null) {
    readiness = 'insufficient_data';
    assessment = 'Cannot assess — missing verified selling price or landed cost.';
  } else if (grossMargin === null || grossMargin < POSSIBLE_MARGIN) {
    readiness = 'possible';
    assessment = `Gross margin ${grossMargin === null ? 'unknown' : grossMargin + '%'} — ads economics not compelling yet (below ${POSSIBLE_MARGIN}% gross margin).`;
  } else if (grossMargin >= STRONG_MARGIN && contributionMargin !== null && contributionMargin > 0) {
    readiness = 'strong';
    assessment = `Strong unit economics for ads consideration: ${grossMargin}% gross margin, $${contributionMargin.toFixed(2)} contribution per unit.`;
  } else if (grossMargin >= PROMISING_MARGIN) {
    readiness = 'promising';
    assessment = `Promising ads economics: ${grossMargin}% gross margin. Contribution per unit ${contributionMargin === null ? 'unknown (variable costs not verified)' : '$' + contributionMargin.toFixed(2)}.`;
  } else {
    readiness = 'possible';
    assessment = `Gross margin ${grossMargin}% supports only cautious ads consideration.`;
  }

  return { grossMargin, contributionMargin, breakEvenCac, allowableCac, readiness, assessment };
}
