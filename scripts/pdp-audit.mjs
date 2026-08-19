// LUXEDGE — programmatic PDP audit: title, price, description, stock, shipping,
// SEO title/desc, canonical fields, supplier source, evidence notes.
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
const prods = await rest('products', '?select=*&status=eq.active&limit=500');
const issues = [];
const ok = [];
for (const p of prods) {
  const problems = [];
  const title = p.title || p.name || '';
  if (!title || title.length < 8) problems.push('short title');
  if (/hot sale|wholesale|dropshipping|best seller|free shipping|factory/i.test(title)) problems.push('raw supplier wording in title');
  const price = Number(p.price);
  if (!(price > 0)) problems.push('no price');
  const desc = (p.description || p.long_description || '').trim();
  if (desc.length < 40) problems.push('short description');
  const seoT = p.seo_title;
  if (!seoT || !seoT.includes('Luxedge')) problems.push('seo_title missing/off-brand');
  const seoD = p.seo_description;
  if (!seoD || seoD.length < 40) problems.push('seo_description missing/short');
  if (!p.sku) problems.push('no sku');
  if (!p.image_url) problems.push('no image_url');
  if (p.supplier_source && !p.supplier_product_ref && p.supplier_source !== 'CJ' && p.supplier_source !== 'KONG Company (official manufacturer)') problems.push('supplier source without ref');
  const ev = p.product_source_evidence || {};
  if (!ev.source && !p.evidence_notes) problems.push('no source evidence');
  // price sanity: KONG products priced at retail, CJ products margin check
  const cost = Number(p.cost_price);
  if (cost > 0) {
    const margin = 1 - cost / price;
    if (margin < 0.3) problems.push(`thin margin ${(margin * 100).toFixed(0)}%`);
  }
  if (problems.length) issues.push({ sku: p.sku, title: title.slice(0, 55), problems });
  else ok.push(p.sku);
}
console.log(`ACTIVE audited: ${prods.length} | PASS: ${ok.length} | ISSUES: ${issues.length}`);
for (const i of issues) console.log(`- [${i.sku}] ${i.title} :: ${i.problems.join('; ')}`);
