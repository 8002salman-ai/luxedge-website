// Temporary review script — deleted after use.
// Pulls live catalog rows + images + variants and prints activation facts.
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

const products = await q('products', '?select=*&order=name');
for (const p of products) {
  const imgs = await q('product_images', `?product_id=eq.${p.id}&select=url,is_primary,sort_order&order=sort_order`);
  const variants = await q('product_variants', `?product_id=eq.${p.id}&select=attributes,price,inventory_qty`);
  const margin = p.price && p.cost_price ? (((p.price - p.cost_price) / p.price) * 100).toFixed(1) : null;
  console.log(JSON.stringify({
    name: p.name, status: p.status, category_id: p.category_id,
    price: p.price, cost: p.cost_price, margin_pct: margin,
    us_inventory: p.us_inventory, inventory_qty: p.inventory_qty,
    images: (imgs || []).length, variants: (variants || []).length,
    supplier: p.supplier_source, seo_title: p.seo_title ? 'yes' : 'no',
  }));
}
