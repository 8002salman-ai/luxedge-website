// ============================================================================
// LUXEDGE V2 — CJ SUPPLIER DEDUPE (Phase 4C)
//
// Stable supplier identifiers first: provider + CJ product ID + SKU/variant.
// URL normalization is a fallback only — CJ product IDs and SKUs are the
// authoritative identity across repeated searches, so the same product is
// never duplicated even if its page URL changes.
// ============================================================================

import type { SupplierProductRecord } from '../types';

/** Authoritative dedupe key: cj:{pid} (variant-independent). */
export function cjProductKey(productId: string): string {
  return `cj:${productId.trim().toUpperCase()}`;
}

/** Variant-level key: cj:{pid}:{vid}. */
export function cjVariantKey(productId: string, variantId: string | null | undefined): string {
  return `${cjProductKey(productId)}${variantId ? ':' + variantId.trim().toUpperCase() : ''}`;
}

/** SKU-based key (used when pid is unavailable — should be rare). */
export function cjSkuKey(sku: string): string {
  return `cj:sku:${sku.trim().toUpperCase()}`;
}

/** The dedupe key for a normalized record (prefers pid, falls back to SKU). */
export function dedupeKeyForRecord(r: SupplierProductRecord): string {
  return r.productId ? cjProductKey(r.productId) : r.sku ? cjSkuKey(r.sku) : r.sourceUrl;
}

/** Build a set of known CJ keys from previously seen records (cheap O(1) lookup). */
export function buildKnownCjKeys(records: Pick<SupplierProductRecord, 'productId' | 'sku'>[]): Set<string> {
  const keys = new Set<string>();
  for (const r of records) {
    if (r.productId) keys.add(cjProductKey(r.productId));
    if (r.sku) keys.add(cjSkuKey(r.sku));
  }
  return keys;
}

/** True when the record's key is already known (duplicate across searches). */
export function isKnownCjRecord(r: SupplierProductRecord, known: Set<string>): boolean {
  return known.has(dedupeKeyForRecord(r));
}
