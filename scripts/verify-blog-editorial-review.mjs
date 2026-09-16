import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Missing Supabase environment variables');
const response = await fetch(`${base}/rest/v1/blog_posts?select=slug,title,content,hero_image_url,hero_image_alt,seo_title,meta_description,faq,status&status=eq.published&limit=500`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!response.ok) throw new Error(`CMS read failed: ${response.status} ${await response.text()}`);
const posts = await response.json();
const expected = new Set([
  'best-bird-feeder-buyers-guide',
  'horse-fly-mask-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'horse-halter-lead-rope-buyers-guide',
  'how-to-choose-a-cat-tunnel',
  'how-to-choose-cattle-trough-feed-water-setup',
  'how-to-clean-a-bird-feeder',
  'how-to-fit-no-pull-dog-harness',
]);
const filler = /in today's (digital|fast-paced) world|in this comprehensive guide|whether you're a beginner|let's dive|unlock the secrets|game changer/i;
const heldOrDeleted = /\/product\/(adjustable-nylon-horse-halter-lead-rope|kong-classic-durable-natural-rubber-dog-toy|2m-pet-dog-leash-with-soft-padded-handle-highly-reflective-dog-rope-for-night-walking-suitable-for-small-medium-and-large-dogs)/i;
const failures = [];
if (posts.length !== expected.size) failures.push(`expected ${expected.size} published posts, found ${posts.length}`);
for (const p of posts) {
  if (!expected.has(p.slug)) failures.push(`${p.slug}: not in the reviewed set`);
  const words = String(p.content || '').split(/\s+/).filter(Boolean).length;
  const links = [...String(p.content || '').matchAll(/\]\((\/[^)]+)\)/g)].map((m) => m[1]);
  if (words < 400) failures.push(`${p.slug}: only ${words} body words`);
  if (!p.title || !p.seo_title || !p.meta_description) failures.push(`${p.slug}: missing title/meta`);
  if (p.seo_title && p.seo_title.length > 60) failures.push(`${p.slug}: SEO title is ${p.seo_title.length} chars`);
  if (p.meta_description && p.meta_description.length > 160) failures.push(`${p.slug}: meta description is ${p.meta_description.length} chars`);
  if (links.length < 2) failures.push(`${p.slug}: fewer than 2 internal links`);
  if (filler.test(p.content || '')) failures.push(`${p.slug}: filler phrase found`);
  if (heldOrDeleted.test(p.content || '')) failures.push(`${p.slug}: held/deleted product link found`);
  if (!Array.isArray(p.faq) || p.faq.length < 3) failures.push(`${p.slug}: fewer than 3 FAQ items`);
  if (p.hero_image_url && !p.hero_image_alt) failures.push(`${p.slug}: hero image has no alt text`);
}
for (const slug of expected) if (!posts.some((p) => p.slug === slug)) failures.push(`${slug}: missing from CMS`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Editorial review contract passed for ${posts.length} published posts.`);
