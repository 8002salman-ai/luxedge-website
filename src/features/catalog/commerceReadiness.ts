// ============================================================================
// LUXEDGE V2 — COMMERCE READINESS MODEL (Commerce Truth Fix)
//
// A single deterministic model that classifies every catalog product:
//
//   commerce_readiness
//     COMMERCE_READY       — genuine supplier + cost basis + fulfillment
//     SOURCE_PENDING       — no verified purchasing path (retail-ref only)
//     ECONOMICS_PENDING    — supplier exists but cost/landed unknown
//     FULFILLMENT_PENDING  — cost known but stock/shipping not verified
//     RISK_REVIEW          — unresolved critical risk (battery/IP/regulatory)
//     DRAFT                — not storefront-eligible lifecycle status
//
//   source_type
//     CJ_DROPSHIPPING / AUTHORIZED_WHOLESALE / MANUFACTURER_DIRECT /
//     RETAIL_REFERENCE_ONLY / OWNER_STOCK / OTHER_VERIFIED / UNKNOWN
//
//   inventory_source
//     SUPPLIER_VERIFIED / INTERNAL_STOCK / UNTRACKED / UNKNOWN
//
// TRUTH RULES: never guess. UNKNOWN stays UNKNOWN. Manufacturer retail
// reference proves authenticity — it does NOT prove a purchasing path.
// ============================================================================

export type CommerceReadiness =
  | 'COMMERCE_READY'
  | 'SOURCE_PENDING'
  | 'ECONOMICS_PENDING'
  | 'FULFILLMENT_PENDING'
  | 'RISK_REVIEW'
  | 'DRAFT';

export type SourceType =
  | 'CJ_DROPSHIPPING'
  | 'AUTHORIZED_WHOLESALE'
  | 'MANUFACTURER_DIRECT'
  | 'RETAIL_REFERENCE_ONLY'
  | 'OWNER_STOCK'
  | 'OTHER_VERIFIED'
  | 'UNKNOWN';

export type InventorySource = 'SUPPLIER_VERIFIED' | 'INTERNAL_STOCK' | 'UNTRACKED' | 'UNKNOWN';

export interface ReadinessFacts {
  status?: string;
  /** supplier_source free-text, e.g. 'CJ' or 'KONG Company (official manufacturer)'. */
  supplierSource?: string | null;
  supplierProductRef?: string | null;
  supplierUrl?: string | null;
  costPrice?: number;
  landedCost?: number;
  shippingCost?: number;
  freeShipping?: boolean;
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;
  usInventory?: boolean;
  stockStatus?: string | null;
  inventoryQty?: number;
  riskFlags?: string[];
}

/** Derive source_type from persisted evidence. Manufacturer pages = retail reference only. */
export function deriveSourceType(f: ReadinessFacts): SourceType {
  const src = String(f.supplierSource || '').toLowerCase();
  const ref = String(f.supplierProductRef || '').toLowerCase();
  const url = String(f.supplierUrl || '').toLowerCase();
  if (src.includes('cj') || ref.startsWith('cj') || /cjdropshipping/.test(url)) return 'CJ_DROPSHIPPING';
  if (/kong|official manufacturer|manufacturer page/i.test(src)) return 'RETAIL_REFERENCE_ONLY';
  if (src) return 'OTHER_VERIFIED';
  return 'UNKNOWN';
}

/** Derive inventory_source truthfully. Internal qty is NOT supplier stock. */
export function deriveInventorySource(f: ReadinessFacts): InventorySource {
  // Supplier-verified only when there is real supplier stock evidence.
  if (f.usInventory === true && f.stockStatus === 'in_stock') return 'SUPPLIER_VERIFIED';
  if (f.stockStatus && f.stockStatus !== 'unknown' && f.stockStatus !== 'out_of_stock') return 'INTERNAL_STOCK';
  return 'UNKNOWN';
}

/** A product is storefront-eligible only when it is genuinely COMMERCE_READY. */
export function isCommerceReady(f: ReadinessFacts): boolean {
  return deriveCommerceReadiness(f) === 'COMMERCE_READY';
}

/**
 * Deterministic readiness from persisted facts.
 * - Lifecycle not active/published → DRAFT.
 * - No verified purchasing path (retail-ref only or unknown source) → SOURCE_PENDING.
 * - No cost/landed basis → ECONOMICS_PENDING.
 * - Cost known but no stock/shipping evidence → FULFILLMENT_PENDING.
 * - Unresolved critical risk flags → RISK_REVIEW.
 * - Otherwise COMMERCE_READY.
 */
export function deriveCommerceReadiness(f: ReadinessFacts): CommerceReadiness {
  if (f.status && f.status !== 'active' && f.status !== 'published') return 'DRAFT';

  const sourceType = deriveSourceType(f);
  if (sourceType === 'RETAIL_REFERENCE_ONLY' || sourceType === 'UNKNOWN') return 'SOURCE_PENDING';

  const hasCost = (f.costPrice ?? 0) > 0 || (f.landedCost ?? 0) > 0;
  if (!hasCost) return 'ECONOMICS_PENDING';

  // USA fulfillment/stock evidence: real list-level US inventory (or a real
  // supplier in_stock state). Per-product shipping cost is handled by the
  // storewide checkout model (calculated at checkout), so it does not block
  // readiness by itself — but a missing US fulfillment basis does.
  const hasFulfillment = f.usInventory === true ||
    (f.stockStatus === 'in_stock' && (f.inventoryQty ?? 0) > 0);
  if (!hasFulfillment) return 'FULFILLMENT_PENDING';

  const risk = (f.riskFlags || []).some((r) => /battery|ip|trademark|regulatory|compliance/i.test(r));
  if (risk) return 'RISK_REVIEW';

  return 'COMMERCE_READY';
}

export const COMMERCE_READINESS_LABELS: Record<CommerceReadiness, string> = {
  COMMERCE_READY: 'Commerce Ready',
  SOURCE_PENDING: 'Source Pending',
  ECONOMICS_PENDING: 'Economics Pending',
  FULFILLMENT_PENDING: 'Fulfillment Pending',
  RISK_REVIEW: 'Risk Review',
  DRAFT: 'Draft',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  CJ_DROPSHIPPING: 'CJ Dropshipping',
  AUTHORIZED_WHOLESALE: 'Authorized Wholesale',
  MANUFACTURER_DIRECT: 'Manufacturer Direct',
  RETAIL_REFERENCE_ONLY: 'Retail Reference Only',
  OWNER_STOCK: 'Owner Stock',
  OTHER_VERIFIED: 'Other Verified',
  UNKNOWN: 'Unknown',
};

export const INVENTORY_SOURCE_LABELS: Record<InventorySource, string> = {
  SUPPLIER_VERIFIED: 'Supplier Verified',
  INTERNAL_STOCK: 'Internal Stock',
  UNTRACKED: 'Untracked',
  UNKNOWN: 'Unknown',
};
