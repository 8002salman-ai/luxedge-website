// LUXEDGE — audit all persisted pools: catalog + every CJ seed job (no new spend)
import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL || !KEY) { console.error('env missing'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function rest(table, q = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// 1. Full catalog
const cats = await rest('categories', '?select=id,name,slug&limit=100');
const catName = new Map(cats.map(c => [c.id, c.name]));
const prods = await rest('products', '?select=id,name,title,status,price,cost_price,inventory_qty,sku,image_url,tags,evidence_notes,product_source_evidence,category_id&order=status&limit=500');
for (const p of prods) p.category = catName.get(p.category_id) || '?';

// per-product image count
const imgs = await rest('product_images', '?select=product_id&limit=5000');
const imgCount = {};
for (const i of imgs) imgCount[i.product_id] = (imgCount[i.product_id] || 0) + 1;
for (const p of prods) p.image_count = imgCount[p.id] || 0;
const active = prods.filter(p => p.status === 'active');
const draft = prods.filter(p => p.status === 'draft');
console.log(`CATALOG: total=${prods.length} active=${active.length} draft=${draft.length}`);
console.log('\n--- ACTIVE ---');
for (const p of active) console.log(`[${p.category || '?'}] ${p.title} | $${p.price} | cost $${p.cost_price ?? '?'} | qty ${p.inventory_qty ?? '?'} | sku ${p.sku || '-'} | img ${(p.image_url || '').slice(0, 60)}`);
console.log('\n--- DRAFT ---');
for (const p of draft) console.log(`[${p.category || '?'}] ${p.title} | $${p.price} | sku ${p.sku || '-'} | img ${(p.image_url || '').slice(0, 60)}`);

// 2. All agent jobs carrying CJ seed output
const jobs = await rest('agent_jobs', '?select=id,type,status,created_at&order=created_at.desc&limit=200');
console.log('\n--- AGENT JOBS (recent 40) ---');
for (const j of jobs.slice(0, 40)) console.log(`${j.created_at?.slice(0, 16)} ${j.type} ${j.status} ${j.id}`);
