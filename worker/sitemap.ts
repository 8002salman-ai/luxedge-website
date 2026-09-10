import { SITEMAP_PRODUCTS_SELECT, SITEMAP_CATEGORIES_SELECT, SITEMAP_BLOG_POSTS_SELECT } from './selects';
import { isHeldBlog, isHeldProduct } from '../src/content/reviewHolds';
import { isPubliclyListableProduct } from '../src/content/productEligibility';

// Dynamic sitemap source. Media routes are noindexed and deliberately excluded.
const root = 'https://luxedge.us';
const STATIC_ROUTES = ['/', '/shop', '/blog', '/about', '/contact', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
function supabaseBase(): string { return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''); }
function supabaseAnon(): string { return (process.env.VITE_SUPABASE_ANON_KEY || '').trim(); }
async function fetchRows<T>(path: string): Promise<T | null> {
  const base = supabaseBase(); const key = supabaseAnon();
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch { return null; }
}
interface ProductRow { id: string; slug?: string | null; name?: string | null; status?: string | null; description?: string | null; short_description?: string | null; price?: number | null; image_url?: string | null; supplier_source?: string | null; cost_price?: number | null; us_inventory?: boolean | null; stock_status?: string | null; inventory_qty?: number | null; commerce_readiness?: string | null; }
interface CategoryRow { slug: string; }
interface BlogRow { slug: string; }
const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Returns null on DB failure so the caller can respond with an honest 503. */
export async function buildSitemap(): Promise<string | null> {
  const [prods, cats, blogs] = await Promise.all([
    fetchRows<ProductRow[]>(`products?select=${SITEMAP_PRODUCTS_SELECT}&status=in.(active,published)&limit=500`),
    fetchRows<CategoryRow[]>(`categories?select=${SITEMAP_CATEGORIES_SELECT}&is_active=eq.true&limit=200`),
    fetchRows<BlogRow[]>(`blog_posts?select=${SITEMAP_BLOG_POSTS_SELECT}&status=eq.published&limit=500`),
  ]);
  if (!prods || !cats || !blogs) return null;
  const urls: string[] = [...STATIC_ROUTES];
  for (const c of cats) urls.push(`/category/${xmlEscape(c.slug)}`);
  for (const b of blogs) if (!isHeldBlog(b.slug)) urls.push(`/blog/${xmlEscape(b.slug)}`);
  for (const p of prods) {
    if (!isHeldProduct(p.slug) && isPubliclyListableProduct(p)) urls.push(`/product/${xmlEscape(p.slug || p.id)}`);
  }
  const body = urls.map((u) => `  <url><loc>${root}${u}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
