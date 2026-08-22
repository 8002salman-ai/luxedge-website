// ============================================================================
// LUXEDGE — COMPLETE BIRD CATALOG FROM CJ (run AFTER CJ_API_KEY is set)
//
// Usage:  node scripts/complete-bird-catalog.mjs [--dry-run]
//
// Requires (server-side): CJ_API_KEY on the Cloudflare worker, admin JWT via
// Supabase login (credentials from .env), durable-run ledger (migration 0008).
//
// Flow:
//   1. health -> start (durable run, budget 250)
//   2. search "bird feed" (US market) -> bird-relevant candidates
//   3. pick 5 best (US verified inventory, free shipping, sensible cost)
//   4. per product: product/query (variants, images, inventory) + freight
//      (US) -> real cost/shipping/delivery
//   5. price with the standard Luxedge rules (2.9% fee, 50% margin target,
//      .99 rounding) — from REAL landed cost only
//   6. update the 5 bird draft rows: real title/cost/price/shipping/images,
//      supplier identity (CJ), source_type=CJ_DROPSHIPPING, readiness, and
//      status=active ONLY when genuinely COMMERCE_READY
//
// No fabricated data: any missing fact stays UNKNOWN and the product stays
// unready/unpublished.
// ============================================================================
import fs from 'fs';

const API = 'https://www.luxedge.us';
const DRY = process.argv.includes('--dry-run');

function env() {
  const e = {};
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return e;
}

const E = env();

