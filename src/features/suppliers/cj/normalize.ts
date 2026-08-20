// ============================================================================
// LUXEDGE V2 — CJ DROPSHIPPING NORMALIZATION (Phase 4C + pre-live hardening)
//
// Converts CJ API V2 responses (product/listV2, product/query,
// logistic/freightCalculate) into the provider-neutral SupplierProductRecord.
// Every field keeps an honest status: VERIFIED when CJ returned it, UNKNOWN
// when absent. Nothing is invented — no fabricated stock, shipping, ratings,
// or delivery times.
//
// HARDENING (Phase 4C pre-live):
//  - ONE internally-consistent selected variant drives price/inventory/
//    weight/freight/landed cost (never variants[0] by accident).
//  - Freight origin comes from variant inventory/warehouse evidence (never a
//    hardcoded start country).
//  - The usable total freight (totalPostageFee) is preferred over the
//    headline logisticPrice; all fee fields are preserved.
//  - Delivery cycles parse exactly ("3-5" → 3..5, "5" → 5..5, junk → UNKNOWN).
// ============================================================================

import type { SupplierProductRecord, SupplierVariantEvidence, SupplierShippingEvidence } from '../types';
import { curateSupplierImageSet } from '../images';

export const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
export const CJ_PRODUCT_PAGE = 'https://www.cjdropshipping.com/product';

/** CJ listV2 product object (subset of the official DTO we consume). */
export interface CjListProduct {
  id?: string;
  nameEn?: string;
  sku?: string;
  spu?: string;
  bigImage?: string;
  sellPrice?: string | number;
  nowPrice?: string | number;
  listedNum?: number;
  categoryId?: string;
  threeCategoryName?: string;
  twoCategoryName?: string;
  oneCategoryName?: string;
  addMarkStatus?: number; // 1 = free shipping
  deliveryCycle?: string;
  warehouseInventoryNum?: number;
  totalVerifiedInventory?: number;
  totalUnVerifiedInventory?: number;
  verifiedWarehouse?: number; // 1 = verified
  supplierName?: string;
  description?: string;
  saleStatus?: string; // "3" = on sale
}

export interface CjVariantInventory {
  countryCode?: string;
  totalInventory?: number;
  verifiedWarehouse?: number;
}

export interface CjVariant {
  vid?: string;
  variantSku?: string;
  variantSellPrice?: string | number;
  variantWeight?: string | number;
  variantLength?: string | number;
  variantWidth?: string | number;
  variantHeight?: string | number;
  inventories?: CjVariantInventory[];
}

/** CJ product/query detail object (subset). */
export interface CjProductDetail extends CjListProduct {
  productImageSet?: string[];
  productWeight?: string | number;
  variants?: CjVariant[];
}

/** CJ logistic/freightCalculate quote (subset — the fields we actually use). */
export interface CjFreightQuote {
  logisticsName?: string;
  logisticName?: string;
  shippingMethod?: string;
  logisticPrice?: string | number;
  totalPostageFee?: string | number;
  taxesFee?: string | number;
  clearanceOperationFee?: string | number;
  tariff?: string | number;
  shippingTime?: string;
  shippingAging?: string;
  arrivalDays?: string;
  startCountry?: string;
  startCountryCode?: string;
  endCountry?: string;
  endCountryCode?: string;
}

function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: string | undefined | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

/** Country-code normalization: "USA"/"us" → "US". */
export function normalizeCountryCode(market?: string): string | null {
  if (!market) return null;
  const c = market.trim().toUpperCase();
  if (c === 'USA' || c === 'UNITED STATES' || c === 'UNITED STATES OF AMERICA') return 'US';
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Stable CJ product page URL from the pid. */
export function cjProductUrl(productId: string): string {
  return `${CJ_PRODUCT_PAGE}/${encodeURIComponent(productId)}.html`;
}

/**
 * Exact delivery-cycle parsing. NEVER improves supplier evidence:
 *   "3-5" → { min: 3, max: 5 }
 *   "5"   → { min: 5, max: 5 }
 *   junk  → null (UNKNOWN)
 */
export function parseDeliveryCycle(raw: string | null | undefined): { min: number; max: number } | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) return { min: a, max: b };
    return null;
  }
  const single = /^(\d{1,3})$/.exec(t);
  if (single) {
    const a = parseInt(single[1], 10);
    if (Number.isFinite(a) && a > 0) return { min: a, max: a };
    return null;
  }
  return null;
}

