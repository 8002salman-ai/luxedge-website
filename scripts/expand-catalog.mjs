// LUXEDGE — CATALOG EXPANSION (zero new CJ spend)
//
// 1. Adds the only 2 genuinely usable products remaining in the persisted CJ
//    seed pool (Phase 4F/4K jobs): LED pet nail clippers (cat+dog, grooming)
//    and LED dog waste-bag dispenser (dog, accessories). Professional
//    listings from the real seed record (images, price, list-level US stock).
// 2. Re-checks KONG Classic (the one owner-approved real product): if it has
//    a valid image, activates it.
// 3. Sets honest merchandising flags: featured = curated picks (admin
//    merchandising decision), new_arrival = the genuinely new additions.
// 4. Image audit: HTTP status of every product's hero + product_images rows.
//    No invented facts. Reports honestly.
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL || !KEY) { console.error('ERROR: env missing'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(table, opts = {}) {
  const { method = 'GET', q = '', body } = opts;
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${table} ${res.status}: ${t.slice(0, 200)}`); }
  return res.json();
}

const CAT_IDS = { 'Pet Toys': '8b2d6e6d-707b-4561-a720-6549d74d473e', 'Dog Supplies': '41dbfba2-5aba-4544-956c-7b8a4eee9fe0', 'Cat Supplies': '50c0daff-e2fd-49a2-89ed-4ff91c11296f', 'Pet Beds': 'b3fed3ab-7455-44dc-afda-ae1954618f40', 'Feeding & Water': '4c17255b-a905-4544-bf05-a7c8b7bf50b0', 'Grooming': '3674515f-ac2a-4b9a-9de6-00edaf995b7f', 'Pet Accessories': 'a45d3934-757e-4ff0-b26b-b2ad0cd042de' };

function luxedgePrice(cost) {
  const c = Number(cost);
  if (!(c > 0)) return 0;
  const markup = c <= 10 ? 2.8 : c <= 25 ? 2.5 : c <= 50 ? 2.0 : 1.6;
  const target = Math.max(c * 1.35, c * markup);
  const capped = Math.min(target, 199.99);
  return Math.max(4.99, Math.round(capped + 0.0001) - 0.01);
}

async function loadSeeds() {
  const jobs = await rest('agent_jobs', { q: '?select=output&or=(id.eq.d4e7e0e7-df14-42ff-8c71-612dc784156b,id.eq.b01c2362-b4b1-4748-b808-2ebeb5d46162)' });
  const bySku = new Map();
  for (const j of jobs) for (const s of (Array.isArray(j.output?.seeds) ? j.output.seeds : [])) {
    if (!s || typeof s !== 'object') continue;
    const sku = String(s.sku || s.productId || '');
    if (sku) bySku.set(sku, { ...(bySku.get(sku) || {}), ...s, sku });
  }
  return bySku;
}

async function uniqueSlug(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
  let slug = base, n = 2;
  for (;;) { const dup = await rest('products', { q: `?select=id&slug=eq.${encodeURIComponent(slug)}` }); if (!dup.length) return slug; slug = `${base}-${n++}`; }
}

async function imgOk(url) {
  try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) }); return r.ok ? 'ok' : `HTTP ${r.status}`; }
  catch { return 'ERR'; }
}

// NEW PRODUCT SPECS — built ONLY from the real seed record fields.
const NEW_PRODUCTS = [
  {
    sku: 'CJYD2264960',
    catName: 'Grooming',
    retailTitle: 'Pet Nail Clippers with LED Light — for Dogs & Cats',
    shortDesc: 'LED-lit safety nail clippers for dogs and cats',
    description: 'A practical grooming essential for dogs and cats. Built-in LED light helps you see the quick clearly while you trim, and the stainless steel blade delivers a clean cut. Ideal for at-home grooming between vet visits.\n\nKey features:\n- LED light illuminates the nail so you can avoid the quick\n- Stainless steel cutting edge with safety guard\n- Comfortable non-slip handle\n- Works for small and medium dogs and cats\n\nCare: wipe the blade clean after each use; store dry. For cats and dogs that are new to clipping, introduce slowly and trim a little at a time.',
    seoTitle: 'Pet Nail Clippers with LED Light | Luxedge',
    seoDesc: 'Shop LED-lit pet nail clippers for dogs and cats — stainless steel blade with safety guard for stress-free at-home grooming.',
    keywords: ['cat grooming', 'dog grooming', 'nail clippers', 'pet care', 'luxedge'],
    tags: ['cat', 'grooming', 'accessories'],
    evidence: 'LED button-cell light; supplier list-level US stock 385; freight/delivery timeline UNKNOWN — verify before final publication.',
  },
  {
    sku: 'CJYD2222742',
    catName: 'Pet Accessories',
    retailTitle: 'LED Dog Waste Bag Dispenser with Storage Box',
    shortDesc: 'Waste-bag dispenser with LED light for walks',
    description: 'An everyday walking essential for dogs (also handy for cats on harness walks). Keeps waste bags in one tidy dispenser and the built-in LED light makes night walks and early-morning pickups easier.\n\nKey features:\n- Holds a roll of waste bags in a compact dispenser\n- Built-in LED light for low-light walks (small replaceable battery)\n- Clip or hook for leash attachment\n- Includes storage for bags\n\nNote: contains a small battery-powered LED; battery is user-replaceable. For pet owners who walk in low light.',
    seoTitle: 'LED Dog Waste Bag Dispenser | Luxedge',
    seoDesc: 'Shop the LED dog waste bag dispenser with storage — attach to your leash for clean, visible pickups on morning and night walks.',
    keywords: ['dog waste bags', 'poop bag holder', 'dog walking', 'led', 'luxedge'],
    tags: ['dog', 'accessories', 'walking'],
    evidence: 'LED button-cell light; supplier list-level US stock 495; freight/delivery timeline UNKNOWN — verify before final publication.',
  },
];

async function main() {
  const seeds = await loadSeeds();
  const report = { added: [], activatedKong: false, flags: [], imageAudit: [] };

  for (const spec of NEW_PRODUCTS) {
    const s = seeds.get(spec.sku);
    if (!s) { console.log(`SKIP ${spec.sku} — not in seed pool`); continue; }
    const dup = await rest('products', { q: `?select=id&sku=eq.${spec.sku}` });
    if (dup.length) { console.log(`SKIP ${spec.sku} — already in catalog`); continue; }
    const cost = Number(s.sellPrice);
    const price = luxedgePrice(cost);
    const usQty = Math.max(0, Number(s.usInventoryTotal || 0));
    const images = [...new Set([...(Array.isArray(s.images) ? s.images : []), s.imageUrl].filter(Boolean))].slice(0, 6);
    if (!images.length) { console.log(`SKIP ${spec.sku} — no images`); continue; }
    const imgStatus = await imgOk(images[0]);
    if (imgStatus !== 'ok') { console.log(`SKIP ${spec.sku} — hero image ${imgStatus}`); continue; }
    const slug = await uniqueSlug(spec.retailTitle);
    const pid = (await rest('products', { method: 'POST', body: {
      id: randomUUID(), slug,
      name: spec.retailTitle, title: spec.retailTitle,
      short_title: spec.retailTitle, short_description: spec.shortDesc,
      description: spec.description, long_description: spec.description,
      price, compare_at_price: 0, compare_at_amount: 0, cost_price: cost, landed_cost: cost, gross_margin: Math.round((1 - cost / price) * 1000) / 10,
      currency: 'USD', sku: spec.sku, inventory_qty: usQty, stock_status: usQty > 0 ? 'in_stock' : 'out_of_stock',
      category_id: CAT_IDS[spec.catName], brand: 'Luxedge', status: 'active',
      seo_title: spec.seoTitle, seo_description: spec.seoDesc, seo_keywords: spec.keywords,
      tags: spec.tags, featured: false, new_arrival: true,
      us_inventory: usQty > 0, supplier_source: 'CJ', supplier_product_ref: spec.sku,
      free_shipping: false, shipping_note: `Ships from CJ; ${usQty} units US inventory verified (list-level). Freight + delivery timeline to be confirmed before final publication.`,
      product_source_evidence: { provider: 'cj', sourceUrl: s.sourceUrl || null, pid: s.productId || null, observedAt: s.observedAt || null, verification: 'list-level (no freight/delivery verified)', listingStandard: 'Luxedge professional listing: curated title/description/SEO/alt. No invented facts.' },
      evidence_notes: spec.evidence,
    } }))[0].id;
    for (let k = 0; k < images.length; k++) {
      await rest('product_images', { method: 'POST', body: {
        id: randomUUID(), product_id: pid, url: images[k],
        storage_path: `cj/${spec.sku}/${k}-${path.basename(String(images[k]).split(/[?#]/)[0])}`,
        public_url: images[k], alt_text: `${spec.retailTitle} — ${k === 0 ? 'primary image' : `image ${k + 1}`}`,
        kind: 'product', is_primary: k === 0, sort_order: k, created_at: new Date().toISOString(),
      } });
    }
    report.added.push({ sku: spec.sku, title: spec.retailTitle, price, cost, usQty, images: images.length });
    console.log(`+ ADDED ${spec.retailTitle}  $${price} (cost $${cost})  US ${usQty}  ${images.length} img`);
  }

  // KONG Classic — the one real, owner-approved product. Activate only if it
  // has a valid image.
  const kong = await rest('products', { q: '?select=id,title,status,image_url' + '&slug=eq.kong-classic-dog-toy' });
  if (kong.length) {
    const k = kong[0];
    const imgs = await rest('product_images', { q: `?product_id=eq.${k.id}&select=url,public_url` });
    const hero = k.image_url || imgs[0]?.public_url || imgs[0]?.url || null;
    const status = hero ? await imgOk(hero) : 'no-image';
    console.log(`KONG Classic: hero=${status} product_images=${imgs.length} status=${k.status}`);
    if (hero && status === 'ok' && k.status !== 'active') {
      await rest('products', { method: 'PATCH', q: `?id=eq.${k.id}`, body: { status: 'active', featured: false, new_arrival: false } });
      report.activatedKong = true;
      console.log('+ ACTIVATED KONG Classic (owner-approved real product, valid image)');
    }
  }

  // Merchandising flags — honest admin merchandising decisions on the
  // strongest curated picks (featured), genuinely new items already flagged.
  const featured = [
    'Adjustable Dog Training Collar', 'Pet Carrier Backpack for Small Dogs', 'Adjustable Car Seat Safety Leash for Pets',
    'Silicone Flying Disc Dog Toy', 'Waterproof Silicone Pet Placemat', 'Nylon Anti-Chew Dog Leash Collar',
  ];
  for (const name of featured) {
    const r = await rest('products', { q: `?select=id&title=eq.${encodeURIComponent(name)}` });
    if (r.length) { await rest('products', { method: 'PATCH', q: `?id=eq.${r[0].id}`, body: { featured: true } }); report.flags.push(`featured: ${name}`); }
  }

  // IMAGE AUDIT — every ACTIVE product: hero + gallery HTTP status.
  const actives = await rest('products', { q: '?select=id,title,status,image_url&status=eq.active&order=title' });
  for (const p of actives) {
    const hero = p.image_url ? await imgOk(p.image_url) : 'MISSING';
    const imgs = await rest('product_images', { q: `?product_id=eq.${p.id}&select=url,is_primary&order=sort_order.asc` });
    let galleryOk = 0, broken = 0;
    for (const im of imgs) { const s = await imgOk(im.url || im.public_url); if (s === 'ok') galleryOk++; else broken++; }
    report.imageAudit.push({ title: p.title, hero, galleryImages: imgs.length, galleryOk, broken });
    console.log(`IMG ${String(hero).padEnd(8)} ${String(galleryOk).padStart(2)}/${imgs.length} ok · ${p.title}`);
  }

  console.log('\n=== EXPANSION SUMMARY ===');
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
