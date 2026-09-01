import { SITEMAP_PRODUCTS_SELECT, SITEMAP_CATEGORIES_SELECT, SITEMAP_BLOG_POSTS_SELECT } from './selects';

// ============================================================================
// LUXEDGE — dynamic /sitemap.xml (worker side)
//
// The static sitemap in public/ can no longer be the blog source of truth now
// that posts live in the Supabase CMS. This module generates /sitemap.xml at
// request time from the LIVE database so a new published blog (or a newly
// archived/unpublished one) appears / is removed from the sitemap WITHOUT any
// repository change or deployment. It includes:
//   * static routes
//   * active storefront categories
//   * commerce-ready active products (mirrors the storefront visibility gate)
//   * published CMS blog posts (same RLS-published set the storefront shows)
//
// On ANY database failure (unreachable / not migrated) it returns null so the
// caller can fall back to the static public/sitemap.xml — migration-safe.
// Values are read from process.env exactly like worker/seo-meta.ts; no secrets.
// ============================================================================

const root = 'https://luxedge.us';

const STATIC_ROUTES = [
  '/', '/shop', '/blog', '/about', '/contact',
  '/privacy', '/terms', '/returns', '/shipping-policy', '/faq',
];

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function supabaseAnon(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
}

async function fetchRows<T>(path: string): Promise<T | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

interface ProductRow {
  id: string;
  slug?: string | null;
  status?: string | null;
  supplier_source?: string | null;
  supplier_product_ref?: string | null;
  cost_price?: number | null;
  us_inventory?: boolean | null;
  stock_status?: string | null;
  inventory_qty?: number | null;
  commerce_readiness?: string | null;
}

interface CategoryRow {
  slug: string;
}

interface BlogRow {
  slug: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Mirror of the storefront commerce-ready gate (services/catalog.ts + regen script). */
function commerceReady(p: ProductRow): boolean {
  if (typeof p.commerce_readiness === 'string' && p.commerce_readiness) {
    return p.commerce_readiness === 'COMMERCE_READY';
  }
  const src = String(p.supplier_source || '').toLowerCase();
  if (!src || /kong|official manufacturer|manufacturer page/i.test(src)) return false;
  const hasCost = num(p.cost_price) > 0;
  const hasFulfillment = p.us_inventory === true || (p.stock_status === 'in_stock' && num(p.inventory_qty) > 0);
  return hasCost && hasFulfillment;
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * Build the sitemap XML string. Returns null if the database is unavailable so
 * the caller can serve the static fallback.
 */
export async function buildSitemap(): Promise<string | null> {
  const [prods, cats, blogs] = await Promise.all([
    fetchRows<ProductRow[]>(
      `products?select=${SITEMAP_PRODUCTS_SELECT}&status=in.(active,published)&limit=500`,
    ),
    fetchRows<CategoryRow[]>(`categories?select=${SITEMAP_CATEGORIES_SELECT}&is_active=eq.true&limit=200`),
    fetchRows<BlogRow[]>(`blog_posts?select=${SITEMAP_BLOG_POSTS_SELECT}&status=eq.published&limit=500`),
  ]);

  // DB is not reachable / not provisioned — fall back to the static sitemap.
  if (!prods || !cats || !blogs) return null;

  const urls: string[] = [...STATIC_ROUTES];
  for (const c of cats) urls.push(`/category/${xmlEscape(c.slug)}`);
  for (const b of blogs) urls.push(`/blog/${xmlEscape(b.slug)}`);
  for (const p of prods) {
    if ((p.status === 'active' || p.status === 'published') && commerceReady(p)) {
      urls.push(`/product/${xmlEscape(p.slug || p.id)}`);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const body = urls
    .map((u) => `  <url><loc>${root}${u}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
}