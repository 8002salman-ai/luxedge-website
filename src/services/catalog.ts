// ============================================================================
// LUXEDGE V2 — STOREFRONT CATALOG SERVICE (Phase 3B)
//
// Loads the storefront catalog from Supabase when it is configured AND
// reachable AND populated. Returns null when any of those conditions fail so
// the caller can keep its demo/fallback data — the storefront never renders
// empty just because the database is not provisioned yet.
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
  isActive: boolean;
  brand: string;
  tags: string[];
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
 * Returns null when: not configured, unreachable, schema not provisioned,
 * or no published products exist yet — the caller keeps its demo catalog.
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
      .filter((p) => p && typeof p.id === 'string' && p.status === 'published');

    // Products without any price info are not ready for the storefront.
    const usable = published.filter((p) => num(p.price) > 0 || num(p.price_amount) > 0);
    if (usable.length === 0) return null;

    // Optional: attach product images. Tolerate failures (missing table,
    // grants, RLS) without failing the whole catalog load.
    let imagesByProduct = new Map<string, string[]>();
    try {
      const imgRows = await db.list<DbImageRow>('product_images', { limit: 500 });
      if (Array.isArray(imgRows)) {
        imagesByProduct = (imgRows as DbImageRow[]).reduce((acc, img) => {
          const url = img.url || img.public_url;
          if (!img || !img.product_id || !url) return acc;
          const list = acc.get(img.product_id) || [];
          list.push(String(url));
          acc.set(img.product_id, list);
          return acc;
        }, new Map<string, string[]>());
      }
    } catch {
      /* product images unavailable — products still render with image_url */
    }

    const catName = (id?: string | null): string => {
      if (!id) return '';
      return categories.find((c) => c.id === id)?.name || '';
    };

    const products: CatalogProduct[] = usable.map((p) => {
      const rawPrice = num(p.price) > 0 ? num(p.price) : centsToDollars(p.price_amount);
      const rawCompare = num(p.compare_at_price) > 0 ? num(p.compare_at_price) : centsToDollars(p.compare_at_amount);
      const images = imagesByProduct.get(p.id) || (p.image_url ? [String(p.image_url)] : []);
      return {
        id: p.id,
        name: String(p.name || p.title || p.id),
        slug: p.slug || undefined,
        shortDesc: p.short_description || '',
        description: p.description || '',
        price: rawPrice,
        originalPrice: rawCompare > rawPrice ? rawCompare : 0,
        category: catName(p.category_id),
        categoryId: p.category_id || undefined,
        stock: Math.max(0, num(p.inventory_qty)),
        images,
        isActive: true,
        brand: p.brand || 'Luxedge',
        tags: tagsOf(p.tags),
      };
    });

    return { products, categories, source: 'supabase' };
  } catch {
    // Unreachable / schema not provisioned / permission denied → demo fallback.
    return null;
  }
}
