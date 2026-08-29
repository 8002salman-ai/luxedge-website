// ============================================================================
// LUXEDGE — migrate published blog posts from blog-seo.json into the Supabase
// blog CMS (blog_posts). Idempotent: posts whose slug already exists are
// skipped, so it may be re-run safely. Uses the service-role key server-side.
//
// Usage: node scripts/migrate-blogs-to-cms.mjs
// Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
//
// READ from public/blog-seo.json (the blog-seo.json is itself extracted from
// INIT_BLOGS by scripts/extract-blog-seo.mjs), so this one step migrates the
// full published inventory. Preserves every existing slug/title/content/date/
// image/author/FAQ — migration-integrity friendly.
// ============================================================================
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('env missing (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }

const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

const registry = JSON.parse(fs.readFileSync('public/blog-seo.json', 'utf8'));
if (!Array.isArray(registry.posts) || !registry.posts.length) {
  console.error('blog-seo.json has no posts'); process.exit(1);
}

// Pull tags straight from INIT_BLOGS in src/App.tsx (blog-seo.json does not
// carry them) so the CMS seed preserves the original tag list per slug.
const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
const start = appSrc.indexOf('const INIT_BLOGS');
const assign = appSrc.indexOf('= [', start);
const arrOpen = assign >= 0 ? assign + 2 : -1;
let tagsBySlug = {};
if (arrOpen >= 0) {
  const after = appSrc.indexOf('export const CAT_LIST', start);
  const slice = (after > arrOpen ? appSrc.slice(arrOpen, after) : appSrc.slice(arrOpen, appSrc.indexOf('];', arrOpen) + 2))
    .replace(/;\s*$/, '').trim();
  try {
    const posts = new Function(`return ${slice}`)();
    if (Array.isArray(posts)) {
      for (const p of posts) if (p && p.slug) tagsBySlug[p.slug] = Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string') : [];
    }
  } catch { /* tags are best-effort; seed without them */ }
}

const existing = await (await fetch(`${URL}/rest/v1/blog_posts?select=slug`, { headers: HEAD })).json();
const existingSlugs = new Set(Array.isArray(existing) ? existing.map((r) => r.slug) : []);

let created = 0, skipped = 0;
for (const p of registry.posts) {
  if (existingSlugs.has(p.slug)) { skipped++; continue; }
  const row = {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || null,
    content: p.content || '',
    hero_image_url: p.image || null,
    tags: tagsBySlug[p.slug] || [],
    author_name: p.authorName || 'Luxedge',
    status: 'published',
    published_at: p.date ? `${p.date}T00:00:00Z` : new Date().toISOString(),
    date_label: p.date || null,
    seo_title: p.title || null,
    meta_description: (p.excerpt && p.excerpt.slice(0, 160)) || null,
    target_keyword: null,
    secondary_keywords: [],
    search_intent: null,
    faq: Array.isArray(p.faq) ? p.faq : [],
    internal_links: [],
    quality_score: null,
    generated_by: 'manual',
    automation_locked: false,
  };
  const res = await fetch(`${URL}/rest/v1/blog_posts`, { method: 'POST', headers: HEAD, body: JSON.stringify(row) });
  if (res.ok) { created++; }
  else { console.error(`create failed for ${p.slug}: ${res.status} ${await res.text()}`); }
}
console.log(`migrate-blogs-to-cms: ${created} created, ${skipped} skipped (already present), ${registry.posts.length} total from blog-seo.json`);