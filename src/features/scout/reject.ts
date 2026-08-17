// ============================================================================
// LUXEDGE V2 — SCOUT HARD REJECTION FILTERS
//
// Deterministic rule checks. Any match → the candidate is REJECTED with an
// exact reason. These are conservative: when evidence is missing the check
// does NOT auto-reject (except for a few categories where absence of a
// verifiable supplier itself is disqualifying — recorded as such).
// ============================================================================

import type { PageExtract } from './types';
import type { MarginCalc } from './types';

export interface Rejection {
  reason: string;
  detail: string;
}

const COUNTERFEIT_RE = /(?:inspired by|style of|knockoff|replica|dupe|copy of|unbranded version of)\s+[A-Z][A-Za-z]+/i;
const MEDICAL_RE = /(?:treats?|cures?|heals?|relieves?|stops?)\s+(?:arthritis|anxiety|pain|infection|allergy|diabetes|tumor|cancer|seizure|itching|tearing)\b|(?:arthritis|anxiety|pain|allergy|diabetes|cancer)\s+(?:treatment|cure|relief|remedy)|medical\s+grade|veterinary\s+(?:grade|strength)|therapeutic\s+claim/i;
const DANGEROUS_RE = /shock\s+collar|electric\s+collar|stun\s+collar|pepper\s+spray|mace|poison|pesticide|rodenticide|insecticide/i;
const BATTERY_FIRE_RE = /lithium|li-?ion|hoverboard|e-?bike|electric\s+scooter|space\s+heater|blow\s+torch/i;
const FRAGILE_RE = /^(?:glass|ceramic|porcelain)\b|fragile|easily\s+break/i;
const MISLEADING_RE = /guaranteed\s+results?|#1\s+(?:best\s+)?seller|miracle\s+(?:cure|treatment)|instant\s+(?:results?|cure)|100%\s+(?:safe|effective)\b/i;
const REGULATED_DRUG_RE = /prescription|cbd\s+oil|melatonin\s+treats?|pharmaceutical/i;

/** All checks run; returns the first hard rejection (or null). */
export function applyRejectFilters(input: {
  title: string;
  extract: PageExtract;
  margin: MarginCalc;
  images: string[];
}): Rejection | null {
  const { title, extract, margin, images } = input;

  if (COUNTERFEIT_RE.test(title)) {
    return { reason: 'counterfeit/IP risk', detail: `Title matches a branded-copy pattern: "${title}"` };
  }
  if (MEDICAL_RE.test(title)) {
    return { reason: 'medical/veterinary claim', detail: `Title makes an unverified medical/veterinary claim: "${title}"` };
  }
  if (DANGEROUS_RE.test(title)) {
    return { reason: 'dangerous/regulated product', detail: `Title references a dangerous/regulated category: "${title}"` };
  }
  if (REGULATED_DRUG_RE.test(title)) {
    return { reason: 'regulated substance', detail: `Title references a regulated substance: "${title}"` };
  }
  if (BATTERY_FIRE_RE.test(title)) {
    return { reason: 'battery/fire risk', detail: `Title references high battery/fire risk: "${title}"` };
  }
  if (FRAGILE_RE.test(title)) {
    return { reason: 'fragile/high-return risk', detail: `Title references a fragile/high-return category: "${title}"` };
  }
  if (MISLEADING_RE.test(title)) {
    return { reason: 'misleading claim', detail: `Title contains an unverifiable marketing claim: "${title}"` };
  }

  if (extract.availability === 'unavailable') {
    return { reason: 'unavailable', detail: 'Source page indicates the product is out of stock / unavailable.' };
  }
  if (extract.price === null) {
    return { reason: 'unclear landed cost', detail: 'No current supplier price could be extracted from the source page.' };
  }
  if (images.length === 0) {
    return { reason: 'unusable images', detail: 'No product images could be extracted from the source page.' };
  }

  // Poor USA delivery: only reject when we have *positive* evidence of a
  // long shipping window or non-US origin without a US warehouse signal.
  if (extract.shippingDays && extract.shippingDays.max > 21) {
    return { reason: 'poor USA delivery', detail: `Estimated delivery up to ${extract.shippingDays.max} days (evidence from source).` };
  }
  if (extract.origin && /china|aliexpress/i.test(extract.origin) && !extract.freeShipping) {
    return { reason: 'poor USA delivery', detail: `Origin ${extract.origin} with no US-warehouse/free-shipping evidence.` };
  }

  // Insufficient margin: reject only when the margin is fully computable.
  if (margin.confidence === 'high' && margin.grossMarginPct !== null && margin.grossMarginPct < 0.25) {
    return { reason: 'insufficient margin', detail: `Gross margin ${(margin.grossMarginPct * 100).toFixed(1)}% is below the 25% floor.` };
  }

  return null;
}

/** Human-readable risk flags surfaced in the UI (non-rejecting warnings). */
export function collectRiskFlags(input: {
  title: string;
  extract: PageExtract;
  margin: MarginCalc;
}): string[] {
  const flags: string[] = [];
  const { title, extract, margin } = input;

  if (/lithium|li-?ion/i.test(title)) flags.push('Battery powered');
  if (/heating|heated|warming/i.test(title)) flags.push('Heated — verify safety cert');
  if (extract.availability === 'unknown') flags.push('Availability unverified');
  if (extract.shippingDays === null) flags.push('USA delivery window unverified');
  if (margin.confidence !== 'high') flags.push('Margin confidence low — no auto-approve');
  if (extract.rating === null) flags.push('No rating/review evidence found');

  return flags;
}
