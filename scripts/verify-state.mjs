// Temporary verification script — deleted after use.
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

async function q(table, extra = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${extra}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const cats = await q('categories', '?select=id,name,slug');
const catName = new Map(cats.map((c) => [c.id, c.name]));
const products = await q('products', '?select=id,name,status,price,cost_price,category_id,us_inventory&order=name');
console.log('=== CATALOG STATE (after cleanup) ===');
console.log(`Total: ${products.length} | by status:`, products.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {}));
for (const p of products) {
  const imgs = await q('product_images', `?product_id=eq.${p.id}&select=url,is_primary`);
  const img = imgs.find((i) => i.is_primary) || imgs[0];
  let dims = null;
  if (img) {
    try {
      const r = await fetch(img.url, { method: 'HEAD' });
      dims = { status: r.status, type: r.headers.get('content-type'), len: r.headers.get('content-length') };
    } catch { dims = { status: 'ERR' }; }
  }
  const margin = p.price && p.cost_price ? Math.round(((p.price - p.cost_price) / p.price) * 100) : null;
  console.log(JSON.stringify({ name: p.name.slice(0, 50), status: p.status, cat: catName.get(p.category_id), price: p.price, margin, us_inv: p.us_inventory, images: imgs.length, img: dims }));
}
