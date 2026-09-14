// Regenerate public/sitemap.xml from the LIVE database — the same URL set the
// worker's dynamic sitemap serves (worker/sitemap.ts). This static file is the
// FALLBACK when the DB is unreachable at request time, so it must never carry
// stale/archived/deleted URLs: GSC keeps re-crawling what it last saw here.
//
// Included (mirrors buildSitemap exactly):
//   * static routes
//   * active storefront categories (is_active)
//   * published CMS blog posts (status=published — the RLS-visible set)
//   * commerce-ready active products, minus editorial holds
import fs from 'fs';
import { isHeldBlog, isHeldProduct } from '../src/content/reviewHolds.ts';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Mirror of the storefront commerce-ready gate (services/catalog.ts). */
function commerceReady(p) {
  if (typeof p.commerce_readiness === 'string' && p.commerce_readiness) {
    return p.commerce_readiness === 'COMMERCE_READY';
  }
  const src = String(p.supplier_source || '').toLowerCase();
  const isUnverified = !src || /kong|official manufacturer|manufacturer page/i.test(src);
  if (isUnverified) return false;
  const hasCost = num(p.cost_price) > 0;
  const hasFulfillment = p.us_inventory === true || (p.stock_status === 'in_stock' && num(p.inventory_qty) > 0);
  return hasCost && hasFulfillment;
}

const get = async (path) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const [prods, cats, blogs] = await Promise.all([
  get('products?select=id,slug,status,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness&status=in.(active,published)&limit=500'),
  get('categories?select=slug&is_active=eq.true&limit=200'),
  get('blog_posts?select=slug&status=eq.published&limit=500'),
]);

const urls = ['/', '/shop', '/blog', '/about', '/contact', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
for (const c of cats) urls.push(`/category/${c.slug}`);
for (const b of blogs) if (!isHeldBlog(b.slug)) urls.push(`/blog/${b.slug}`);
for (const p of prods) {
  if (!isHeldProduct(p.slug) && (p.status === 'active' || p.status === 'published') && commerceReady(p)) {
    urls.push(`/product/${p.slug || p.id}`);
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://luxedge.us${u}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap: ${urls.length} URLs (${blogs.length} published blogs, ${cats.length} categories, ${prods.filter(p => commerceReady(p) && !isHeldProduct(p.slug)).length} commerce-ready products)`);
