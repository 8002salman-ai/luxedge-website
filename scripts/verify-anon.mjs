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
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('missing env'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(table, extra = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${extra}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const cats = await q('categories', '?select=id,name,is_active&order=name');
const prods = await q('products', '?select=id,name,status,category_id&order=name');
const vis = prods.filter((p) => p.status === 'active' || p.status === 'published');
const catName = new Map(cats.map((c) => [c.id, c.name]));
console.log(`anon-visible products: ${vis.length} / ${prods.length}`);
console.log(`active categories: ${cats.filter((c) => c.is_active !== false).length}`);
for (const p of vis) console.log('  -', p.name, '|', catName.get(p.category_id), '|', p.status);
