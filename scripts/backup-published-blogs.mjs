// Create a restorable snapshot of every currently published blog post.
// Requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const select = 'id,slug,title,excerpt,hero_image_url,hero_image_alt,tags,author_name,author_id,status,created_at,updated_at,scheduled_at,published_at,date_label,seo_title,meta_description,target_keyword,secondary_keywords,search_intent,faq,internal_links,quality_score,generated_by,automation_run_id,automation_locked,content';
const response = await fetch(`${base}/rest/v1/blog_posts?select=${select}&status=eq.published&order=published_at.desc&limit=500`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!response.ok) throw new Error(`CMS read failed: ${response.status} ${await response.text()}`);
const posts = await response.json();
if (!Array.isArray(posts) || posts.length === 0) throw new Error('Refusing to write an empty backup');
const backup = { backedUpAt: new Date().toISOString(), source: 'Supabase blog_posts, status=published', posts };
fs.writeFileSync('blog-posts-before-editorial-review.json', JSON.stringify(backup, null, 2) + '\n');
console.log(`Backed up ${posts.length} published posts to blog-posts-before-editorial-review.json`);
