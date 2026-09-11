import fs from 'fs';
import { isHeldProduct, isHeldMedia } from '../src/content/reviewHolds.ts';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const get = async (path) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const [prods, cats, blogs, media] = await Promise.all([
  get('products?select=id,slug,status,is_featured,title&status=in.(active,published)&limit=500'),
  get('categories?select=slug&is_active=eq.true&limit=200'),
  get('blog_posts?select=slug&status=eq.published&limit=500'),
  get('media_videos?select=slug&status=eq.published&limit=500'),
]);

const urls = ['/', '/shop', '/blog', '/about', '/contact', '/privacy', '/terms', '/returns', '/shipping-policy', '/faq'];
for (const c of cats) urls.push(`/category/${c.slug}`);
for (const b of blogs) urls.push(`/blog/${b.slug}`);
urls.push('/media');
for (const m of media) { if (!isHeldMedia(m.slug)) urls.push(`/media/${m.slug}`); }

const addedProducts = new Set();
for (const p of prods) {
  if (p.status !== 'archived' && !isHeldProduct(p.slug)) {
    const slug = p.slug || p.id;
    if (!addedProducts.has(slug)) {
      addedProducts.add(slug);
      urls.push(`/product/${slug}`);
    }
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://luxedge.us${u}</loc></url>`).join('\n')}
</urlset>
`;

fs.writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap: ${urls.length} URLs (${blogs.length} published blogs, ${cats.length} categories, ${media.length} published videos, ${addedProducts.size} active products)`);
