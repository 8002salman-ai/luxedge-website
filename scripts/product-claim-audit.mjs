// LUXEDGE — product-claim audit (read-only).
//
// Scans every publicly listable product's visible copy (name, short
// description, long description, SEO title/description) for the claim classes
// that must not ship without evidence: safety/certification, medical or
// treatment outcomes, noise/load/UV figures, airline approval, biodegradability
// timelines, and third-party brand names that imply official sourcing.
//
// Nothing is modified and no secret is exposed. Public results only.
// Usage: node scripts/product-claim-audit.mjs [--json]
import fs from 'fs';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const txt = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Same public contract as the storefront (src/content/productEligibility.ts). */
function listable(p) {
  if (!/^(active|published)$/.test(txt(p.status).toLowerCase())) return false;
  if (num(p.price) <= 0) return false;
  if (!/^https?:\/\//i.test(txt(p.image_url))) return false;
  if (txt(p.description).length + txt(p.short_description).length < 100) return false;
  if (/\bkong\b|official|manufacturer/i.test(txt(p.supplier_source))) return false;
  const declared = txt(p.commerce_readiness);
  if (declared) return declared === 'COMMERCE_READY';
  const src = txt(p.supplier_source).toLowerCase();
  return !!src && num(p.cost_price) > 0
    && (p.us_inventory === true || (txt(p.stock_status) === 'in_stock' && num(p.inventory_qty) > 0));
}

/** [label, pattern] — each is a claim that needs owner evidence before it ships. */
const CLAIMS = [
  ['airline-approval', /\bairline[- ]approved\b|\bTSA[- ]approved\b|\bIATA[- ]approved\b/i],
  ['crash-test', /\bcrash[- ]tested\b|\bcrash[- ]test(ed)?\b|\bsafety[- ]certified\b|\bNCAP\b/i],
  ['certification', /\bCertiPUR[- ]US\b|\bOEKO[- ]TEX\b|\bFDA[- ]approved\b|\bCE[- ]marked\b|\bISO\b/i],
  ['medical-outcome', /\bcures?\b|\bprevents?\b|\btreats?\b|\bheals?\b|\btherap(eutic|y)\b|\bjoint support\b|\brelieves? (pain|joint)\b/i],
  ['decibels', /\b\d{2}\s?dB\b|\bdecibels?\b/i],
  ['load-rating', /\b\d+\s?(lb|lbs|kg|pounds)\b[^.]{0,24}\b(load|capacity|hold|support|withstand)/i],
  ['uv-protection', /\bUV[- ]?(protection|resistant|blocking|proof)\b|\bUPF\s?\d+/i],
  ['non-toxic', /\bnon[- ]toxic\b|\bpet[- ]safe\b|\bfood[- ]grade\b/i],
  ['biodegradable-timeline', /\bbiodegrades?[^.]{0,40}\b(year|month|day)/i],
  ['waterproof-rating', /\bIPX?\d\b|\bwaterproof\b/i],
  ['third-party-brand-as-official', /\b3M\b|\bKONG\b|\bVelcro\b|\bGore[- ]?Tex\b/i],
  ['temperature-limited-only', new RegExp('(?!)')], // reserved: no default pattern
];

const res = await fetch(`${BASE}/rest/v1/products?select=slug,name,status,price,image_url,short_description,description,seo_title,seo_description,supplier_source,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness&limit=500`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) { console.error(`products -> ${res.status}`); process.exit(1); }
const products = (await res.json()).filter(listable);

const findings = [];
for (const p of products) {
  const fields = { name: txt(p.name), short: txt(p.short_description), long: txt(p.description), seoTitle: txt(p.seo_title), seoDesc: txt(p.seo_description) };
  for (const [where, text] of Object.entries(fields)) {
    for (const [label, re] of CLAIMS) {
      const hit = text.match(re);
      if (hit) findings.push({ slug: p.slug, where, label, text: hit[0], context: text.slice(Math.max(0, (hit.index || 0) - 40), (hit.index || 0) + 80) });
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ listable: products.length, findings }, null, 2));
} else {
  console.log(`publicly listable products: ${products.length}`);
  console.log(`claim findings: ${findings.length}\n`);
  for (const f of findings) console.log(`  [${f.label}] ${f.where} :: ${f.slug}\n      "${f.context.trim()}"`);
}