/**
 * Select the ONE internally-consistent variant for a product detail.
 *
 * Selection priority (deterministic, recorded):
 *   1. verified US inventory (verifiedWarehouse + countryCode US)
 *   2. available US inventory (any US stock)
 *   3. viable supplier cost (positive variant price)
 *   4. any valid variant (has vid)
 *
 * If no variant is internally consistent → null (variant UNKNOWN).
 */
export function selectVariant(d: CjProductDetail, country: string | null): SupplierVariantEvidence | null {
  const variants = Array.isArray(d.variants) ? d.variants : [];
  if (!variants.length) return null;
  const countryUpper = (country || '').toUpperCase();

  const score = (v: CjVariant): number => {
    let s = 0;
    const invs = Array.isArray(v.inventories) ? v.inventories : [];
    const us = invs.find((i) => (i.countryCode || '').toUpperCase() === countryUpper);
    const price = num(v.variantSellPrice);
    if (!v.vid) return -1;
    if (price === null || price <= 0) s -= 10;
    if (us) {
      if (us.verifiedWarehouse === 1) s += 40;
      if ((us.totalInventory ?? 0) > 0) s += 30;
    }
    return s;
  };

  const ranked = variants
    .map((v) => ({ v, s: score(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);

  if (!ranked.length) return null;
  const chosen = ranked[0].v;

  const invs = Array.isArray(chosen.inventories) ? chosen.inventories : [];
  const usInv = invs.find((i) => (i.countryCode || '').toUpperCase() === countryUpper);
  const price = num(chosen.variantSellPrice);

  // Origin: prefer a verified inventory country; fall back to any inventory
  // country with stock; else UNKNOWN. Never fabricate an origin.
  const verifiedInv = invs.find((i) => i.verifiedWarehouse === 1 && (i.totalInventory ?? 0) > 0);
  const stockedInv = invs.find((i) => (i.totalInventory ?? 0) > 0);
  const originCountry = (verifiedInv?.countryCode || stockedInv?.countryCode || null)?.toUpperCase() ?? null;

  return {
    variantId: str(chosen.vid) || '',
    sku: str(chosen.variantSku) || '',
    sellPrice: price,
    weightGrams: num(chosen.variantWeight),
    dimensions: [chosen.variantLength, chosen.variantWidth, chosen.variantHeight]
      .map((d) => (d !== undefined && d !== null && String(d).trim() !== '' ? String(d) : null))
      .filter((d): d is string => d !== null)
      .join('x') || null,
    usInventoryVerified: usInv?.verifiedWarehouse === 1 ? (usInv.totalInventory ?? null) : null,
    usInventoryTotal: usInv ? (usInv.totalInventory ?? null) : null,
    usInventoryInCountry: country ? (usInv?.totalInventory ?? 0) > 0 : false,
    verifiedWarehouse: usInv?.verifiedWarehouse === 1,
    originCountry,
    raw: { ...(chosen as Record<string, unknown>) },
  };
}

/**
 * Normalize a CJ listV2 product into a SupplierProductRecord.
 * `countryCode` (e.g. "US") is the market filter used in the search; when
 * present, CJ already filtered inventory by that country — we still record
 * what we can actually see rather than assume. List-level records carry no
 * selected variant (variant UNKNOWN until product/query enrichment).
 */
export function normalizeCjListProduct(
  p: CjListProduct,
  opts: { market?: string; observedAt?: string } = {}
): SupplierProductRecord | null {
  const productId = str(p.id);
  if (!productId) return null;
  const sku = str(p.sku || p.spu);
  const title = str(p.nameEn);
  if (!title) return null;

  const country = normalizeCountryCode(opts.market);
  const sellPrice = num(p.sellPrice);
  const nowPrice = num(p.nowPrice);
  const bestPrice = nowPrice !== null ? nowPrice : sellPrice;

  const categoryParts = [p.oneCategoryName, p.twoCategoryName, p.threeCategoryName]
    .map((c) => str(c))
    .filter((c): c is string => !!c);
  const category = categoryParts.join(' / ') || null;

  const usVerified = p.totalVerifiedInventory ?? null;
  const usTotal = p.warehouseInventoryNum ?? null;

  return {
    provider: 'cj',
    productId,
    sku: sku ?? '',
    selectedVariant: null,
    title,
    imageUrl: str(p.bigImage),
    images: [str(p.bigImage)].filter((i): i is string => !!i),
    // Truthful image content: the supplier's list-level image (bigImage). No
    // dimensions are invented; variant mapping stays empty at list level.
    imageSet: curateSupplierImageSet({ title, images: [p.bigImage] }),
    sellPrice: bestPrice,
    category,
    weightGrams: null,
    // US inventory evidence — only claimed when CJ actually returned it.
    usInventoryVerified: country === 'US' ? usVerified : null,
    usInventoryTotal: country === 'US' ? usTotal : null,
    usInventoryInCountry: country === 'US' ? (usTotal ?? 0) > 0 : false,
    warehouse: null,
    freeShipping: p.addMarkStatus === 1,
    deliveryCycle: str(p.deliveryCycle),
    listedNum: p.listedNum ?? null,
    supplierName: str(p.supplierName),
    description: null,
    sourceUrl: cjProductUrl(productId),
    observedAt: opts.observedAt ?? new Date().toISOString(),
    raw: { ...(p as Record<string, unknown>), normalizedFrom: 'listV2' },
  };
}

/**
 * Normalize a CJ product/query detail (enriched: images, weight, variants,
 * selected variant). Returns null when the pid/title is missing.
 * The SELECTED variant (not variants[0]) drives price/inventory/weight.
 */
export function normalizeCjProductDetail(
  d: CjProductDetail,
  opts: { market?: string; observedAt?: string } = {}
): SupplierProductRecord | null {
  const base = normalizeCjListProduct(d as CjListProduct, opts);
  if (!base) return null;

  const country = normalizeCountryCode(opts.market);
  const selected = selectVariant(d, country);
  const price = selected?.sellPrice ?? base.sellPrice;

  return {
    ...base,
    title: base.title,
    imageUrl: base.imageUrl,
    images: Array.isArray(d.productImageSet) && d.productImageSet.length
      ? d.productImageSet.filter((i): i is string => !!i)
      : base.images,
    // Detail-level full gallery (productImageSet) is the supplier's own
    // highest-resolution image set — exact-deduped, hero-first, honest alt.
    imageSet: curateSupplierImageSet({
      title: base.title,
      images: Array.isArray(d.productImageSet) ? d.productImageSet : base.images,
    }),
    weightGrams: num(d.productWeight) ?? selected?.weightGrams ?? null,
    selectedVariant: selected,
    sellPrice: price,
    usInventoryVerified: country === 'US'
      ? (selected?.usInventoryVerified ?? base.usInventoryVerified)
      : null,
    usInventoryTotal: country === 'US'
      ? (selected?.usInventoryTotal ?? base.usInventoryTotal)
      : null,
    usInventoryInCountry: country === 'US'
      ? (selected?.usInventoryInCountry ?? base.usInventoryInCountry)
      : false,
    warehouse: selected?.originCountry ? `${selected.originCountry} warehouse (variant evidence)` : null,
    description: str(d.description),
    raw: { ...(d as Record<string, unknown>), normalizedFrom: 'query' },
  };
}

/**
 * Normalize a CJ freight quote into SupplierShippingEvidence.
 *
 * The usable total cost is `totalPostageFee` when CJ returns it; logisticPrice
 * is used ONLY when the total field is genuinely absent, and that limitation
 * is recorded in the note. All fee fields are preserved. Origin comes from
 * the quote/request, never hardcoded.
 */
export function normalizeCjFreight(
  q: CjFreightQuote,
  opts: { origin?: string | null; destination?: string | null; observedAt?: string } = {}
): SupplierShippingEvidence | null {
  const total = num(q.totalPostageFee);
  const base = num(q.logisticPrice);
  const taxes = num(q.taxesFee);
  const clearance = num(q.clearanceOperationFee);
  const tariff = num(q.tariff);

  // Usable total: prefer totalPostageFee; fall back ONLY when truly absent.
  let costUsd = total;
  let note: string;
  if (total !== null) {
    note = 'Total freight = totalPostageFee (includes applicable fees).';
  } else if (base !== null) {
    costUsd = base;
    note = 'LIMITATION: totalPostageFee absent — using logisticPrice only; applicable fees may be missing.';
  } else {
    note = 'No usable freight total returned by CJ — freight UNKNOWN.';
  }

  const arrival = str(q.shippingTime) ?? str(q.shippingAging) ?? str(q.arrivalDays);
  const origin = opts.origin ?? str(q.startCountryCode) ?? str(q.startCountry) ?? null;
  const destination = opts.destination ?? str(q.endCountryCode) ?? str(q.endCountry) ?? null;

  return {
    costUsd,
    baseFreightUsd: base,
    taxesFeeUsd: taxes,
    clearanceFeeUsd: clearance,
    tariffUsd: tariff,
    arrivalDays: arrival,
    carrier: str(q.logisticsName) ?? str(q.logisticName) ?? str(q.shippingMethod),
    origin,
    destination,
    observedAt: opts.observedAt ?? new Date().toISOString(),
    verified: costUsd !== null,
    note,
  };
}
