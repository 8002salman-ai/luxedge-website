// LUXEDGE — KONG catalog expansion from verified official manufacturer pages.
// Free legitimate sourcing (0 CJ points). Every product has real manufacturer
// JSON-LD: name, SKU, price, availability, official CDN images.
// Price = manufacturer's own retail reference price. Wholesale cost UNKNOWN —
// recorded honestly (same convention as the owner-approved KONG Classic).
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

const prods = await rest('products', '?select=id,sku&limit=500');
const haveSku = new Set(prods.map(p => String(p.sku || '')));
const cats = await rest('categories', '?select=id,name,slug');
const catId = new Map(cats.map(c => [c.name, c.id]));
const CAT_IDS = {
  'Pet Toys': catId.get('Pet Toys'), 'Grooming': catId.get('Grooming'),
  'Pet Accessories': catId.get('Pet Accessories'), 'Dog Supplies': catId.get('Dog Supplies'),
  'Cat Supplies': catId.get('Cat Supplies'), 'Pet Beds': catId.get('Pet Beds'),
  'Feeding & Water': catId.get('Feeding & Water'),
};

const kongProducts = JSON.parse(fs.readFileSync(path.join(__dirname, 'kong-products.json'), 'utf8'));
const galleries = JSON.parse(fs.readFileSync(path.join(__dirname, 'kong-galleries.json'), 'utf8'));

// Curated selection — distinct products only, no near-duplicate color variants,
// no food/treat/consumables. slug -> { catName, species, retailTitle }
const SELECT = {
  'kong-extreme': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Extreme — Ultra-Durable Natural Rubber Dog Toy' },
  'kong-goodie-bone': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Goodie Bone — Stuffable Chew Toy for Dogs' },
  'kong-extreme-goodie-bone': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Extreme Goodie Bone — Tough Stuffable Chew Toy' },
  'kong-donut': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Donut — Natural Rubber Chew Toy for Dogs' },
  'wubba': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Wubba — Interactive Tug & Toss Dog Toy' },
  'squeakair-balls-3-pack': { cat: 'Pet Toys', sp: 'dog', title: 'KONG SqueakAir Balls, 3-Pack — Squeaky Fetch Balls' },
  'kong-extreme-ball-2hmr': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Extreme Ball — Bouncy Rubber Fetch Ball' },
  'kong-extreme-tires': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Extreme Tires — Durable Tire Chew Toy' },
  'squeezz-ball': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Squeezz Ball — Bouncy Squeaker Fetch Toy' },
  'squeezz-dental-stick': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Squeezz Dental Stick — Textured Chew Toy' },
  'wild-knots-bear': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Wild Knots Bear — Durable Plush Dog Toy' },
  'knots-frog-assorted': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Knots Frog — Rope-Skeleton Plush Dog Toy' },
  'scrunch-knots-squirrel': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Scrunch Knots Squirrel — No-Stuffing Plush Toy' },
  'jumbler-ball': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Jumbler Ball — Two-in-One Fetch Toy' },
  'licks': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Licks — Suction-Cup Licking Mat for Dogs' },
  'kong-tug': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Tug — Natural Rubber Tug Toy for Dogs' },
  'kong-puppy': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Puppy — Soft Rubber Teething Toy' },
  'kong-flyer': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Flyer — Soft Rubber Flying Disc for Dogs' },
  'kong-senior': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Senior — Gentle Rubber Dog Toy' },
  'kong-aqua': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Aqua — Floating Water Fetch Toy for Dogs' },
  'kong-classic-ball': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Classic Ball — Bouncy Natural Rubber Ball' },
  'kong-stuff-a-ball': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Stuff-A-Ball — Stuffable Treat Ball Toy' },
  'kong-ring': { cat: 'Pet Toys', sp: 'dog', title: 'KONG Ring — Natural Rubber Ring Chew Toy' },
  'kong-cleaning-brush': { cat: 'Grooming', sp: 'dog', title: 'KONG Cleaning Brush — Dog Grooming Glove Brush' },
  'zoomgroom-boysenberry': { cat: 'Grooming', sp: 'dog', title: 'KONG ZoomGroom — Dog Grooming Brush' },
  'kong-retractable-leash-terrain-black': { cat: 'Pet Accessories', sp: 'dog', title: 'KONG Retractable Leash Terrain, Black' },
  'kitty-kong': { cat: 'Pet Toys', sp: 'cat', title: 'Kitty KONG — Treat-Dispensing Cat Toy' },
  'kickeroo-swirl': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Kickeroo Swirl — Catnip Kicker Toy for Cats' },
  'cat-luvs-lizard': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Cat Luvs Lizard — Catnip Activity Toy' },
  'cat-luvs-mouse': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Cat Luvs Mouse — Catnip Activity Toy' },
  'cat-wubba-butterfly': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Cat Wubba Butterfly — Interactive Cat Toy' },
  'cat-active-bubble-ball': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Cat Active Bubble Ball — Rolling Cat Toy' },
  'cat-active-tennis-balls-w-bells': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Cat Active Tennis Balls with Bells, 2-Pack' },
  'naturals-scratcher-single': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Naturals Scratcher — Corrugated Cat Scratcher' },
  'teaser-curlz': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Teaser Curlz — Interactive Cat Teaser Wand' },
  'cat-zoomgroom': { cat: 'Grooming', sp: 'cat', title: 'KONG Cat ZoomGroom — Cat Grooming Brush' },
  'crackles-fluff-balls-2-pk-assorted': { cat: 'Pet Toys', sp: 'cat', title: 'KONG Crackles Fluff Balls, 2-Pack — Cat Toys' },
  'play-spaces-camper': { cat: 'Pet Toys', sp: 'cat', title: 'KONG PlaySpaces Camper — Cat Hideaway Play Tent' },
};

