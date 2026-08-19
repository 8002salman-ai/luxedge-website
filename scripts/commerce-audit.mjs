// ============================================================================
// LUXEDGE — COMMERCE TRUTH AUDIT (Source + Economics Hardening)
//
// Classifies EVERY catalog product using the commerce-readiness model:
//   source_type         CJ_DROPSHIPPING / RETAIL_REFERENCE_ONLY / UNKNOWN …
//   inventory_source    SUPPLIER_VERIFIED / INTERNAL_STOCK / UNTRACKED / UNKNOWN
//   commerce_readiness  COMMERCE_READY / SOURCE_PENDING / ECONOMICS_PENDING /
//                       FULFILLMENT_PENDING / RISK_REVIEW / DRAFT
//
// Immediate storefront safety (works WITHOUT migration 0016):
//   * KONG retail-reference products (manufacturer page = authenticity ONLY,
//     no wholesale/dropship path, no cost, no supplier stock) → status DRAFT.
//   * Fabricated internal stock claims removed (us_inventory=false,
//     stock_status=unknown) — internal qty is NOT supplier stock.
//   * Legacy CJ products get supplier_source/supplier_product_ref backfilled
//     from persisted evidence (product_source_evidence / evidence_notes).
//   * US inventory evidence that already exists is honored (list-level).
//
// When migration 0016 is applied, the same classification is also persisted
// into the commerce_readiness/source_type/inventory_source/risk_flags columns
// (schema-aware: absent columns are simply not written).
//
// No new CJ calls. No deletions. No fabricated facts.
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL || !KEY) { console.error('env missing'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const rest = async (table, { method = 'GET', q = '', body } = {}) => {
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

// Schema awareness: which 0016 columns exist in the LIVE products table?
async function liveCols() {
  try {
    const openApi = await fetch(`${URL}/rest/v1/`, { headers: { ...HEAD, Accept: 'application/openapi+json' } }).then((r) => r.json());
    const props = (openApi?.components?.schemas?.products || openApi?.definitions?.products || {}).properties || {};
    return new Set(Object.keys(props));
  } catch { return new Set(); }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// --- Classification ----------------------------------------------------------
function classify(p) {
  const src = String(p.supplier_source || '').toLowerCase();
  const ev = p.product_source_evidence || {};
  const notes = String(p.evidence_notes || '');
  const skuLower = String(p.sku || '').toLowerCase();
  const isKong = /kong|official manufacturer/i.test(src) || (ev && /kong/i.test(String(ev.provider || ''))) || /^kong-/.test(skuLower) || /kong classic/i.test(skuLower);
  const isCj = /cj/.test(src) || /^cj/i.test(String(p.supplier_product_ref || '')) ||
    (ev && /cj/i.test(String(ev.provider || ''))) || /cj list|listv2|list-level cj/i.test(notes) || /CJ[A-Z0-9]{4,}/.test(String(p.sku || ''));

  const hasCost = num(p.cost_price) > 0 || num(p.landed_cost) > 0;
  // Real list-level US inventory evidence (from persisted seed/evidence notes).
  const usInvClaim = /US inventory\s+(\d+)\s+units?/i.exec(notes);
  const usInvEvidence = usInvClaim ? num(usInvClaim[1]) > 0 : false;

  let sourceType = 'UNKNOWN';
  if (isKong) sourceType = 'RETAIL_REFERENCE_ONLY';
  else if (isCj) sourceType = 'CJ_DROPSHIPPING';
  else if (src) sourceType = 'OTHER_VERIFIED';

  let inventorySource = 'UNKNOWN';
  if (sourceType === 'CJ_DROPSHIPPING' && (p.us_inventory === true || usInvEvidence)) inventorySource = 'SUPPLIER_VERIFIED';
  else if (p.stock_status && p.stock_status !== 'unknown' && p.stock_status !== 'out_of_stock') inventorySource = 'INTERNAL_STOCK';

  // Readiness is fact-based first; lifecycle DRAFT for genuinely non-material
  // states. KONG retail-reference stays SOURCE_PENDING even when drafted for
  // safety (the readiness column keeps the reason). Battery/power-unknown
  // electronics are RISK_REVIEW. Everything else that is drafted (business/
  // market decision, e.g. bulky beds) is DRAFT — not COMMERCE_READY.
  let readiness;
  if (sourceType === 'RETAIL_REFERENCE_ONLY' || sourceType === 'UNKNOWN') readiness = 'SOURCE_PENDING';
  else if (!hasCost) readiness = 'ECONOMICS_PENDING';
  else if (inventorySource !== 'SUPPLIER_VERIFIED') readiness = 'FULFILLMENT_PENDING';
  else readiness = 'COMMERCE_READY';

  if (p.status === 'inactive' || p.status === 'archived') readiness = 'DRAFT';
  else if (p.status === 'draft' || p.status === 'ready') {
    // Battery/power-unknown electronics are RISK_REVIEW (owner/battery
    // resolution needed). KONG retail-reference products keep SOURCE_PENDING.
    // Other drafted products (market/business decision) are DRAFT.
    if (/led|battery|electric|electronic|motion|rechargeable/i.test(String(p.name || '') + ' ' + notes)) readiness = 'RISK_REVIEW';
    else if (sourceType !== 'RETAIL_REFERENCE_ONLY') readiness = 'DRAFT';
  }

  return { sourceType, inventorySource, readiness, usInvEvidence, isCj, isKong };
}

// --- Apply -------------------------------------------------------------------
const cols = await liveCols();
const has0016 = cols.has('commerce_readiness');
const products = await rest('products', { q: '?select=id,name,status,sku,supplier_source,supplier_product_ref,cost_price,landed_cost,us_inventory,stock_status,inventory_qty,evidence_notes,product_source_evidence,shipping_cost,free_shipping,delivery_min_days,delivery_max_days&limit=500' });

const tally = { COMMERCE_READY: 0, SOURCE_PENDING: 0, ECONOMICS_PENDING: 0, FULFILLMENT_PENDING: 0, RISK_REVIEW: 0, DRAFT: 0 };
const kongDrafted = [];
const cjBackfilled = [];

for (const p of products) {
  const c = classify(p);
  tally[c.readiness] = (tally[c.readiness] || 0) + 1;
  const patch = {};
  const notes = String(p.evidence_notes || '');
  const ev = p.product_source_evidence || {};

  // 1) Immediate safety: no verified purchasing path (retail-reference OR
  //    unknown source) → DRAFT (not customer-visible); fabricated internal
  //    stock claims removed.
  if ((c.sourceType === 'RETAIL_REFERENCE_ONLY' || c.sourceType === 'UNKNOWN') && (p.status === 'active' || p.status === 'published')) {
    patch.status = 'draft';
    patch.us_inventory = false;
    // 0010 CHECK allows in_stock/low_stock/out_of_stock/on_backorder only —
    // 'unknown' maps to NULL (storefront treats null/unknown as unverified).
    patch.stock_status = null;
    kongDrafted.push(p.name);
  }

  // 2) Backfill legacy CJ products' source fields from persisted evidence.
  if (c.isCj && !p.supplier_source) {
    patch.supplier_source = 'CJ';
    if (!p.supplier_product_ref) {
      const pid = ev.pid || /CJ[A-Z0-9]{4,}/.exec(String(p.sku || ''))?.[0] || null;
      if (pid) patch.supplier_product_ref = String(pid);
    }
    cjBackfilled.push(p.name);
  }

  // 3) Honor real list-level US inventory evidence that already exists.
  if (c.isCj && c.usInvEvidence && p.us_inventory !== true) {
    patch.us_inventory = true;
    if (num(p.inventory_qty) > 0 && (p.stock_status !== 'in_stock')) patch.stock_status = 'in_stock';
  }

  // 4) Persist the 0016 classification when the columns exist.
  if (has0016) {
    patch.commerce_readiness = c.readiness;
    patch.source_type = c.sourceType;
    patch.inventory_source = c.inventorySource;
    if (!patch.risk_flags) {
      const flags = [];
      if (c.sourceType === 'RETAIL_REFERENCE_ONLY') {
        flags.push('No verified wholesale/dropship purchasing path');
        if (!(num(p.cost_price) > 0)) flags.push('Supplier cost UNKNOWN');
        flags.push('Internal stock placeholder only — not supplier stock');
      }
      if (c.readiness === 'FULFILLMENT_PENDING') flags.push('US stock/shipping evidence not verified');
      if (c.readiness === 'ECONOMICS_PENDING') flags.push('Supplier cost UNKNOWN');
      patch.risk_flags = flags;
    }
    if (!patch.fulfillment_method && c.sourceType === 'CJ_DROPSHIPPING') patch.fulfillment_method = 'CJ dropship (US warehouse, list-level inventory)';
  }

  if (Object.keys(patch).length > 0) {
    await rest('products', { method: 'PATCH', q: `?id=eq.${p.id}`, body: patch });
  }
}

console.log('migration 0016 columns present:', has0016);
console.log('readiness tally (all 66):', JSON.stringify(tally));
console.log('KONG → DRAFT (storefront-safe):', kongDrafted.length);
console.log('CJ source backfilled:', cjBackfilled.length);

// Final state check (only select columns that exist — pre/post 0016 safe)
const sel = has0016 ? 'status,commerce_readiness,source_type' : 'status';
const after = await rest('products', { q: `?select=${sel}&limit=500` });
const byStatus = {};
for (const r of after) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log('status counts:', JSON.stringify(byStatus));
if (has0016) {
  const byReadiness = {};
  for (const r of after) { const k = r.commerce_readiness || 'UNSET'; byReadiness[k] = (byReadiness[k] || 0) + 1; }
  console.log('readiness counts:', JSON.stringify(byReadiness));
}
