// ============================================================================
// LUXEDGE V2 — STOREFRONT CATALOG SERVICE (Phase 3B)
//
// Loads the storefront catalog from Supabase when it is configured AND
// reachable. Returns an EMPTY REAL CATALOG ({ products: [], categories, … })
// when the database is reachable but has zero published products — a valid
// empty DB result is NOT an error and must never trigger demo/fallback data.
// Returns null ONLY for genuine failures (not configured, unreachable, schema
// not provisioned) — and even then the caller must NOT fall back to demo
// products (Phase 4E.1/4E.2: the storefront starts empty and stays empty
// until genuinely approved products exist).
//
// DATA SOURCES (supabase/migrations/0004_reconcile_live.sql)
//   categories     — active storefront categories
//   products       — published products (status = 'published')
//   product_images — product image urls (optional; tolerated on failure)
//
// PERMANENT STOREFRONT RULE (Phase 4E.1 §10): a product must NOT become
// customer-visible merely because it exists in `products` or is
// PRODUCT_SHORTLISTED. Only `status = 'published'` rows ever render here, and
// the future publish path additionally requires BUSINESS_QUALIFIED + QA PASS +
// OWNER APPROVAL + listing factual QA PASS + creative/image quality gate PASS
// + explicit publish authorization. AUTO PUBLISH = OFF for now — the engine
// only ever creates drafts.
//
// SECURITY
//   Uses the public anon key only (via the db adapter). The service-role key
//   never reaches this module or the browser bundle. RLS further restricts
//   reads to published products for the anon role.
// ============================================================================

import { getDb, getDbMode } from './db';
import { deriveCommerceReadiness, deriveInventorySource, deriveSourceType, type CommerceReadiness } from '../features/catalog/commerceReadiness';

