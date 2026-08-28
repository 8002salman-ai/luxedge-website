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

// The 0016 commerce_readiness column exists on production; select it always
// (the OpenAPI schema probe is unreliable on some Supabase versions). The
// stored value mirrors the storefront gate exactly, so it is authoritative
// when present.
const sel = 'id,slug,status,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness';
const prods = await (await fetch(
  `${URL}/rest/v1/products?select=${sel}&status=in.(active,published)&limit=500`,
  { headers: HEAD },
)).json();
const cats = await (await fetch(`${URL}/rest/v1/categories?select=slug&is_active=eq.true&limit=50`, { headers: HEAD })).json();

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Mirror of the storefront commerce-ready gate (services/catalog.ts). */
function commerceReady(p) {
  // Stored COMMERCE_READY is authoritative (same rule as isStorefrontReady).
  if (typeof p.commerce_readiness === 'string' && p.commerce_readiness) {
    return p.commerce_readiness === 'COMMERCE_READY';
  }
  // Fallback mirrors the app's authoritative deriveCommerceReadiness
  // (src/features/catalog/commerceReadiness.ts): any verified supplier source
  // (OTHER_VERIFIED, e.g. AliExpress) with a real cost basis and USA
  // fulfillment evidence qualifies — NOT only CJ. This keeps the sitemap in
  // sync with the products actually purchasable on the storefront.
  const src = String(p.supplier_source || '').toLowerCase();
  const isUnverified = !src || /kong|official manufacturer|manufacturer page/i.test(src);
  if (isUnverified) return false;
  const hasCost = num(p.cost_price) > 0;
  const hasFulfillment = p.us_inventory === true || (p.stock_status === 'in_stock' && num(p.inventory_qty) > 0);
  return hasCost && hasFulfillment;
}

const visible = (Array.isArray(prods) ? prods : []).filter((p) => (p.status === 'active' || p.status === 'published') && commerceReady(p));

// Blog posts are authored in the app (src/App.tsx BLOGS array); keep their URLs
// stable here so sitemap and storefront stay in sync.
const blogSlugs = [
  'essential-supplies-new-puppy', 'cozy-corner-for-your-cat', 'grooming-routine-long-haired-pets',
  'best-gifts-under-50-for-pets', 'interactive-toys-pet-enrichment', 'get-pet-to-drink-more-water',
  'traveling-with-pets-tips', 'slow-feeding-explained', 'online-pet-shopping-safety-tips',
  'holiday-pet-gift-guide', 'summer-pet-safety-checklist', 'senior-dog-comfort-guide',
  'indoor-cat-enrichment-ideas', 'dog-training-basics-beginners', 'cat-health-wellness-tips',
  'pet-travel-essentials-guide', 'bird-care-beginners-guide', 'equestrian-essentials-horse-care',
  'best-bird-feeder-buyers-guide', 'horse-grooming-kit-buyers-guide', 'dog-car-safety-seat-belt-guide',
  'dog-cooling-mat-buyers-guide', 'automatic-pet-feeder-buyers-guide', 'cat-window-perch-buyers-guide',
  'horse-salt-lick-buyers-guide',
];

const urls = ['/', '/shop', '/blog', '/about', '/contact', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
for (const c of cats) urls.push(`/category/${c.slug}`);
for (const s of blogSlugs) urls.push(`/blog/${s}`);
for (const p of visible) urls.push(`/product/${p.slug || p.id}`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://luxedge.us${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap: ${urls.length} URLs (${visible.length} commerce-ready active products, ${(Array.isArray(cats) ? cats : []).length} categories)`);
