// Temporary backfill script — deleted after use.
// products.image_url = the primary product_images.url (same real CJ URL).
// This is the storefront's documented fallback path (catalog.ts reads
// product_images first, then image_url). The structural RLS fix is migration
// 0011 (owner applies via SQL Editor); this backfill makes images render even
// before that migration is applied.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const env = {};
  if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const U = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!U || !KEY) { console.error('missing env'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(table, method = 'GET', extra = '', body = null) {
  const res = await fetch(`${U}/rest/v1/${table}${extra}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${method} ${table}${extra}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const products = await rest('products', 'GET', '?select=id,name,status,image_url');
let updated = 0;
for (const p of products) {
  const imgs = await rest('product_images', 'GET', `?product_id=eq.${p.id}&select=url,is_primary,sort_order&order=sort_order`);
  if (!imgs || !imgs.length) continue;
  const primary = imgs.find((i) => i.is_primary) || imgs[0];
  if (!primary?.url || primary.url === p.image_url) continue;
  await rest('products', 'PATCH', `?id=eq.${p.id}`, { image_url: primary.url });
  updated += 1;
  console.log(`  image_url <- ${String(primary.url).slice(0, 60)} (${p.status})`);
}
console.log(`Backfilled image_url on ${updated} products.`);
