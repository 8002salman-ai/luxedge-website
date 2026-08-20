// ============================================================================
// LUXEDGE — CATALOG SEED (one-time, idempotent)
//
// Builds the launch catalog from REAL persisted data only:
//   1. CJ seed records (Phase 4F job b01c2362…, Phase 4K job d4e7e0e7…)
//      — supplier price, CJ product images (supplier-permitted for listing),
//        list-level US inventory, real SKU/pid. No invented facts.
//   2. KONG Classic — the one real, previously owner-approved product.
//
// SCHEMA-AWARE:
//   Probes the LIVE products columns and writes ONLY columns that exist.
//   * Pre-migration 0010: legacy columns only; status = 'draft' (0006 allows
//     'draft'; the storefront RLS only shows 'published', so drafts are
//     invisible — AUTO PUBLISH stays OFF). No coupons/settings.
//   * Post-0010: full merchandising columns; status = 'active' for the
//     curated set; WELCOME10 coupon + free-shipping rule created.
//
// Selection is deterministic and honest: compact pet items with real images
// + real price; bulky (ramps/cages/fences/tubs/crate-furniture), battery/
// electric, medical, and non-pet records are excluded. Never fills a quota
// with weak products — if the pool yields 23, the catalog is 23.
//
// SECURITY: service-role key from gitignored .env, server-side only.
// Never prints secrets. Zero CJ points (read-only seed jobs).
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL || !KEY) { console.error('ERROR: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env'); process.exit(1); }

