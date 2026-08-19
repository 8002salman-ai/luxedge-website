// LUXEDGE — image QA: every ACTIVE product. Checks hero + gallery HTTP status,
// duplicate URLs, missing alt, and image count. Outputs IMAGE_PASS/WEAK/REJECT.
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
async function imgOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'follow' });
    return r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (e) {
    // some CDNs reject HEAD; try GET with range
    try { const r2 = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000), redirect: 'follow' }); return r2.ok ? 'ok(GEt)' : `HTTP ${r2.status}`; }
    catch { return 'ERR'; }
  }
}

const prods = await rest('products', '?select=id,title,sku,status,image_url&status=eq.active&limit=500');
const imgs = await rest('product_images', '?select=product_id,url,is_primary,alt_text,sort_order&limit=3000');
const byProd = {};
for (const i of imgs) { byProd[i.product_id] = byProd[i.product_id] || []; byProd[i.product_id].push(i); }

const pass = [], weak = [], reject = [];
let broken = 0;
const BATCH = 6;
for (let idx = 0; idx < prods.length; idx += BATCH) {
  const batch = prods.slice(idx, idx + BATCH);
  const results = await Promise.all(batch.map(async (p) => {
    const list = (byProd[p.id] || []).sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || (a.is_primary ? -1 : 1));
    const hero = list.find(i => i.is_primary) || list[0];
    const urls = [...new Set(list.map(i => i.url).filter(Boolean))];
    const statuses = {};
    for (const u of urls.slice(0, 8)) statuses[u] = await imgOk(u);
    const brokenUrls = Object.entries(statuses).filter(([, s]) => s !== 'ok' && s !== 'ok(GEt)');
    if (brokenUrls.length) broken += brokenUrls.length;
    const noAlt = list.filter(i => !i.alt_text || !i.alt_text.trim()).length;
    const hasDup = urls.length < list.filter(i => i.url).length;
    const issues = [];
    if (brokenUrls.length) issues.push(`${brokenUrls.length} broken img`);
    if (!hero && !p.image_url) issues.push('no hero');
    if (noAlt > 0) issues.push(`${noAlt} missing alt`);
    if (hasDup) issues.push('duplicate URLs');
    if (urls.length === 0) issues.push('no gallery rows');
    let verdict = 'IMAGE_PASS';
    if (issues.length) verdict = issues.some(i => /broken|no hero/.test(i)) ? 'IMAGE_REJECT' : 'IMAGE_WEAK';
    return { id: p.id, title: p.title, sku: p.sku, urls: urls.length, issues, verdict, heroUrl: hero?.url || p.image_url };
  }));
  for (const r of results) {
    if (r.verdict === 'IMAGE_PASS') pass.push(r);
    else if (r.verdict === 'IMAGE_WEAK') weak.push(r);
    else reject.push(r);
  }
  console.log(`checked ${Math.min(idx + BATCH, prods.length)}/${prods.length}…`);
}

console.log(`\nACTIVE products: ${prods.length}`);
console.log(`IMAGE_PASS: ${pass.length}`);
console.log(`IMAGE_WEAK: ${weak.length}`);
console.log(`IMAGE_REJECT: ${reject.length}`);
console.log(`BROKEN image URLs: ${broken}`);
console.log('\n=== WEAK/REJECT detail ===');
for (const r of [...weak, ...reject]) console.log(`${r.verdict} | ${r.title} | ${r.issues.join(', ')}`);
fs.writeFileSync('scripts/image-audit-result.json', JSON.stringify({ pass, weak, reject, broken }, null, 2));
