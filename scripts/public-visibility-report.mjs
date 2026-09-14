// LUXEDGE — public-visibility report (read-only, admin-safe).
//
// Answers the operator question that the admin used to answer wrongly: of the
// products marked ACTIVE, which ones does the storefront actually publish, and
// for the rest exactly WHY not? ACTIVE means "the owner approved this listing";
// it does not mean the PDP is served. Publishing also requires a canonical slug,
// a price, a usable image, enough verified copy, verified commerce readiness and
// no known contradictory facts — the storefront's own fail-closed contract
// (src/content/productEligibility.ts), reused here so the report cannot drift
// from the site.
//
// No secret is printed; only slugs and reasons.
// Usage: node scripts/public-visibility-report.mjs
import fs from 'fs';
import { publicProductIneligibilityReason } from '../src/content/productEligibility.ts';
import { isHeldProduct } from '../src/content/reviewHolds.ts';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const FIELDS = [
  'name', 'slug', 'status', 'price', 'image_url', 'short_description', 'description',
  'commerce_readiness', 'supplier_source', 'cost_price', 'us_inventory', 'stock_status',
  'inventory_qty', 'product_images(url)',
].join(',');

const res = await fetch(`${BASE}/rest/v1/products?select=${FIELDS}&order=slug.asc&limit=500`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) { console.error(`products -> ${res.status}`); process.exit(1); }
const products = await res.json();

const active = products.filter((p) => /^(active|published)$/.test(String(p.status || '').toLowerCase()));
const listable = [];
const blocked = [];

for (const p of active) {
  const facts = { ...p, images: (p.product_images || []).map((i) => i?.url).filter(Boolean) };
  const reason = isHeldProduct(p.slug)
    ? 'held (editorial hold — CMS record kept)'
    : publicProductIneligibilityReason(facts);
  if (reason) blocked.push({ slug: p.slug, reason });
  else listable.push(p.slug);
}

const byReason = new Map();
for (const { reason } of blocked) byReason.set(reason, (byReason.get(reason) || 0) + 1);

console.log(`products in catalog:            ${products.length}`);
console.log(`publicly active rows:           ${active.length}`);
console.log(`  → publicly listable:          ${listable.length}`);
console.log(`  → active but NOT listable:    ${blocked.length}`);
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(3)}  ${reason}`);
}
if (blocked.length) {
  console.log('\nactive but not publicly listable (slug — reason):');
  for (const b of blocked) console.log(`  ${b.slug} — ${b.reason}`);
}
