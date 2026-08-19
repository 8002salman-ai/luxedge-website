import { readFileSync } from 'node:fs';
const envRaw = readFileSync('.env', 'utf8');
const get = (k) => {
  const m = envRaw.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};
const base = (get('VITE_SUPABASE_URL') || '').replace(/\/$/, '');
const service = get('SUPABASE_SERVICE_ROLE_KEY');

async function jfetch(path, key = service, opts = {}) {
  const res = await fetch(`${base}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const out = {};

// 1. Current products
const prods = await jfetch('/products?select=id,name,category,subcategory,status,price,cost,image_url,inventory_qty,brand,slug&order=category');
out.products = prods.ok ? prods.data : { error: prods.status };

// 2. Discover which research tables exist
for (const t of ['product_candidates', 'supplier_api_runs', 'market_evidence', 'market_intelligence_jobs', 'cj_products', 'seed_records']) {
  const r = await jfetch(`/${t}?select=*&limit=3`);
  out[`table_${t}`] = { status: r.status, ok: r.ok, sample: r.ok && Array.isArray(r.data) ? r.data : r.data };
}

console.log(JSON.stringify(out, null, 2));
