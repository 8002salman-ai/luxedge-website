// LUXEDGE — backfill durable CJ source evidence for legacy ACTIVE products
// from the persisted seed pool (agent jobs). No new CJ calls.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function rest(table, opts = {}) {
  const { method = 'GET', q = '', body } = opts;
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// load seed pool
const bySku = new Map();
for (const id of ['d4e7e0e7-df14-42ff-8c71-612dc784156b', 'b01c2362-b4b1-4748-b808-2ebeb5d46162', '00c8387f-e030-4d8a-86a5-f114e0b6673d']) {
  const jobs = await rest('agent_jobs', { q: `?select=output&id=eq.${id}` });
  const seeds = jobs[0]?.output?.seeds || [];
  for (const s of seeds) {
    if (!s || typeof s !== 'object') continue;
    const sku = String(s.sku || s.productId || '');
    if (sku) bySku.set(sku, s);
  }
}

const prods = await rest('products', '?select=id,sku,product_source_evidence,evidence_notes&status=eq.active&limit=500');
let fixed = 0;
for (const p of prods) {
  const ev = p.product_source_evidence || {};
  if (ev.source || p.evidence_notes) continue; // already has provenance
  const s = bySku.get(p.sku);
  if (!s) { console.log(`NO SEED for ${p.sku}`); continue; }
  const newEv = {
    provider: 'cj',
    sourceUrl: s.sourceUrl || null,
    pid: s.productId || null,
    observedAt: s.observedAt || null,
    verification: 'list-level CJ record (supplier price + US inventory). Freight/delivery UNKNOWN.',
    listingStandard: 'Luxedge professional listing: curated title/description/SEO/alt. No invented facts.',
    professionalizedAt: p.product_source_evidence?.professionalizedAt || null,
  };
  const note = `Seeded from CJ listV2 record ${p.sku}. Supplier price ${s.sellPrice ? '$' + s.sellPrice : 'UNKNOWN'} (list-level). US inventory ${s.usInventoryTotal ?? 'UNKNOWN'} units (list-level inventory, not delivery). Freight/delivery timeline UNKNOWN — verify before final publication.`;
  await rest('products', { method: 'PATCH', q: `?id=eq.${p.id}`, body: { product_source_evidence: newEv, evidence_notes: note } });
  console.log(`+ ${p.sku} evidence backfilled (sourceUrl ${s.sourceUrl ? 'yes' : 'no'})`);
  fixed++;
}
console.log(`\nBackfilled ${fixed} products`);
