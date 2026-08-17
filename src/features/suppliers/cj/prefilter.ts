// ============================================================================
// LUXEDGE V2 — CJ DETERMINISTIC PREFILTER (Phase 4C)
//
// Runs BEFORE any expensive AI reasoning. Drops supplier records that can
// never become a qualified winner: non-pet drift, no price, no stock,
// unusable images, impossible margin, or IP/regulatory red flags. Exact
// reasons are recorded — never silent.
// ============================================================================

import type { SupplierProductRecord } from '../types';
import { normalizeCountryCode } from './normalize';

export interface PrefilterOutcome {
  ok: boolean;
  reason?: string;
}

const PET_RE = /(dog|puppy|cat|kitten|pet|canine|feline|bird|hamster|guinea|rabbit|fish|aquarium|aquatic|reptile|parrot|treat|chew|leash|harness|collar|bed|scratch|groom|carrier|crate|litter|aquarium|aquatic)/i;

/** Obvious IP/counterfeit or regulatory red flags in the title/category. */
const IP_RE = /(\bgucci\b|\bchanel\b|\blouis vuitton\b|\bhermes\b|\bnike\b|\badidas\b|disney|pokemon|marvel|star wars|spider-?man|barbie|lego|"branded|counterfeit|replica|knockoff|fake\b)/i;
const MED_RE = /(veterinary|veterinarian|prescription|medication|antibiotic|steroid|inject|vaccine|antiseptic|fungal|bacterial|treatment for (?!.*toy))/i;
const BATTERY_RE = /(lithium|li-?ion|220v|110v|electric shock|heating pad.*electric|heated.*120v)/i;

/** Default max supplier cost considered viable (configurable per search). */
export const DEFAULT_MAX_SUPPLIER_COST = 40;

/**
 * Deterministic prefilter for one CJ record. Does NOT score — it only
 * removes records that can never qualify. Returns ok:true to keep.
 */
export function prefilterCjRecord(
  r: SupplierProductRecord,
  opts: { maxSupplierCost?: number; requireUsInventory?: boolean; market?: string } = {}
): PrefilterOutcome {
  // 1) Actual product record?
  if (!r.productId || !r.title) return { ok: false, reason: 'no actual product: missing CJ product id or title' };
  if (!r.sku) return { ok: false, reason: 'missing critical supplier data: no CJ SKU' };

  // 2) Non-pet drift.
  if (!PET_RE.test(r.title) && !(r.category || '').match(PET_RE)) {
    return { ok: false, reason: 'non-pet drift: title/category does not indicate a pet product' };
  }

  // 3) IP / counterfeit / regulatory risk.
  if (IP_RE.test(r.title) || IP_RE.test(r.category || '')) {
    return { ok: false, reason: 'counterfeit/IP risk: title/category suggests a branded copy' };
  }
  if (MED_RE.test(r.title) || MED_RE.test(r.category || '')) {
    return { ok: false, reason: 'medical/veterinary claim requires evidence — rejected' };
  }
  if (BATTERY_RE.test(r.title) || BATTERY_RE.test(r.category || '')) {
    return { ok: false, reason: 'battery/fire risk: lithium/electric product without justification' };
  }

  // 4) Real supplier price.
  if (r.sellPrice === null || r.sellPrice <= 0) {
    return { ok: false, reason: 'missing price: no supplier sell price returned by CJ' };
  }
  const maxCost = opts.maxSupplierCost ?? DEFAULT_MAX_SUPPLIER_COST;
  if (r.sellPrice > maxCost) {
    return { ok: false, reason: `supplier cost $${r.sellPrice.toFixed(2)} exceeds configured max $${maxCost.toFixed(2)}` };
  }
  // Impossibly thin margin — < $1 supplier cost is either an error or a
  // no-margin listing.
  if (r.sellPrice < 1) {
    return { ok: false, reason: 'impossible margin: supplier cost below $1' };
  }

  // 5) Usable images.
  if (!r.images.length || !r.imageUrl) {
    return { ok: false, reason: 'unusable images: CJ returned no product image' };
  }

  // 6) US inventory (only when the search targets the US and CJ reported it).
  const country = normalizeCountryCode(opts.market);
  if (country === 'US' && opts.requireUsInventory !== false) {
    if (r.usInventoryTotal === null) {
      return { ok: false, reason: 'unclear US inventory: CJ returned no US stock figure' };
    }
    if (r.usInventoryTotal <= 0) {
      return { ok: false, reason: 'unavailable: zero US inventory reported by CJ' };
    }
  }

  return { ok: true };
}

/** Batch prefilter: returns the survivors + per-record reasons. */
export function prefilterCjRecords(
  records: SupplierProductRecord[],
  opts: { maxSupplierCost?: number; requireUsInventory?: boolean; market?: string } = {}
): { kept: SupplierProductRecord[]; rejected: { record: SupplierProductRecord; reason: string }[] } {
  const kept: SupplierProductRecord[] = [];
  const rejected: { record: SupplierProductRecord; reason: string }[] = [];
  for (const r of records) {
    const out = prefilterCjRecord(r, opts);
    if (out.ok) kept.push(r);
    else rejected.push({ record: r, reason: out.reason || 'unknown prefilter rejection' });
  }
  return { kept, rejected };
}
