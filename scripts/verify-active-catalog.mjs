import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const [prodsRes, catsRes] = await Promise.all([
  fetch(`${base}/rest/v1/products?select=id,slug,title,name,status,category_id,commerce_readiness&status=eq.active&order=category_id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  }),
  fetch(`${base}/rest/v1/categories?select=id,name,slug`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
]);
const prods = await prodsRes.json();
const cats = await catsRes.json();
const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));

console.log('ACTIVE PRODUCTS REMAINING IN DB:', prods.length);
for (const p of prods) {
  console.log(`${catMap[p.category_id] || 'UNCATEGORIZED'} | ${p.slug} | ${p.title || p.name}`);
}
