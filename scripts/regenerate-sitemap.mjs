// Regenerate public/sitemap.xml from the live catalog — ACTIVE products only
// (never DRAFT/INACTIVE URLs). Static pages + categories + active products.
import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('env missing'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const prods = await (await fetch(`${URL}/rest/v1/products?select=id,title&status=eq.active&order=title&limit=500`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const cats = await (await fetch(`${URL}/rest/v1/categories?select=slug&is_active=eq.true&limit=50`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();

const urls = ['/', '/shop', '/about', '/contact', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
for (const c of cats) urls.push(`/category/${c.slug}`);
for (const p of prods) urls.push(`/product/${p.id}`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://luxedge.us${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap: ${urls.length} URLs (${prods.length} active products, ${cats.length} categories)`);
