// Snapshot the PUBLISHED blog posts into public/blog-seo.json.
//
// The Cloudflare Worker no longer reads this file — it builds the blog registry
// from the Supabase CMS at request time (worker/seo-meta.ts, getBlogRegistry),
// so a newly published guide is indexable on the next request without a
// redeploy. This file is the offline copy of the live editorial corpus used by
// the automated claim/quality scans that must run without network access:
//   * src/content/__tests__/adsense-readiness.test.ts (unsupported-claim scan)
//   * scripts/product-claim-audit.mjs consumers / QA reviews
//
// Because of that it MUST mirror the CMS, not the legacy src/App.tsx INIT_BLOGS
// fallback — an earlier version extracted from INIT_BLOGS and silently shipped a
// 4-of-8 registry, leaving half the live guides unscanned.
//
// Usage:
//   node scripts/extract-blog-seo.mjs            # requires .env DB creds
//   node scripts/extract-blog-seo.mjs --min 8    # lower the strategy floor
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const minFlag = args.indexOf('--min');
// Strategy floor: Luxedge publishes a small set of strong guides rather than
// high-volume content, and the current editorial plan holds eight. The guard
// exists so a broken query can never silently write an empty/near-empty
// registry — it is a floor, not a target.
const MIN_PUBLISHED = minFlag !== -1 && args[minFlag + 1] ? Number(args[minFlag + 1]) : 8;

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
if (!BASE || !KEY) {
  console.error('extract-blog-seo: set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env');
  process.exit(1);
}

const res = await fetch(
  `${BASE}/rest/v1/blog_posts?select=slug,title,excerpt,hero_image_url,published_at,created_at,author_name,content,faq,status&status=eq.published&order=published_at.desc&limit=500`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
).catch((err) => {
  console.error(`extract-blog-seo: database unreachable — ${err.message}`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`extract-blog-seo: blog_posts query failed (${res.status}) — refusing to write a partial registry`);
  process.exit(1);
}

const rows = await res.json();
const posts = rows
  .filter((r) => r && r.slug)
  .map((r) => ({
    slug: r.slug,
    title: r.title || r.slug,
    excerpt: r.excerpt || r.title || '',
    image: r.hero_image_url || undefined,
    date: (r.published_at || r.created_at || '').slice(0, 10) || undefined,
    authorName: r.author_name || 'Luxedge Editorial Team',
    ...(r.content ? { content: r.content } : {}),
    ...(Array.isArray(r.faq) && r.faq.length ? { faq: r.faq } : {}),
  }));

if (posts.length < MIN_PUBLISHED) {
  console.error(`extract-blog-seo: expected >=${MIN_PUBLISHED} published posts, got ${posts.length} — aborting (pass --min to lower the floor deliberately).`);
  process.exit(1);
}

const outPath = path.join(root, 'public', 'blog-seo.json');
fs.writeFileSync(outPath, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), posts }, null, 2) + '\n');
console.log(`extract-blog-seo: wrote ${posts.length} published posts -> ${outPath}`);
