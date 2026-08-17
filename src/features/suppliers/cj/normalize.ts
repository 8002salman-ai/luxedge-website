// ============================================================================
// LUXEDGE V2 — CJ DROPSHIPPING NORMALIZATION (Phase 4C)
//
// Converts CJ API V2 responses (product/listV2, product/query) into the
// provider-neutral SupplierProductRecord. Every field keeps an honest
// status: VERIFIED when CJ returned it, UNKNOWN when absent. Nothing is
// invented — no fabricated stock, shipping, ratings, or delivery times.
// ============================================================================

import type { SupplierProductRecord } from '../types';

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
  inventories?: CjVariantInventory[];
}

/** CJ product/query detail object (subset). */
export interface CjProductDetail extends CjListProduct {
  productImageSet?: string[];
  productWeight?: string | number;
  variants?: CjVariant[];
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
 * Normalize a CJ listV2 product into a SupplierProductRecord.
 * `countryCode` (e.g. "US") is the market filter used in the search; when
 * present, CJ already filtered inventory by that country — we still record
 * what we can actually see rather than assume.
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
    variantId: null,
    title,
    imageUrl: str(p.bigImage),
    images: [str(p.bigImage)].filter((i): i is string => !!i),
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
 * Normalize a CJ product/query detail (enriched: images, weight, variants).
 * Returns null when the pid/title is missing (unverifiable record).
 */
export function normalizeCjProductDetail(
  d: CjProductDetail,
  opts: { market?: string; observedAt?: string } = {}
): SupplierProductRecord | null {
  const base = normalizeCjListProduct(d as CjListProduct, opts);
  if (!base) return null;

  const country = normalizeCountryCode(opts.market);
  const variants = Array.isArray(d.variants) ? d.variants : [];
  const usVariant = variants.find((v) =>
    Array.isArray(v.inventories) && v.inventories.some((i) => (i.countryCode || '').toUpperCase() === 'US')
  );

  let usVerified = base.usInventoryVerified;
  let usTotal = base.usInventoryTotal;
  let inCountry = base.usInventoryInCountry;
  if (country === 'US' && usVariant && Array.isArray(usVariant.inventories)) {
    const inv = usVariant.inventories.find((i) => (i.countryCode || '').toUpperCase() === 'US');
    if (inv) {
      usTotal = inv.totalInventory ?? usTotal;
      usVerified = inv.verifiedWarehouse === 1 ? usTotal : usVerified;
      inCountry = (inv.totalInventory ?? 0) > 0;
    }
  }

  return {
    ...base,
    title: base.title,
    imageUrl: base.imageUrl,
    images: Array.isArray(d.productImageSet) && d.productImageSet.length
      ? d.productImageSet.filter((i): i is string => !!i)
      : base.images,
    weightGrams: num(d.productWeight),
    variantId: variants[0]?.vid ? str(variants[0].vid) : null,
    usInventoryVerified: country === 'US' ? usVerified : null,
    usInventoryTotal: country === 'US' ? usTotal : null,
    usInventoryInCountry: country === 'US' ? inCountry : false,
    description: str(d.description),
    raw: { ...(d as Record<string, unknown>), normalizedFrom: 'query' },
  };
}
