// Regenerate public/sitemap.xml from the live catalog — ACTIVE + COMMERCE_READY
// products only (never DRAFT/INACTIVE/SOURCE_PENDING URLs). Mirrors the
// storefront visibility gate (src/services/catalog.ts isStorefrontReady).
// Static pages + categories + commerce-ready products.
import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('env missing'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Schema-aware: probe whether the 0016 commerce_readiness column exists.
let hasReadiness = false;
try {
  const openApi = await (await fetch(`${URL}/rest/v1/`, { headers: { ...HEAD, Accept: 'application/openapi+json' } })).json();
  const props = (openApi?.components?.schemas?.products || {}).properties || {};
  hasReadiness = !!props.commerce_readiness;
} catch { /* probe failure → derived fallback */ }

const sel = hasReadiness
  ? 'id,status,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness'
  : 'id,status,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty';
const prods = await (await fetch(
  `${URL}/rest/v1/products?select=${sel}&status=in.(active,published)&limit=500`,
  { headers: HEAD },
)).json();
const cats = await (await fetch(`${URL}/rest/v1/categories?select=slug&is_active=eq.true&limit=50`, { headers: HEAD })).json();

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Mirror of the storefront commerce-ready gate (services/catalog.ts). */
function commerceReady(p) {
  if (hasReadiness && typeof p.commerce_readiness === 'string' && p.commerce_readiness) {
    return p.commerce_readiness === 'COMMERCE_READY';
  }
  const src = String(p.supplier_source || '');
  const cj = /cj/i.test(src) || /^cj/i.test(String(p.supplier_product_ref || ''));
  const hasCost = num(p.cost_price) > 0;
  const hasStock = p.us_inventory === true || (p.stock_status === 'in_stock' && num(p.inventory_qty) > 0);
  return cj && hasCost && hasStock;
}

const visible = (Array.isArray(prods) ? prods : []).filter((p) => (p.status === 'active' || p.status === 'published') && commerceReady(p));

// Storefront taxonomy collections (src/features/catalog/taxonomy.ts). These
// are real, crawlable destinations even before a collection has stock, so they
// belong in the sitemap alongside the DB category slugs.
const COLLECTION_SLUGS = [
  'horse', 'cattle', 'dog', 'cat',
  'feeding-water', 'comfort-rest', 'grooming-care',
  'travel-outdoor', 'stable-farm', 'play-enrichment', 'accessories',
];

const urls = ['/', '/shop', '/about', '/contact', '/blog', '/careers', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
for (const slug of COLLECTION_SLUGS) urls.push(`/category/${slug}`);
for (const c of cats) if (!COLLECTION_SLUGS.includes(c.slug)) urls.push(`/category/${c.slug}`);
for (const p of visible) urls.push(`/product/${p.id}`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://luxedge.us${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap: ${urls.length} URLs (${visible.length} commerce-ready active products, ${(Array.isArray(cats) ? cats : []).length} categories)`);
