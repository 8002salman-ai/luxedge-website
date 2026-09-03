import { SITEMAP_PRODUCTS_SELECT, SITEMAP_CATEGORIES_SELECT, SITEMAP_BLOG_POSTS_SELECT, SITEMAP_MEDIA_SELECT } from './selects';

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
  '/', '/shop', '/media', '/blog', '/about', '/contact',
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
  const [prods, cats, blogs, media] = await Promise.all([
    fetchRows<ProductRow[]>(
      `products?select=${SITEMAP_PRODUCTS_SELECT}&status=in.(active,published)&limit=500`,
    ),
    fetchRows<CategoryRow[]>(`categories?select=${SITEMAP_CATEGORIES_SELECT}&is_active=eq.true&limit=200`),
    fetchRows<BlogRow[]>(`blog_posts?select=${SITEMAP_BLOG_POSTS_SELECT}&status=eq.published&limit=500`),
    fetchRows<BlogRow[]>(`media_videos?select=${SITEMAP_MEDIA_SELECT}&status=eq.published&limit=500`),
  ]);

  // DB is not reachable / not provisioned — fall back to the static sitemap.
  if (!prods || !cats || !blogs || !media) return null;

  const urls: string[] = [...STATIC_ROUTES];
  for (const c of cats) urls.push(`/category/${xmlEscape(c.slug)}`);
  for (const b of blogs) urls.push(`/blog/${xmlEscape(b.slug)}`);
  for (const m of media) urls.push(`/media/${xmlEscape(m.slug)}`);
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

// ---------------------------------------------------------------------------
// /video-sitemap.xml — Google Video sitemap (real data only; never fabricated)
// ---------------------------------------------------------------------------

interface MediaRow {
  slug: string;
  title: string;
  youtube_video_id?: string | null;
  thumbnail_url?: string | null;
  custom_thumbnail_url?: string | null;
  published_at?: string | null;
  duration?: string | null;
}

/** ISO-8601 duration (PT1H2M3S) → seconds, as Google's video sitemap requires. */
function isoDurationToSeconds(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return '';
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? String(total) : '';
}

/**
 * Google's video sitemap extension for the /media library. Only published
 * videos WITH a real YouTube id and thumbnail are listed — a row missing its
 * thumbnail is omitted rather than emitting a broken entry. Returns null when
 * the DB is unavailable so the caller can 404/fallback honestly.
 */
export async function buildVideoSitemap(): Promise<string | null> {
  const rows = await fetchRows<MediaRow[]>(
    `media_videos?select=${SITEMAP_MEDIA_SELECT},title,youtube_video_id,thumbnail_url,custom_thumbnail_url,published_at,duration&status=eq.published&limit=500`,
  );
  if (!rows) return null;

  const entries = rows
    .filter((m) => m && m.youtube_video_id && (m.custom_thumbnail_url || m.thumbnail_url))
    .map((m) => {
      const thumb = xmlEscape(m.custom_thumbnail_url || m.thumbnail_url || '');
      const title = xmlEscape(m.title || m.slug);
      const pub = m.published_at ? xmlEscape(m.published_at) : '';
      const dur = isoDurationToSeconds(m.duration);
      return (
        `  <url>` +
        `<loc>${root}/media/${xmlEscape(m.slug)}</loc>` +
        (pub ? `<video:publication_date>${pub}</video:publication_date>` : '') +
        `<video:title>${title}</video:title>` +
        `<video:thumbnail_loc>${thumb}</video:thumbnail_loc>` +
        `<video:content_loc>https://www.youtube.com/watch?v=${xmlEscape(m.youtube_video_id || '')}</video:content_loc>` +
        `<video:player_loc allow_embed="yes">https://www.youtube.com/embed/${xmlEscape(m.youtube_video_id || '')}?rel=0</video:player_loc>` +
        (dur ? `<video:duration>${dur}</video:duration>` : '') +
        `</url>`
      );
    })
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${entries}\n</urlset>\n`
  );
}