// Temporary cleanup script — deleted after use.
// 1) Delete SMOKE TEST orphan products + their images/variants (my artifacts).
// 2) Restore the product clobbered to "TEST PATCH NAME" (name = its professional title).
// 3) Sync name = professional title for all products whose storefront name is still raw CJ text.
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
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('missing env'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(table, method = 'GET', extra = '', body = null) {
  const res = await fetch(`${URL}/rest/v1/${table}${extra}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${method} ${table}${extra}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const products = await rest('products', 'GET', '?select=id,name,title,sku');

// 1) Delete smoke orphans (children first, then the rows).
const orphans = products.filter((p) => p.name.includes('SMOKE TEST'));
for (const p of orphans) {
  await rest('product_variants', 'DELETE', `?product_id=eq.${p.id}`);
  await rest('product_images', 'DELETE', `?product_id=eq.${p.id}`);
  await rest('products', 'DELETE', `?id=eq.${p.id}`);
  console.log(`  deleted orphan ${p.id.slice(0, 8)} (${p.sku})`);
}
console.log(`Orphans deleted: ${orphans.length}`);

// 2) Restore the clobbered product.
const clobbered = products.filter((p) => p.name === 'TEST PATCH NAME');
for (const p of clobbered) {
  await rest('products', 'PATCH', `?id=eq.${p.id}`, { name: p.title });
  console.log(`  restored name for ${p.id.slice(0, 8)} -> "${p.title}"`);
}

// 3) Sync name = title where they differ (professionalized products only).
let synced = 0;
for (const p of products) {
  if (p.name && p.title && p.name !== p.title && !p.name.includes('SMOKE TEST') && p.name !== 'TEST PATCH NAME') {
    await rest('products', 'PATCH', `?id=eq.${p.id}`, { name: p.title });
    synced += 1;
    console.log(`  name -> "${p.title}"`);
  }
}
console.log(`Names synced to professional titles: ${synced}`);