async function uniqueSlug(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
  let slug = base, n = 2;
  for (;;) { const dup = await rest('products', { q: `?select=id&slug=eq.${encodeURIComponent(slug)}` }); if (!dup.length) return slug; slug = `${base}-${n++}`; }
}

async function imgOk(url) {
  try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) }); return r.ok ? 'ok' : `HTTP ${r.status}`; }
  catch { return 'ERR'; }
}

function seoDescFor(title, sp) {
  const label = sp === 'cat' ? 'cats' : sp === 'dog' ? 'dogs' : 'pets';
  return `Shop ${title}. A genuine KONG product — premium ${label} essentials from the trusted KONG brand. Manufacturer-verified with official product imagery.`;
}

const report = { added: [], skipped: [], imageAudit: [] };
const VERIFIED_AT = new Date().toISOString().slice(0, 10);

for (const [slug, spec] of Object.entries(SELECT)) {
  const p = kongProducts.find(x => x.slug === slug);
  if (!p || !p.name || !p.price) { report.skipped.push(`${slug} — no JSON-LD`); continue; }
  const kongSku = String(p.sku || '').toUpperCase();
  const sku = kongSku ? `KONG-${kongSku}` : `KONG-${slug.toUpperCase().replace(/-/g, '')}`;
  if (haveSku.has(sku)) { report.skipped.push(`${sku} — already in catalog`); continue; }
  const g = galleries[slug] || { images: p.image ? [p.image] : [] };
  let images = (g.images || []).filter(Boolean);
  if (p.image && !images.includes(p.image)) images.unshift(p.image);
  images = [...new Set(images)].slice(0, 6);
  if (!images.length) { report.skipped.push(`${sku} — no images`); continue; }
  const hero = await imgOk(images[0]);
  report.imageAudit.push({ sku, hero, count: images.length });
  if (hero !== 'ok') { report.skipped.push(`${sku} — hero ${hero}`); continue; }

  const price = Math.round((Number(p.price) + 0.0001) * 100) / 100;
  const desc = (p.description || '').replace(/\s+/g, ' ').trim();
  const species = spec.sp;
  const petLabel = species === 'cat' ? 'cats' : 'dogs';
  const retailTitle = spec.title;

  const slugOut = await uniqueSlug(retailTitle);
  const pid = (await rest('products', { method: 'POST', body: {
    id: randomUUID(), slug: slugOut,
    name: retailTitle, title: retailTitle,
    short_title: retailTitle,
    short_description: `${retailTitle} — genuine KONG ${species === 'cat' ? 'cat' : 'dog'} product.`,
    description: desc ? `${desc}\n\nThis is a genuine KONG product, verified directly on the official KONG manufacturer page. Supervised use recommended; discontinue use if damaged.` : `A genuine KONG ${species === 'cat' ? 'cat' : 'dog'} product, verified on the official KONG manufacturer page.`,
    long_description: desc,
    price, compare_at_price: 0, compare_at_amount: 0,
    cost_price: null, landed_cost: null, gross_margin: null,
    currency: 'USD', sku, inventory_qty: 25,
    stock_status: 'in_stock', low_stock_threshold: 3,
    category_id: CAT_IDS[spec.cat], brand: 'KONG', status: 'active',
    seo_title: `${retailTitle} | Luxedge`,
    seo_description: seoDescFor(retailTitle, species),
    seo_keywords: ['kong', species, 'pet toy', 'dog toy', 'cat toy', 'luxedge'],
    tags: [species, spec.cat.toLowerCase().split(' ')[0], 'kong', 'verified'],
    featured: false, new_arrival: true,
    us_inventory: true,
    supplier_source: 'KONG Company (official manufacturer)',
    supplier_product_ref: kongSku,
    free_shipping: false,
    shipping_note: 'Manufacturer-direct product. Wholesale cost and freight NOT verified — Luxedge price reflects the manufacturer retail reference price. Verify wholesale terms before final publication.',
    product_source_evidence: {
      source: 'KONG Company official product page',
      source_url: `https://www.kongcompany.com/${slug}/`,
      verified_at: VERIFIED_AT,
      price: `Manufacturer retail reference $${price} (USD)`,
      availability: 'InStock per manufacturer JSON-LD',
      no_reviews: true,
      note: 'inventory_qty is Luxedge internal ledger, not a supplier-verified count',
    },
    evidence_notes: `Verified on official KONG manufacturer page (${VERIFIED_AT}): name, SKU ${kongSku}, price $${price}, availability InStock, official imagery. Wholesale cost UNKNOWN — margin not asserted. ${species === 'cat' ? 'Cat' : 'Dog'} product.`,
    image_url: images[0],
  } }))[0].id;

  for (let k = 0; k < images.length; k++) {
    await rest('product_images', { method: 'POST', body: {
      id: randomUUID(), product_id: pid, url: images[k],
      storage_path: `kong/${sku}/${k}-${path.basename(String(images[k]).split(/[?#]/)[0]).slice(0, 60)}`,
      public_url: images[k],
      alt_text: `${retailTitle} — ${k === 0 ? 'primary image' : `image ${k + 1}`}`,
      kind: 'product', is_primary: k === 0, sort_order: k,
      created_at: new Date().toISOString(),
    } });
  }
  report.added.push({ sku, title: retailTitle, price, species, cat: spec.cat, imgs: images.length });
  console.log(`+ ADDED ${sku} — ${retailTitle} ($${price}, ${species}, ${images.length} img)`);
}

console.log('\nREPORT:', JSON.stringify(report, null, 2));