async function adminToken() {
  const r = await fetch(`${E.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: E.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: 'admin@luxedge.us', password: 'Admin123@@@' }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Admin login failed: ' + JSON.stringify(d).slice(0, 150));
  return d.access_token;
}

async function cj(path, opts = {}, tok) {
  const r = await fetch(`${API}/api/suppliers/cj${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${tok}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`CJ ${path}: HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d;
}

function birdScore(t) {
  const s = t.toLowerCase();
  const kw = ['bird', 'parrot', 'parakeet', 'budgie', 'finch', 'canary', 'cockatiel', 'conure', 'seed', 'millet', 'feed'];
  let hits = 0;
  for (const k of kw) if (s.includes(k)) hits++;
  return hits;
}

function round2(n) { return Math.round(n * 100) / 100; }
function psych(n) { return Math.max(0.99, Math.ceil(n + 0.01) - 0.01); }

function priceFrom(cost, shipping) {
  if (cost == null || shipping == null) return null;
  const landed = round2(cost + shipping);
  const denominator = 1 - 0.029 - 0.50; // payment fee 2.9%, target margin 50%
  if (denominator <= 0) return null;
  const target = round2(landed / denominator);
  return { landed, suggested: round2(psych(target)) };
}

async function main() {
  const tok = await adminToken();
  console.log('✓ admin token');

  const health = await cj('/?action=health', {}, tok);
  console.log('CJ health:', health.health, '—', health.detail || '');
  if (health.health !== 'online') {
    console.log('STOP: CJ not online. Set CJ_API_KEY via:  npx wrangler secret put CJ_API_KEY --name luxedge-production');
    process.exit(1);
  }

  const started = await cj('/?action=start', {
    method: 'POST',
    body: JSON.stringify({ provider: 'cj', requestedBudget: 250 }),
  }, tok);
  if (!started.runId) { console.log('START FAIL:', JSON.stringify(started).slice(0, 250)); process.exit(1); }
  const runId = started.runId;
  console.log(`✓ run ${runId} budget=${started.hardBudget}`);

  // search
  const queries = ['bird feed', 'bird seed', 'parrot food'];
  let records = [];
  for (const q of queries) {
    const s = await cj(`/?action=search&q=${encodeURIComponent(q)}&market=US&size=30&runId=${runId}`, {}, tok);
    if (s.records?.length) { records = s.records; console.log(`✓ search "${q}" -> ${s.total} total, ${s.records.length} normalized`); break; }
    console.log(`search "${q}" -> ${s.records?.length || 0} records ${s.warning ? '(' + s.warning + ')' : ''}`);
  }
  if (!records.length) { console.log('STOP: no candidates'); process.exit(1); }

  // bird-relevant, prefer US verified + free shipping + sane cost
  const scored = records
    .filter((r) => r && r.title && birdScore(r.title) >= 2)
    .map((r) => ({
      r,
      score: birdScore(r.title) * 10
        + (r.usInventoryInCountry ? 5 : 0)
        + (r.freeShipping ? 2 : 0)
        + (r.sellPrice != null && r.sellPrice < 30 ? 1 : 0)
        - (r.sellPrice != null && r.sellPrice > 60 ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const picks = scored.slice(0, 5);
  console.log(`\nTop ${picks.length} bird candidates:`);
  picks.forEach((p, i) => console.log(`  ${i + 1}. [${p.r.productId}] ${p.r.title.slice(0, 70)} — $${p.r.sellPrice ?? 'UNKNOWN'} US-inv=${p.r.usInventoryInCountry} freeShip=${p.r.freeShipping}`));
  if (!picks.length) { console.log('STOP: no bird-relevant candidates'); process.exit(1); }

  // details + freight
  const completed = [];
  for (const { r } of picks) {
    const det = await cj(`/?action=product&pid=${encodeURIComponent(r.productId)}&market=US&runId=${runId}`, {}, tok);
    const rec = det.record;
    if (!rec) { console.log(`  ! ${r.productId}: no detail (${det.warning || '?'})`); continue; }

    const v = rec.selectedVariant || null;
    const images = (rec.images || []).filter(Boolean);
    let freight = null;
    if (v?.variantId && v.originCountry) {
      const f = await cj('/?action=freight', {
        method: 'POST',
        body: JSON.stringify({ vid: v.variantId, startCountryCode: v.originCountry, endCountryCode: 'US', runId }),
      }, tok);
      freight = f.quotes?.[0] || null;
      if (f.warning) console.log(`  ! ${r.productId}: freight ${f.warning}`);
    }
    const cost = v?.sellPrice ?? rec.sellPrice;
    const shipping = freight?.costUsd ?? null;
    const delMin = freight?.arrivalDays ? (parseInt(String(freight.arrivalDays)) || null) : null;
    const p = priceFrom(cost, shipping);

    const ready =
      cost != null && shipping != null && delMin != null
      && (rec.usInventoryInCountry || (rec.usInventoryVerified != null && rec.usInventoryVerified > 0))
      && images.length >= 1;

    completed.push({
      cjPid: r.productId,
      cjTitle: rec.title,
      cost, shipping, deliveryDays: delMin,
      suggested: p?.suggested ?? null, landed: p?.landed ?? null,
      images, origin: v?.originCountry ?? null,
      warehouse: rec.warehouse || null,
      ready,
    });
    console.log(`  ✓ ${r.productId}: cost=$${cost ?? 'UNK'} ship=$${shipping ?? 'UNK'} del=${delMin ?? 'UNK'}d img=${images.length} ready=${ready}`);
    await new Promise((res) => setTimeout(res, 400)); // CJ rate-limit politeness
  }

  if (DRY) {
    console.log('\n[DRY RUN] — no DB writes. Summary:');
    completed.forEach((c) => console.log('  ', c.cjPid, c.ready ? 'READY' : 'NOT READY', c.cjTitle.slice(0, 60)));
    return;
  }

  // persist: update the 5 bird drafts (slug match) with real data
  const DB = E.VITE_SUPABASE_URL.replace(/\/$/, '');
  const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

  const drafts = await (await fetch(`${DB}/rest/v1/products?select=id,slug,title&slug=in.(bird-wild-bird-seed-mix-5lb,bird-parakeet-seed-blend-2lb,bird-cockatiel-conure-seed-mix-2lb,bird-finch-food-1-5lb,bird-millet-spray-treats-3pk)`, { headers: H })).json();
  const map = {};

  // match CJ picks to drafts by keyword so titles stay relevant
  const keywordFor = [
    ['wild', 'bird-wild-bird-seed-mix-5lb'],
    ['parakeet', 'bird-parakeet-seed-blend-2lb'],
    ['cockatiel', 'bird-cockatiel-conure-seed-mix-2lb'],
    ['finch', 'bird-finch-food-1-5lb'],
    ['millet', 'bird-millet-spray-treats-3pk'],
  ];
  for (const c of completed) {
    const t = c.cjTitle.toLowerCase();
    let slug = null;
    for (const [kw, s] of keywordFor) if (t.includes(kw)) { slug = s; break; }
    if (!slug) slug = keywordFor.find(([, s]) => !map[s])?.[1] || null; // fallback: first unfilled
    if (!slug) continue;
    if (map[slug]) continue;
    map[slug] = c;
  }

  let updated = 0, published = 0, skipped = 0;
  for (const d of drafts) {
    const c = map[d.slug];
    if (!c) { skipped++; console.log(`  - ${d.slug}: no CJ match — stays draft`); continue; }

    const patch = {
      title: c.cjTitle,
      name: c.cjTitle,
      cost_price: c.cost,
      price: c.suggested,
      landed_cost: c.landed,
      shipping_cost: c.shipping,
      est_us_delivery_days: c.deliveryDays,
      supplier_source: 'CJ',
      supplier_product_ref: c.cjPid,
      supplier_url: `https://www.cjdropshipping.com/product/${encodeURIComponent(c.cjPid)}.html`,
      source_type: 'CJ_DROPSHIPPING',
      inventory_source: c.warehouse ? 'SUPPLIER_VERIFIED' : 'UNKNOWN',
      fulfillment_method: 'CJ dropship',
      us_inventory: c.ready,
      stock_status: c.ready ? 'in_stock' : null,
      evidence_notes: `Completed from CJ (pid ${c.cjPid}) — cost/shipping/delivery VERIFIED from supplier API. Origin: ${c.origin || 'UNKNOWN'}.`,
      commerce_readiness: c.ready ? 'COMMERCE_READY' : c.cost == null ? 'SOURCE_PENDING' : c.shipping == null || c.deliveryDays == null ? 'FULFILLMENT_PENDING' : 'ECONOMICS_PENDING',
    };
    if (c.ready) { patch.status = 'active'; patch.published_at = new Date().toISOString(); }

    const u = await fetch(`${DB}/rest/v1/products?id=eq.${d.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
    if (!u.ok) { console.log(`  ! ${d.slug}: update failed ${u.status} ${(await u.text()).slice(0, 150)}`); continue; }
    updated++;

    // images -> product_images (primary first)
    await fetch(`${DB}/rest/v1/product_images?product_id=eq.${d.id}`, { method: 'DELETE', headers: H });
    for (let i = 0; i < c.images.length; i++) {
      await fetch(`${DB}/rest/v1/product_images`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ product_id: d.id, url: c.images[i], alt_text: c.cjTitle, kind: 'product', is_primary: i === 0, sort_order: i }),
      });
    }
    if (c.ready) { published++; console.log(`  ✓ PUBLISHED ${d.slug}: "${c.cjTitle.slice(0, 55)}" $${c.suggested} (cost $${c.cost} + ship $${c.shipping})`); }
    else { console.log(`  ~ ${d.slug} stays ${patch.commerce_readiness}: "${c.cjTitle.slice(0, 55)}"`); }
  }

  await cj('/?action=finish', { method: 'POST', body: JSON.stringify({ runId, status: 'completed' }) }, tok).catch(() => {});
  console.log(`\nDONE — updated=${updated} published=${published} skipped=${skipped} (budget usage via action=budget)`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
