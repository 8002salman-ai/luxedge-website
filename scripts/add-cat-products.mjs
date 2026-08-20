// LUXEDGE — CAT CATALOG EXPANSION from the authorized ONE CJ seed run
// (job 00c8387f, run b24adb64, 50 pts, ONE listV2, detail=0 freight=0).
//
// Adds ONLY genuinely usable CAT/BOTH products from the returned pool:
// compact, non-battery, low-risk, clear pet utility, real CJ list-level
// evidence. Weak/bulky/battery/novelty records stay out (or DRAFT).
// Professional Luxedge listings; no invented facts.
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

async function loadSeeds(jobId) {
  const jobs = await rest('agent_jobs', { q: `?select=output&id=eq.${jobId}` });
  const out = typeof jobs[0]?.output === 'string' ? JSON.parse(jobs[0].output) : (jobs[0]?.output || {});
  return Array.isArray(out.seeds) ? out.seeds : [];
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

// ---------------------------------------------------------------------------
// NEW PRODUCT SPECS — built ONLY from real CJ listV2 seed fields. Evidence
// labels: list-level US inventory (VERIFIED as returned by CJ listV2, but it
// is inventory NOT delivery), freight/delivery UNKNOWN (no detail/freight
// calls were made this phase by owner rule).
// ---------------------------------------------------------------------------
const NEW_PRODUCTS = [
  {
    sku: 'CJYD2060792',
    catName: 'Cat Supplies',
    retailTitle: 'Sisal Cat Scratch Board — Wall or Floor Scratch Pad',
    shortDesc: 'Crumb-free sisal scratch board for cats',
    description: 'A durable sisal scratch board that gives your cat a satisfying place to scratch while helping protect furniture. The tight sisal weave is designed not to shed crumbs as your cat works at it.\\n\\nKey features:\\n- Natural sisal scratching surface\\n- Low-shed weave designed to stay tidy\\n- Compact and easy to place on the floor or mount against furniture\\n- Suitable for everyday claw care\\n\\nTip: place near your cat\'s favourite resting spot or beside furniture you want to protect.',
    seoTitle: 'Sisal Cat Scratch Board | Luxedge',
    seoDesc: 'Shop the sisal cat scratch board — a tidy, crumb-free scratching surface that helps protect furniture and supports natural claw care.',
    keywords: ['cat scratch board', 'sisal scratch pad', 'cat scratching', 'cat care', 'luxedge'],
    tags: ['cat', 'scratching', 'enrichment'],
    evidence: 'CJ list-level record (CJYD2060792). List-level US inventory 4 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical, no health claims.',
  },
  {
    sku: 'CJGY1105631',
    catName: 'Feeding & Water',
    retailTitle: 'Silicone Pet Feeding Mat — Waterproof & Easy-Clean',
    shortDesc: 'Waterproof silicone placemat for bowls',
    description: 'A waterproof silicone feeding mat that keeps floors and countertops clean around food and water bowls. Perfect for dogs and cats who are enthusiastic eaters or drinkers.\\n\\nKey features:\\n- Waterproof silicone surface\\n- Wipes clean quickly; no scrubbing needed\\n- Non-slip placement under bowls\\n- Lightweight and easy to roll up for storage\\n\\nCare: rinse or wipe with mild soap and water after meals.',
    seoTitle: 'Silicone Pet Feeding Mat | Luxedge',
    seoDesc: 'Shop the waterproof silicone pet feeding mat — an easy-clean, non-slip placemat for food and water bowls.',
    keywords: ['pet feeding mat', 'silicone placemat', 'cat feeding', 'dog feeding', 'luxedge'],
    tags: ['cat', 'dog', 'feeding', 'both'],
    evidence: 'CJ list-level record (CJGY1105631). List-level US inventory 5 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical.',
  },
  {
    sku: 'CJGY1157230',
    catName: 'Pet Toys',
    retailTitle: 'Silicone Flying Saucer Pet Toy — Chew-Resistant Fetch Disc',
    shortDesc: 'Soft silicone fetch disc for dogs and cats',
    description: 'A soft silicone flying saucer that is fun for fetch with dogs and pounce games with cats. Made from flexible silicone that is gentler on teeth and jaws than hard plastic discs.\\n\\nKey features:\\n- Soft, flexible silicone construction\\n- Bounces and glides for interactive play\\n- Easy to clean and dishwasher safe\\n- Lightweight for indoor and outdoor play\\n\\nSupervise play and replace if chewed through. Not a chew toy for aggressive chewers.',
    seoTitle: 'Silicone Flying Saucer Pet Toy | Luxedge',
    seoDesc: 'Shop the silicone flying saucer pet toy — a soft, chew-resistant fetch and play disc for dogs and cats.',
    keywords: ['pet flying disc', 'silicone pet toy', 'cat toy', 'dog fetch toy', 'luxedge'],
    tags: ['cat', 'dog', 'toys', 'both'],
    evidence: 'CJ list-level record (CJGY1157230). List-level US inventory 4 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical.',
  },
  {
    sku: 'CJJJCWGY00331',
    catName: 'Pet Beds',
    retailTitle: 'Soft Cat Blanket — Cozy Pet Throw',
    shortDesc: 'Soft, warm throw blanket for cats and small dogs',
    description: 'A soft, warm blanket that cats love to knead and curl up on. Great for beds, couches, and carriers — an easy way to add comfort anywhere your pet rests.\\n\\nKey features:\\n- Soft, plush fabric\\n- Generous size for cats and small dogs\\n- Machine washable\\n- Lightweight and portable for travel\\n\\nCare: machine wash cold and air dry or tumble dry low.',
    seoTitle: 'Soft Cat Blanket | Luxedge',
    seoDesc: 'Shop the soft cat blanket — a cozy, machine-washable throw for cats and small dogs at home or on the go.',
    keywords: ['cat blanket', 'pet throw blanket', 'cozy pet blanket', 'cat comfort', 'luxedge'],
    tags: ['cat', 'beds', 'comfort'],
    evidence: 'CJ list-level record (CJJJCWGY00331). List-level US inventory 4 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical.',
  },
  {
    sku: 'CJCF1104450',
    catName: 'Feeding & Water',
    retailTitle: 'Ceramic Cat Face Food Bowl — Easy-Clean Pet Dish',
    shortDesc: 'Ceramic pet bowl with a cat-face design',
    description: 'A sturdy ceramic food bowl with a playful cat-face design. The weighted ceramic base helps keep the bowl in place while your cat eats, and the smooth glaze wipes clean easily.\\n\\nKey features:\\n- Durable ceramic construction\\n- Smooth glazed surface for easy cleaning\\n- Stable base resists tipping\\n- Suitable for wet and dry food\\n\\nCare: hand wash recommended to protect the glaze. Avoid drops — ceramic can chip.',
    seoTitle: 'Ceramic Cat Food Bowl | Luxedge',
    seoDesc: 'Shop the ceramic cat-face food bowl — a stable, easy-clean dish for wet and dry food.',
    keywords: ['cat food bowl', 'ceramic pet bowl', 'cat feeding', 'pet dishes', 'luxedge'],
    tags: ['cat', 'feeding'],
    evidence: 'CJ list-level record (CJCF1104450). List-level US inventory 2 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical. Low US stock noted.',
  },
  {
    sku: 'CJJJCWMY00276',
    catName: 'Pet Beds',
    retailTitle: 'Cozy Cat Nest Bed — Round Plush Mat',
    shortDesc: 'Round plush nest mat for cats',
    description: 'A round, plush nest bed that gives cats a soft, sheltered spot to sleep. The raised rim provides a comforting sense of enclosure that many cats love.\\n\\nKey features:\\n- Soft plush surface\\n- Raised rim for a snug, secure feel\\n- Suitable for cats and small dogs\\n- Portable — place it in a quiet corner or a favourite sunny spot\\n\\nCare: spot clean or follow the label care instructions.',
    seoTitle: 'Cozy Cat Nest Bed | Luxedge',
    seoDesc: 'Shop the cozy round cat nest bed — a plush, rimmed sleeping mat for cats and small dogs.',
    keywords: ['cat nest bed', 'plush cat bed', 'cat bedding', 'pet sleep', 'luxedge'],
    tags: ['cat', 'beds', 'comfort'],
    evidence: 'CJ list-level record (CJJJCWMY00276). List-level US inventory 13 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical.',
  },
  {
    sku: 'CJJJCWGY00320',
    catName: 'Pet Beds',
    retailTitle: 'Cooling Pet Mat — Ice-Silk Cooling Pad for Cats & Dogs',
    shortDesc: 'Self-cooling ice-silk mat for warm days',
    description: 'An ice-silk cooling mat that helps pets stay comfortable on warm days. The fabric stays noticeably cool to the touch without water or electricity.\\n\\nKey features:\\n- Cooling ice-silk fabric\\n- No water, no electricity, no refrigeration needed\\n- Lightweight and portable\\n- Suitable for cats and small to medium dogs\\n\\nPlace it on a bed, sofa, or floor where your pet likes to rest. Spot clean as needed.',
    seoTitle: 'Cooling Pet Mat — Ice-Silk Pad | Luxedge',
    seoDesc: 'Shop the ice-silk cooling pet mat — a no-water, no-electricity cooling pad for cats and dogs on warm days.',
    keywords: ['cat cooling mat', 'dog cooling pad', 'ice silk pet mat', 'summer pet care', 'luxedge'],
    tags: ['cat', 'dog', 'beds', 'both'],
    evidence: 'CJ list-level record (CJJJCWGY00320). List-level US inventory 3 returned by CJ listV2 (inventory, not delivery). Freight/delivery UNKNOWN — no detail/freight calls this phase; verify before final publication. Non-battery, non-medical.',
  },
];

async function main() {
  const seeds = await loadSeeds('00c8387f-e030-4d8a-86a5-f114e0b6673d');
  const bySku = new Map();
  for (const s of seeds) if (s && typeof s === 'object') bySku.set(String(s.sku || ''), s);
  const report = { added: [], skipped: [], imageAudit: [] };

  for (const spec of NEW_PRODUCTS) {
    const s = bySku.get(spec.sku);
    if (!s) { report.skipped.push(`${spec.sku} — not in seed pool`); continue; }
    const dup = await rest('products', { q: `?select=id&sku=eq.${spec.sku}` });
    if (dup.length) { report.skipped.push(`${spec.sku} — already in catalog`); continue; }
    const cost = Number(s.sellPrice);
    const price = luxedgePrice(cost);
    const usQty = Math.max(0, Number(s.usInventoryTotal || 0));
    const images = [...new Set([...(Array.isArray(s.images) ? s.images : []), s.imageUrl].filter(Boolean))].slice(0, 6);
    if (!images.length) { report.skipped.push(`${spec.sku} — no images`); continue; }
    const imgStatus = await imgOk(images[0]);
    report.imageAudit.push({ sku: spec.sku, hero: imgStatus, count: images.length });
    if (imgStatus !== 'ok') { report.skipped.push(`${spec.sku} — hero image ${imgStatus}`); continue; }
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
      free_shipping: false, shipping_note: `Ships from CJ; ${usQty} units US inventory verified (list-level, inventory not delivery). Freight + delivery timeline UNKNOWN — verify before final publication.`,
      product_source_evidence: { provider: 'cj', sourceUrl: s.sourceUrl || null, pid: s.productId || null, observedAt: s.observedAt || null, verification: 'list-level only (no detail/freight this phase)', listingStandard: 'Luxedge professional listing: curated title/description/SEO/alt from real CJ record. No invented facts.' },
      evidence_notes: spec.evidence,
      image_url: images[0],
    } }))[0].id;
    for (let k = 0; k < images.length; k++) {
      await rest('product_images', { method: 'POST', body: {
        id: randomUUID(), product_id: pid, url: images[k],
        storage_path: `cj/${spec.sku}/${k}-${path.basename(String(images[k]).split(/[?#]/)[0])}`,
        public_url: images[k], alt_text: `${spec.retailTitle} — ${k === 0 ? 'primary image' : `image ${k + 1}`}`,
        kind: 'product', is_primary: k === 0, sort_order: k, created_at: new Date().toISOString(),
      } });
    }
    report.added.push({ sku: spec.sku, title: spec.retailTitle, price, cost, margin: Math.round((1 - cost / price) * 1000) / 10, usQty });
    console.log(`+ ADDED ${spec.sku} — ${spec.retailTitle} ($${price}, cost $${cost}, margin ${Math.round((1 - cost / price) * 1000) / 10}%, US ${usQty})`);
  }
  console.log('\nREPORT:', JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
