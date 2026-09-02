// ============================================================================
// LUXEDGE — WORKER PUBLIC-READ SELECTS (Supabase anon REST)
//
// Single source for every explicit `select` string the Cloudflare worker uses
// against Supabase. Consumed by:
//   * worker/seo-meta.ts — product/category/blog SSR meta + pre-rendered bodies
//   * worker/sitemap.ts   — the dynamic /sitemap.xml feed
//
// PostgREST rejects the WHOLE query with a 400 when any named column does not
// exist on the live table — a silent 400 here would kill prerendered product
// pages or empty the sitemap (the AdSense-relevant SEO surface) with no error
// surfacing anywhere. Column existence is enforced by
// src/services/__tests__/select-schema.test.ts against supabase/migrations/*.sql
// plus the documented live-verified out-of-band column set in that file.
// ============================================================================

/** Product SSR query (seo-meta.ts) — page facts + embedded category name for
 * the "More in {category}" contextual link. */
export const SEO_PRODUCTS_SELECT =
  'id,slug,name,description,short_description,seo_title,seo_description,seo_keywords,price,compare_at_price,brand,image_url,stock_status,us_inventory,free_shipping,shipping_cost,delivery_min_days,delivery_max_days,product_images(url,public_url,is_primary,sort_order),categories(name)';

export const SEO_CATEGORIES_SELECT = 'slug,name';

export const SEO_BLOG_POSTS_SELECT =
  'slug,title,excerpt,hero_image_url,published_at,created_at,author_name,content,faq';

/** Sitemap product query (sitemap.ts) — the commerce-ready visibility gate
 * mirror (status + supplier/cost/fulfillment evidence). */
export const SITEMAP_PRODUCTS_SELECT =
  'id,slug,status,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness';

export const SITEMAP_CATEGORIES_SELECT = 'slug';

export const SITEMAP_BLOG_POSTS_SELECT = 'slug';