export interface CatalogProduct {
  id: string;
  name: string;
  slug?: string;
  shortDesc: string;
  description: string;
  price: number;
  originalPrice: number;
  category: string;
  categoryId?: string;
  stock: number;
  images: string[];
  imageAlts: string[];
  isActive: boolean;
  brand: string;
  tags: string[];
  featured: boolean;
  newArrival: boolean;
  saleEnabled: boolean;
  discountType?: string;
  discountValue?: number;
  freeShipping: boolean;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  stockStatus: string;
  usInventory: boolean;
  /** Commerce-readiness (migration 0016 or derived from persisted evidence). */
  commerceReadiness: CommerceReadiness;
  sourceType?: string;
  inventorySource?: string;
  variants: CatalogVariant[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords: string[];
  sku?: string;
  supplierSource?: string;
}

export interface CatalogVariant {
  id: string;
  attributes: Record<string, string>;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  inventoryQty: number;
  image?: string | null;
}

export interface StoreCoupon {
  id: string;
  code: string;
  description?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minCartValue: number;
  eligibleProductIds: string[];
  eligibleCategoryIds: string[];
  endAt?: string | null;
  usageLimit: number | null;
  usedCount: number;
}

export interface StorePromotions {
  coupons: StoreCoupon[];
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
  slug?: string;
  isActive: boolean;
}

export interface StorefrontCatalog {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  source: 'supabase';
}

interface DbProductRow {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  short_description?: string | null;
  description?: string | null;
  price?: number | null;
  price_amount?: number | null;
  compare_at_price?: number | null;
  compare_at_amount?: number | null;
  category_id?: string | null;
  inventory_qty?: number | null;
  image_url?: string | null;
  status?: string | null;
  brand?: string | null;
  tags?: unknown;
  // Catalog Launch Phase columns (0010_catalog_management.sql)
  featured?: boolean | null;
  new_arrival?: boolean | null;
  free_shipping?: boolean | null;
  us_inventory?: boolean | null;
  sale_enabled?: boolean | null;
  discount_type?: string | null;
  discount_value?: number | null;
  stock_status?: string | null;
  delivery_min_days?: number | null;
  delivery_max_days?: number | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: unknown;
  supplier_source?: string | null;
  supplier_product_ref?: string | null;
  cost_price?: number | null;
  landed_cost?: number | null;
  shipping_cost?: number | null;
  // Migration 0016 — commerce readiness (may be absent pre-migration)
  commerce_readiness?: string | null;
  source_type?: string | null;
  inventory_source?: string | null;
  [k: string]: unknown;
}

interface DbCategoryRow {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean | null;
  [k: string]: unknown;
}

interface DbImageRow {
  product_id: string;
  url?: string | null;
  public_url?: string | null;
  alt_text?: string | null;
  is_primary?: boolean | null;
  sort_order?: number | null;
  variant_id?: string | null;
  [k: string]: unknown;
}

interface DbVariantRow {
  id: string;
  product_id: string;
  attributes?: unknown;
  sku?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  inventory_qty?: number | null;
  [k: string]: unknown;
}

interface DbCouponRow {
  id: string;
  code: string;
  description?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  min_cart_value?: number | null;
  eligible_product_ids?: unknown;
  eligible_category_ids?: unknown;
  end_at?: string | null;
  usage_limit?: number | null;
  used_count?: number | null;
  [k: string]: unknown;
}

interface DbSettingRow {
  key: string;
  value?: unknown;
  [k: string]: unknown;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a legacy cents-amount column to dollars (legacy schema used integer cents). */
function centsToDollars(cents: unknown): number {
  return Math.round(num(cents)) / 100;
}

/** Extract string tags from a jsonb column when present (V2 schema). */
function tagsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Load the storefront catalog from Supabase.
 * Returns an EMPTY REAL CATALOG when the DB is reachable but has zero
 * published products (intentional empty catalog — never demo fallback).
 * Returns null only when: not configured, unreachable, schema not
 * provisioned, or the DB query itself failed.
 */
export async function loadStorefrontCatalog(): Promise<StorefrontCatalog | null> {
  if (getDbMode() !== 'supabase') return null;
  const db = getDb();

  try {
    const [catRows, prodRows] = await Promise.all([
      db.list<DbCategoryRow>('categories', { orderBy: 'sort_order' }),
      db.list<DbProductRow>('products', { orderBy: 'created_at' }),
    ]);

    if (!Array.isArray(catRows) || !Array.isArray(prodRows)) return null;

    const categories: CatalogCategory[] = (catRows as DbCategoryRow[])
      .filter((c) => c && typeof c.id === 'string')
      .map((c) => ({
        id: c.id,
        name: String(c.name || c.id),
        slug: c.slug || undefined,
        isActive: c.is_active !== false,
      }));

    const published = (prodRows as DbProductRow[])
      // Storefront visibility = status active/published AND commerce-ready.
      // The readiness gate is resilient: it uses the stored 0016 column when
      // present and derives from persisted evidence (real supplier + cost
      // basis) otherwise, so RETAIL_REFERENCE_ONLY products (e.g. manufacturer
      // MSRP without a verified purchasing path) can never become visible.
      .filter((p) => p && typeof p.id === 'string' && (p.status === 'published' || p.status === 'active') && isStorefrontReady(p));

    // Products without any price info are not ready for the storefront.
    const usable = published.filter((p) => num(p.price) > 0 || num(p.price_amount) > 0);
    // Phase 4E.2 — a reachable DB with ZERO published products is a valid
    // EMPTY REAL CATALOG, not an error. Never signal "use demo fallback".
    if (usable.length === 0) {
      return { products: [], categories, source: 'supabase' };
    }

    // Optional: attach product images (with alt/primary/sort + variant links).
    // Tolerate failures (missing table, grants, RLS) without failing the load.
    let imagesByProduct = new Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>();
    try {
      const imgRows = await db.list<DbImageRow>('product_images', { limit: 1000 });
      if (Array.isArray(imgRows)) {
        imagesByProduct = (imgRows as DbImageRow[]).reduce((acc, img) => {
          const url = img.url || img.public_url;
          if (!img || !img.product_id || !url) return acc;
          const list = acc.get(img.product_id) || [];
          list.push({
            url: String(url),
            alt: img.alt_text || '',
            isPrimary: !!img.is_primary,
            variantId: img.variant_id || null,
          });
          acc.set(img.product_id, list);
          return acc;
        }, new Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>());
      }
    } catch {
      /* product images unavailable — products still render with image_url */
    }

    // Optional: attach product variants (real options only — never invented).
    let variantsByProduct = new Map<string, DbVariantRow[]>();
    try {
      const varRows = await db.list<DbVariantRow>('product_variants', { limit: 1000 });
      if (Array.isArray(varRows)) {
        variantsByProduct = (varRows as DbVariantRow[]).reduce((acc, v) => {
          if (!v || !v.product_id) return acc;
          const list = acc.get(v.product_id) || [];
          list.push(v);
          acc.set(v.product_id, list);
          return acc;
        }, new Map<string, DbVariantRow[]>());
      }
    } catch {
      /* product variants unavailable */
    }

    const catName = (id?: string | null): string => {
      if (!id) return '';
      return categories.find((c) => c.id === id)?.name || '';
    };

    const rawTagList = (p: DbProductRow): string[] => tagsOf(p.tags);
    const products: CatalogProduct[] = usable.map((p) => {
      const rawPrice = num(p.price) > 0 ? num(p.price) : centsToDollars(p.price_amount);
      const rawCompare = num(p.compare_at_price) > 0 ? num(p.compare_at_price) : centsToDollars(p.compare_at_amount);
      const imgs = imagesByProduct.get(p.id) || (p.image_url ? [{ url: String(p.image_url), alt: '', isPrimary: true }] : []);
      const images = imgs.map((i) => i.url);
      const imageAlts = imgs.map((i) => i.alt);
      const variants: CatalogVariant[] = (variantsByProduct.get(p.id) || []).map((v) => {
        const attrs = v.attributes && typeof v.attributes === 'object' && !Array.isArray(v.attributes)
          ? (Object.fromEntries(Object.entries(v.attributes as Record<string, unknown>).filter(([, val]) => typeof val === 'string')) as Record<string, string>)
          : {};
        const linked = imgs.find((i) => i.variantId === v.id);
        return {
          id: v.id,
          attributes: attrs,
          sku: v.sku || '',
          price: v.price != null ? num(v.price) : null,
          compareAtPrice: v.compare_at_price != null ? num(v.compare_at_price) : null,
          inventoryQty: num(v.inventory_qty),
          image: linked?.url || null,
        };
      });
      const saleEnabled = p.sale_enabled === true && num(p.discount_value) > 0;
      const salePrice = saleEnabled
        ? (p.discount_type === 'fixed'
            ? Math.max(0, rawPrice - num(p.discount_value))
            : Math.round(rawPrice * (1 - num(p.discount_value) / 100) * 100) / 100)
        : rawPrice;
      return {
        id: p.id,
        name: String(p.name || p.title || p.id),
        slug: p.slug || undefined,
        shortDesc: p.short_description || '',
        description: p.description || '',
        price: salePrice,
        originalPrice: rawCompare > salePrice ? rawCompare : 0,
        category: catName(p.category_id),
        categoryId: p.category_id || undefined,
        stock: Math.max(0, num(p.inventory_qty)),
        images,
        imageAlts,
        isActive: true,
        brand: p.brand || 'Luxedge',
        tags: rawTagList(p),
        featured: p.featured === true,
        newArrival: p.new_arrival === true,
        saleEnabled,
        discountType: typeof p.discount_type === 'string' ? p.discount_type : undefined,
        discountValue: num(p.discount_value) || undefined,
        freeShipping: p.free_shipping === true,
        deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
        deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
        stockStatus: typeof p.stock_status === 'string' ? p.stock_status : (num(p.inventory_qty) > 0 ? 'in_stock' : 'out_of_stock'),
        usInventory: p.us_inventory === true,
        commerceReadiness: (typeof p.commerce_readiness === 'string' && p.commerce_readiness)
          ? (p.commerce_readiness as CommerceReadiness)
          : deriveCommerceReadiness({
              status: p.status || 'active',
              supplierSource: p.supplier_source,
              supplierProductRef: p.supplier_product_ref,
              costPrice: num(p.cost_price),
              landedCost: num(p.landed_cost),
              shippingCost: num(p.shipping_cost),
              freeShipping: p.free_shipping === true,
              deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
              deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
              usInventory: p.us_inventory === true,
              stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null,
              inventoryQty: num(p.inventory_qty),
            }),
        sourceType: (typeof p.source_type === 'string' && p.source_type as string) || deriveSourceType({ supplierSource: p.supplier_source, supplierProductRef: p.supplier_product_ref }),
        inventorySource: (typeof p.inventory_source === 'string' && p.inventory_source as string) || deriveInventorySource({ usInventory: p.us_inventory === true, stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null }),
        variants,
        seoTitle: p.seo_title || undefined,
        seoDescription: p.seo_description || undefined,
        seoKeywords: tagsOf(p.seo_keywords),
        sku: typeof p.sku === 'string' ? p.sku : undefined,
        supplierSource: typeof p.supplier_source === 'string' ? p.supplier_source : undefined,
      };
    });

    return { products, categories, source: 'supabase' };
  } catch {
    // Unreachable / schema not provisioned / permission denied → null.
    // The caller must NOT fall back to demo products — the storefront stays
    // empty (Phase 4E.1/4E.2).
    return null;
  }
}

/**
 * Commerce-readiness gate for storefront visibility.
 *
 * Resilient to the 0016 migration state:
 *   - When `commerce_readiness` exists and is non-null, it is authoritative.
 *   - Otherwise derive from persisted evidence: a real supplier source PLUS a
 *     real cost basis is required. Manufacturer retail-reference products
 *     (e.g. KONG official pages — authenticity proven, purchasing path NOT
 *     proven) have no cost basis and therefore never qualify.
 */
function isStorefrontReady(p: DbProductRow): boolean {
  const stored = p.commerce_readiness as string | null | undefined;
  if (typeof stored === 'string' && stored) {
    return stored === 'COMMERCE_READY';
  }
  const readiness = deriveCommerceReadiness({
    status: p.status || 'active',
    supplierSource: p.supplier_source,
    supplierProductRef: p.supplier_product_ref,
    costPrice: num(p.cost_price),
    landedCost: num(p.landed_cost),
    shippingCost: num(p.shipping_cost),
    freeShipping: p.free_shipping === true,
    deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
    deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
    usInventory: p.us_inventory === true,
    stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null,
    inventoryQty: num(p.inventory_qty),
  });
  return readiness === 'COMMERCE_READY';
}

/**
 * Load storefront promotions: ACTIVE coupons + free-shipping strategy.
 * Failures degrade to a safe default (no coupons, free shipping OFF) — the
 * storefront never shows coupons/shipping claims it cannot back.
 */
export async function loadStorefrontPromotions(): Promise<StorePromotions> {
  if (getDbMode() !== 'supabase') return { coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50 };
  const db = getDb();
  const out: StorePromotions = { coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50 };
  try {
    const [couponRows, settingRows] = await Promise.all([
      db.list<DbCouponRow>('coupons', { limit: 200 }),
      db.list<DbSettingRow>('store_settings', { limit: 20 }).catch(() => [] as DbSettingRow[]),
    ]);
    if (Array.isArray(couponRows)) {
      out.coupons = (couponRows as DbCouponRow[])
        .filter((c) => c && typeof c.code === 'string')
        .map((c) => ({
          id: c.id,
          code: String(c.code).toUpperCase(),
          description: c.description || undefined,
          discountType: c.discount_type === 'fixed' ? 'fixed' as const : 'percent' as const,
          discountValue: num(c.discount_value),
          minCartValue: num(c.min_cart_value),
          eligibleProductIds: Array.isArray(c.eligible_product_ids) ? (c.eligible_product_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          eligibleCategoryIds: Array.isArray(c.eligible_category_ids) ? (c.eligible_category_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          endAt: c.end_at || null,
          usageLimit: c.usage_limit != null ? num(c.usage_limit) : null,
          usedCount: num(c.used_count),
        }));
    }
    const freeShippingRow = Array.isArray(settingRows) ? (settingRows as DbSettingRow[]).find((r) => r && r.key === 'free_shipping') : undefined;
    if (freeShippingRow && freeShippingRow.value && typeof freeShippingRow.value === 'object') {
      const v = freeShippingRow.value as { freeShippingEnabled?: unknown; freeShippingThreshold?: unknown };
      out.freeShippingEnabled = v.freeShippingEnabled === true;
      out.freeShippingThreshold = num(v.freeShippingThreshold) > 0 ? num(v.freeShippingThreshold) : 50;
    }
  } catch {
    /* promotions unavailable — safe defaults */
  }
  return out;
}
