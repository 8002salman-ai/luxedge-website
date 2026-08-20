import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function rest(table, q = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
const cats = await rest('categories', '?select=id,name&limit=100');
const catName = new Map(cats.map(c => [c.id, c.name]));
const prods = await rest('products', '?select=id,title,sku,status,category_id,tags,image_url&limit=500');
const act = prods.filter(p => p.status === 'active');
const draft = prods.filter(p => p.status === 'draft');
console.log(`TOTAL ${prods.length} | ACTIVE ${act.length} | DRAFT ${draft.length}`);
// species via title + tags + category
let dog = 0, cat = 0, both = 0, unknown = 0;
for (const p of act) {
  const catStr = catName.get(p.category_id) || '';
  const t = (p.title + ' ' + JSON.stringify(p.tags || '') + ' ' + catStr).toLowerCase();
  const hasCat = /\bcat\b|kitten|kitty/.test(t);
  const hasDog = /\bdog\b|puppy/.test(t);
  const isCatCat = /cat supplies/.test(catStr);
  const isDogCat = /dog supplies/.test(catStr);
  if (isCatCat && !isDogCat) cat++;
  else if (isDogCat && !isCatCat) dog++;
  else if (hasCat && hasDog) both++;
  else if (hasCat) cat++;
  else if (hasDog) dog++;
  else unknown++;
}
console.log(`ACTIVE: dog ~${dog}, cat ~${cat}, both ~${both}, unknown ~${unknown}`);
// broken images check
const imgs = await rest('product_images', '?select=product_id,url,is_primary&limit=3000');
const byProd = {};
for (const i of imgs) { byProd[i.product_id] = byProd[i.product_id] || []; byProd[i.product_id].push(i); }
let noImg = 0;
for (const p of act) {
  const list = byProd[p.id] || [];
  const hero = list.find(i => i.is_primary) || list[0];
  if (!p.image_url && !hero) { noImg++; console.log('NO IMAGE:', p.title); }
}
console.log('ACTIVE without any image row:', noImg);