const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(table, opts = {}) {
  const { method = 'GET', q = '', body } = opts;
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, {
    method,
    headers: HEAD,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${table} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Probe live schema: which columns exist on products? do coupons/settings exist?
async function probeSchema() {
  let cols = new Set();
  let hasCoupons = false;
  let hasSettings = false;
  try {
    const openApi = await fetch(`${URL}/rest/v1/`, { headers: { ...HEAD, Accept: 'application/openapi+json' } }).then((r) => r.json());
    const props = (openApi?.components?.schemas?.products || openApi?.definitions?.products || {}).properties || {};
    cols = new Set(Object.keys(props));
    hasCoupons = !!(openApi?.components?.schemas?.coupons || openApi?.definitions?.coupons);
    hasSettings = !!(openApi?.components?.schemas?.store_settings || openApi?.definitions?.store_settings);
  } catch { /* leave empty — will fall back to legacy-safe columns */ }
  return { cols, hasCoupons, hasSettings };
}

const CATS = [
  ['Pet Toys', 'pet-toys'],
  ['Dog Supplies', 'dog-supplies'],
  ['Cat Supplies', 'cat-supplies'],
  ['Pet Beds', 'pet-beds'],
  ['Feeding & Water', 'feeding-water'],
  ['Grooming', 'grooming'],
  ['Pet Accessories', 'pet-accessories'],
];

// --- 1. Load real seed records ---------------------------------------------------
async function loadSeeds() {
  const jobs = await rest('agent_jobs', {
    q: '?select=output&or=(id.eq.d4e7e0e7-df14-42ff-8c71-612dc784156b,id.eq.b01c2362-b4b1-4748-b808-2ebeb5d46162)',
  });
  const bySku = new Map();
  for (const j of jobs) {
    const out = j.output || {};
    for (const s of (Array.isArray(out.seeds) ? out.seeds : [])) {
      if (!s || typeof s !== 'object') continue;
      const sku = String(s.sku || s.productId || '');
      if (!sku) continue;
      bySku.set(sku, { ...(bySku.get(sku) || {}), ...s, sku });
    }
  }
  return [...bySku.values()];
}

// --- 2. Deterministic suitability --------------------------------------------------
const BULKY = /\b(ramp|stairs|cage|crate|kennel|fence|playpen|\bpen\b|stroller|trailer|tub|tower|furniture|scratch(ing)? post|tent|house)\b/i;
const BATTERY = /\b(led|electric|electronic|battery|gps|camera|automatic|smart|vacuum|motor|solar|charger)\b/i;
const MEDICAL = /\b(supplement|medicine|vitamin|oil|calming|anxiety|glucosamine|joint)\b/i;
const NONPET = /\b(beer|wine|halloween|inflatables|tablecloth|rust remover|grinding|sun hat|luggage|knapsack|cosmetic|bag women|women fashion|chicken|coop|dental gel|bottle opener)\b/i;
const CAT_WORDS = /\b(cat|kitten|feline)\b/i;
const DOG_WORDS = /\b(dog|puppy|canine)\b/i;

function petOf(s) {
  const t = `${s.title || ''} ${s.category || ''}`;
  const isCat = CAT_WORDS.test(t) && !DOG_WORDS.test(t);
  const isDog = DOG_WORDS.test(t) && !CAT_WORDS.test(t);
  if (isCat) return 'cat';
  if (isDog) return 'dog';
  return 'both';
}

function typeCategory(title, pet) {
  const t = title.toLowerCase();
  if (/\b(toy|ball|teaser|feather|plush|rope|chew|tug|snuffle|puzzle|wand|laser|kick|spring|frisbee|saucer|tunnel|disc)\b/.test(t)) return 'Pet Toys';
  if (/\b(groom|brush|comb|nail|clipper|claw|shed|shampoo|bath|hair|fur|deshed|trimmer|towel)\b/.test(t)) return 'Grooming';
  if (/\b(bowl|feeder|feeding|water|fountain|food|drinker|dispenser)\b/.test(t)) return 'Feeding & Water';
  if (/\b(bed|mat|sofa|pillow|blanket|sleep|nest|cave|donut|cot|pad)\b/.test(t)) return 'Pet Beds';
  if (/\b(leash|harness|collar|travel|car|bag|backpack|bottle|seat|walk|vest|carrier|pouch|bandana|boot|shoe|clothes|shirt|sweater|coat|necklace)\b/.test(t)) return 'Pet Accessories';
  return pet === 'cat' ? 'Cat Supplies' : pet === 'dog' ? 'Dog Supplies' : 'Pet Toys';
}

function cleanTitle(raw) {
  let t = String(raw || '')
    .replace(/\b(hot sale|new arrival|factory|wholesale|high quality|best seller|free shipping|direct supply|drop shipping|dropshipping|custom|special)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'Pet Essential';
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function luxedgePrice(cost) {
  const c = Number(cost);
  if (!(c > 0)) return 0;
  const markup = c <= 10 ? 2.8 : c <= 25 ? 2.5 : c <= 50 ? 2.0 : 1.6;
  const target = Math.max(c * 1.35, c * markup);
  const capped = Math.min(target, 199.99);
  return Math.max(4.99, Math.round(capped + 0.0001) - 0.01);
}

function descFor(seed, catName, pet) {
  const title = cleanTitle(seed.title);
  const petLabel = pet === 'cat' ? 'cats' : pet === 'dog' ? 'dogs' : 'pets';
  return `${title} — a practical ${catName.toLowerCase()} essential for everyday ${petLabel}.\n\nDesigned for everyday ${petLabel} use. This is a real supplier-verified product in the Luxedge catalog pipeline.\n\nShipping note: supplier inventory and freight are verified before final publication.`;
}

// --- 3. Selection -------------------------------------------------------------------
function buildCatalog(seeds) {
  const usable = seeds.filter((s) => {
    const title = String(s.title || '');
    const price = Number(s.sellPrice);
    if (!title || !(price > 0)) return false;
    const images = Array.isArray(s.images) && s.images.length ? s.images : s.imageUrl ? [s.imageUrl] : [];
    if (!images.length) return false;
    if (BULKY.test(title)) return false;
    if (BATTERY.test(title)) return false;
    if (MEDICAL.test(title)) return false;
    if (NONPET.test(title)) return false;
    if (!/pet|dog|cat|puppy|kitten/i.test(title)) return false;
    return true;
  });
  usable.sort((a, b) =>
    (Number(b.usInventoryTotal || 0) - Number(a.usInventoryTotal || 0)) ||
    (Number(a.sellPrice) - Number(b.sellPrice)));
  // Interleave dog/cat, stop at 40. 'both'-pet products go to the dog side
  // only (never double-picked).
  const dogs = usable.filter((s) => petOf(s) === 'dog' || petOf(s) === 'both');
  const cats = usable.filter((s) => petOf(s) === 'cat');
  const pick = [];
  const used = new Set();
  let di = 0, ci = 0;
  while (pick.length < 40 && (di < dogs.length || ci < cats.length)) {
    let cand = null;
    if (pick.length % 2 === 0 && di < dogs.length) cand = dogs[di++];
    else if (ci < cats.length) cand = cats[ci++];
    else if (di < dogs.length) cand = dogs[di++];
    if (!cand) break;
    const key = String(cand.sku || cand.productId || '');
    if (used.has(key)) continue;
    used.add(key);
    pick.push(cand);
  }
  return pick;
}

// --- 4. Seed -------------------------------------------------------------------------
async function ensureCategories() {
  const existing = await rest('categories', { q: '?select=id,slug' });
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const ids = {};
  for (let i = 0; i < CATS.length; i++) {
    const [name, slug] = CATS[i];
    if (bySlug.has(slug)) { ids[name] = bySlug.get(slug).id; continue; }
    const inserted = await rest('categories', { method: 'POST', body: { name, slug, sort_order: i, is_active: true } });
    ids[name] = inserted[0].id;
    console.log(`  + category ${name}`);
  }
  return ids;
}

async function uniqueSlug(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
  let slug = base, n = 2;
  for (;;) {
    const dup = await rest('products', { q: `?select=id&slug=eq.${encodeURIComponent(slug)}` });
    if (!dup.length) return slug;
    slug = `${base}-${n++}`;
  }
}

let created = 0, skipped = 0, activated = 0;

async function seedProduct(s, catIds, cols, full) {
  const ref = String(s.sku || s.productId || '');
  const dup = await rest('products', { q: `?select=id&sku=eq.${encodeURIComponent(ref)}` }).catch(() => []);
  if (dup.length) { skipped += 1; return; }

  const title = cleanTitle(s.title);
  const catName = typeCategory(title, petOf(s));
  const cost = Number(s.sellPrice);
  const price = luxedgePrice(cost);
  const usQty = Math.max(0, Number(s.usInventoryTotal || 0));
  const pet = petOf(s);
  const images = [...new Set([...(Array.isArray(s.images) ? s.images : []), s.imageUrl].filter(Boolean))].slice(0, 6);

  const bulky = /bed|sofa|mat|blanket/i.test(title) && cost > 40; // large beds: draft until fulfillment verified
  const status = full && !bulky ? 'active' : 'draft';

  const row = {};
  // Legacy-safe core columns (present in 0001/0004 live schema)
  const core = {
    name: title,
    title,
    short_description: `${title} — a ${catName.toLowerCase()} essential for ${pet === 'cat' ? 'cats' : pet === 'dog' ? 'dogs' : 'pets'}.`,
    description: descFor(s, catName, pet),
    price,
    compare_at_price: 0,
    cost_price: cost,
    currency: 'USD',
    sku: ref,
    inventory_qty: usQty,
    category_id: catIds[catName],
    brand: 'Luxedge',
    status,
    seo_title: `${title} | Luxedge`,
    seo_description: `Shop ${title} — a ${catName.toLowerCase()} essential for ${pet === 'cat' ? 'cats' : pet === 'dog' ? 'dogs' : 'pets'}.`,
    seo_keywords: [pet === 'cat' ? 'cat' : pet === 'dog' ? 'dog' : 'pet', catName.toLowerCase(), 'luxedge'],
    product_source_evidence: { provider: 'cj', sourceUrl: s.sourceUrl || null, pid: s.productId || null, observedAt: s.observedAt || null, listedNum: s.listedNum ?? null, verification: 'list-level (no freight/delivery verified)' },
  };
  for (const [k, v] of Object.entries(core)) if (cols.has(k)) row[k] = v;

  if (full) {
    const merch = {
      tags: [pet, catName.toLowerCase().split(' ')[0], 'catalog'],
      featured: false,
      new_arrival: false,
      free_shipping: false,
      delivery_min_days: null,
      delivery_max_days: null,
      shipping_note: `Ships from CJ; ${usQty > 0 ? `${usQty} units US inventory verified (list-level)` : 'US inventory not confirmed at list level'}. Freight + delivery timeline to be confirmed before final publication.`,
      us_inventory: usQty > 0,
      supplier_source: 'CJ',
      supplier_product_ref: ref,
      stock_status: usQty > 0 ? 'in_stock' : 'out_of_stock',
      evidence_notes: 'Seeded from a real CJ listV2 record (Phase 4F/4K). Supplier price + US inventory are list-level; freight/landed cost and delivery timeline UNKNOWN — verify before final publication.',
    };
    for (const [k, v] of Object.entries(merch)) if (cols.has(k)) row[k] = v;
  }

  try {
    const slug = await uniqueSlug(title);
    const pid = (await rest('products', { method: 'POST', body: { id: randomUUID(), slug, ...row } }))[0].id;
    for (let k = 0; k < images.length; k++) {
      await rest('product_images', {
        method: 'POST',
        body: {
          id: randomUUID(), product_id: pid, url: images[k],
          // Live legacy table requires storage_path + public_url (NOT NULL) and
          // storage_path is UNIQUE. We do not use Supabase Storage for
          // CJ-sourced images: public_url carries the real supplier image URL;
          // storage_path is a synthetic per-product path (unique, honest,
          // identifies the source) so rows satisfy the constraint.
          storage_path: `cj/${ref}/${k}-${path.basename(String(images[k]).split(/[?#]/)[0])}`,
          public_url: images[k],
          alt_text: `${title} — ${k === 0 ? 'primary image' : `image ${k + 1}`}`,
          kind: 'product', is_primary: k === 0, sort_order: k,
          created_at: new Date().toISOString(),
        },
      });
    }
    if (Array.isArray(s.variants) && s.variants.length > 0) {
      for (const v of s.variants.slice(0, 12)) {
        await rest('product_variants', {
          method: 'POST',
          body: {
            id: randomUUID(), product_id: pid,
            attributes: (v && typeof v === 'object' && v.attributes) || {},
            sku: (v && v.sku) || null,
            price: (v && v.price) != null ? Number(v.price) : price,
            inventory_qty: (v && v.qty) != null ? Number(v.qty) : 0,
          },
        });
      }
    }
    created += 1;
    if (row.status === 'active') activated += 1;
    console.log(`  ✓ ${row.status.padEnd(7)} $${price.toFixed(2)} · ${title} · ${catName} · ${images.length} img · US ${usQty}`);
  } catch (e) {
    console.log(`  ✗ SKIPPED ${title}: ${String(e).slice(0, 170)}`);
  }
}

async function main() {
  console.log('Loading real CJ seed records…');
  const seeds = await loadSeeds();
  console.log(`  ${seeds.length} unique records (deduped by sku)`);
  const catalog = buildCatalog(seeds);
  console.log(`Selected ${catalog.length} compact pet products (bulky/battery/medical/non-pet excluded)`);
  const catIds = await ensureCategories();

  const { cols, hasCoupons, hasSettings } = await probeSchema();
  const full = cols.has('featured') && cols.has('tags') && hasCoupons && hasSettings;
  console.log(full
    ? '  → migration 0010 APPLIED (full fidelity: merchandising, coupons, settings, ACTIVE)'
    : '  → migration 0010 NOT applied — legacy columns only; products seeded as DRAFT (storefront-invisible); no coupons/settings');

  for (const s of catalog) await seedProduct(s, catIds, cols, full);

  // KONG Classic — the one real, previously owner-approved product (Phase 3B).
  try {
    const kong = await rest('products', { q: '?select=id,status&slug=eq.kong-classic-dog-toy' });
    if (kong.length) {
      if (full) {
        await rest('products', { method: 'PATCH', q: `?id=eq.${kong[0].id}`, body: { status: 'active' } });
        console.log('  ✓ activated KONG Classic (real owner-approved product)');
        activated += 1;
      } else {
        console.log('  · KONG Classic stays DRAFT until migration 0010 is applied (activation requires status=active)');
      }
    }
  } catch (e) { console.log('  ✗ KONG Classic: ' + String(e).slice(0, 170)); }

  if (full) {
    try {
      const existingCoupon = await rest('coupons', { q: '?select=id&code=eq.WELCOME10' });
      if (!existingCoupon.length) {
        await rest('coupons', { method: 'POST', body: { id: randomUUID(), code: 'WELCOME10', description: '10% off your first order', discount_type: 'percent', discount_value: 10, min_cart_value: 0, eligible_product_ids: [], eligible_category_ids: [], usage_limit: null, used_count: 0, is_active: true } });
        console.log('  ✓ coupon WELCOME10 created (editable in Admin → Promotions)');
      }
      const fsRow = await rest('store_settings', { q: '?select=key&key=eq.free_shipping' });
      if (!fsRow.length) {
        await rest('store_settings', { method: 'POST', body: { id: 'free_shipping', key: 'free_shipping', value: { freeShippingEnabled: true, freeShippingThreshold: 50 } } });
        console.log('  ✓ free-shipping rule saved (threshold $50, editable in Admin → Promotions)');
      }
    } catch (e) {
      console.log('  ✗ promotions: ' + String(e).slice(0, 170));
    }
  }

  console.log('\n=== SEED SUMMARY ===');
  console.log(`created: ${created} · skipped (already present): ${skipped} · ACTIVE: ${activated} · migration 0010: ${full ? 'APPLIED' : 'PENDING'}`);
  if (!full) {
    console.log('NEXT: apply supabase/migrations/0010_catalog_management.sql in the Supabase SQL editor,');
    console.log('then activate products in Admin → Products (or re-run this script after applying).');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('SEED FAILED:', String(e)); process.exit(1); });
