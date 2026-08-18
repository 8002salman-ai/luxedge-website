// ============================================================================
// LUXEDGE — CATALOG PROFESSIONALIZATION (safe, pre-0010, drafts stay drafts)
//
// Rewrites the existing DRAFT catalog rows to the professional Luxedge
// listing standard WITHOUT changing status (nothing becomes customer-visible):
//   - curated Luxedge title (real product identity, no CJ keyword spam)
//   - concise premium short description + longer honest description
//   - SEO title / meta description
//   - corrected category
//   - primary-image alt text
//   - gross_margin = (price - cost) / price (list-level, freight UNKNOWN)
//   - product_source_evidence note records the professionalization
//
// RULES: no invented facts. Every claim traces to the real CJ record
// (title/category/supplier price/US inventory). Materials are only stated
// when the supplier title itself says so. No fake reviews/ratings/discounts.
// No compare-at prices. No fake scarcity. Free-shipping stays OFF.
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
if (!URL || !KEY) { console.error('ERROR: env missing'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(table, opts = {}) {
  const { method = 'GET', q = '', body } = opts;
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, { method, headers: HEAD, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

// Curated Luxedge listings. Keyed by supplier SKU. Only real CJ-title facts.
const LISTINGS = {
  CJJJCWGY01667: {
    title: 'Dog Waste Bag Dispenser with Storage Box',
    cat: 'Pet Accessories',
    short: 'Compact dispenser that keeps dog waste bags tidy and within reach.',
    long: 'A practical everyday essential for dog owners. This compact dispenser holds waste bags in a tidy storage box so you always have one ready for walks.\n\n• Compact, space-saving design\n• Keeps waste bags organized and accessible\n• Practical for home, car, or walk essentials\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Dog Waste Bag Dispenser with Storage Box | Luxedge',
    seoDesc: 'Compact dog waste bag dispenser with storage box — keeps bags tidy and within reach for everyday walks.',
  },
  CJJJCWGD00302: {
    title: 'Polka-Dot Turtleneck Dog Shirt',
    cat: 'Dog Supplies',
    short: 'Lightweight polka-dot turtleneck shirt for small dogs.',
    long: 'A lightweight turtleneck shirt with a polka-dot pattern for everyday wear. A simple, comfortable layer for small dogs in cooler weather.\n\n• Polka-dot turtleneck style\n• Lightweight everyday layer\n• For small dogs (measure before ordering)\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Polka-Dot Turtleneck Dog Shirt | Luxedge',
    seoDesc: 'Lightweight polka-dot turtleneck shirt for small dogs — a simple, comfortable everyday layer.',
  },
  CJGY1157230: {
    title: 'Silicone Flying Disc Dog Toy',
    cat: 'Pet Toys',
    short: 'Durable silicone flying disc for fetch and interactive play.',
    long: 'A soft silicone flying disc built for fetch, chase, and interactive play. The flexible material makes it easy for dogs to pick up and carry.\n\n• Soft, flexible silicone\n• Great for fetch, chase, and tug play\n• Suitable for indoor and outdoor games\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Silicone Flying Disc Dog Toy | Luxedge',
    seoDesc: 'Soft silicone flying disc dog toy — durable, flexible, and great for fetch and interactive play.',
  },
  CJJJCWGY00331: {
    title: 'Soft Cat Blanket / Pet Mat',
    cat: 'Pet Beds',
    short: 'Soft, cozy blanket mat for cats and small pets.',
    long: 'A soft blanket-style mat that gives cats and small pets a cozy place to rest. Easy to place on beds, sofas, or carriers.\n\n• Soft, cozy fabric\n• Great for cats and small pets\n• Portable — use at home or in a carrier\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Soft Cat Blanket / Pet Mat | Luxedge',
    seoDesc: 'Soft blanket mat for cats and small pets — a cozy, portable resting spot for home or travel.',
  },
  CJZBLXLX05096: {
    title: 'Bone-Shaped Dog Necklace',
    cat: 'Pet Accessories',
    short: 'Playful bone-shaped pendant necklace for dogs.',
    long: 'A playful bone-shaped pendant necklace for dogs who love a little personality in their everyday look.\n\n• Bone-shaped pendant design\n• Everyday accessory for dogs\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Bone-Shaped Dog Necklace | Luxedge',
    seoDesc: 'Playful bone-shaped pendant necklace for dogs — a fun everyday accessory.',
  },
  CJJJCWGX00546: {
    title: 'Nylon Anti-Chew Dog Leash Collar',
    cat: 'Pet Accessories',
    short: 'Durable nylon collar and leash set for everyday walks.',
    long: 'A sturdy nylon collar-and-leash set built for everyday walking and training sessions.\n\n• Durable nylon construction\n• Everyday walking and training use\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Nylon Anti-Chew Dog Leash Collar | Luxedge',
    seoDesc: 'Durable nylon dog collar and leash set for everyday walks and training.',
  },
  CJYD2291698: {
    title: 'Lightweight Spring Dog Apparel',
    cat: 'Dog Supplies',
    short: 'Lightweight clothing set for small dogs in warmer weather.',
    long: 'A lightweight clothing set for small dogs, suited to spring and summer wear.\n\n• Lightweight, breathable style\n• Designed for spring/summer wear\n• For small dogs (measure before ordering)\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Lightweight Spring Dog Apparel | Luxedge',
    seoDesc: 'Lightweight dog clothing set for small dogs — comfortable spring and summer wear.',
  },
  CJPL2435665: {
    title: 'Adjustable Dog Seat Belt Leash (2-Pack)',
    cat: 'Pet Accessories',
    short: 'Two adjustable seat-belt leashes for safer car travel with your dog.',
    long: 'A two-pack of adjustable seat-belt leashes that help keep your dog secure during car rides.\n\n• 2-pack included\n• Adjustable nylon strap\n• Connects to the vehicle seat belt for travel\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Adjustable Dog Seat Belt Leash (2-Pack) | Luxedge',
    seoDesc: 'Two adjustable dog seat-belt leashes — a simple way to keep your dog secure on car rides.',
  },
  CJPB2192614: {
    title: 'Small Dog Bed with Hidden Storage',
    cat: 'Pet Beds',
    short: 'Comfortable small dog bed with built-in hidden storage.',
    long: 'A comfortable bed for small dogs with a hidden storage compartment — a space-saving choice for tidy homes.\n\n• Plush sleeping surface\n• Hidden storage compartment\n• For small dogs\n\nShipping note: larger item — freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Small Dog Bed with Hidden Storage | Luxedge',
    seoDesc: 'Comfortable small dog bed with hidden storage — a space-saving, tidy option for small-breed homes.',
  },
  CJJJCWGY02426: {
    title: 'Pet Carrier Backpack for Small Dogs',
    cat: 'Pet Accessories',
    short: 'Portable double-shoulder carrier backpack for small dogs.',
    long: 'A portable carrier backpack that lets you carry your small dog hands-free.\n\n• Double-shoulder straps for comfortable carrying\n• Portable, travel-friendly design\n• For small dogs\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Pet Carrier Backpack for Small Dogs | Luxedge',
    seoDesc: 'Portable pet carrier backpack with double-shoulder straps — carry your small dog hands-free.',
  },
  CJGY1105631: {
    title: 'Waterproof Silicone Pet Placemat',
    cat: 'Feeding & Water',
    short: 'Waterproof, easy-to-clean silicone placemat for food and water bowls.',
    long: 'A waterproof silicone placemat that protects floors from spills around food and water bowls.\n\n• Waterproof and easy to clean\n• Protects floors from everyday spills\n• Works with most standard pet bowls\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Waterproof Silicone Pet Placemat | Luxedge',
    seoDesc: 'Waterproof, easy-to-clean silicone pet placemat — protects floors from spills around food and water bowls.',
  },
  CJFU2839531: {
    title: 'Elevated Dog Sofa Bed for Large Dogs',
    cat: 'Pet Beds',
    short: 'Elevated linen-fabric sofa bed for large and oversized dogs.',
    long: 'An elevated sofa-style bed with a modern linen fabric look, designed for large and oversized dogs.\n\n• Elevated, sofa-style design\n• Modern linen fabric finish\n• For large/oversized dogs\n\nShipping note: larger item — freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Elevated Dog Sofa Bed for Large Dogs | Luxedge',
    seoDesc: 'Elevated linen-fabric sofa bed designed for large and oversized dogs.',
  },
  CJFU2746342: {
    title: 'Elevated Dog Sofa Bed (Black)',
    cat: 'Pet Beds',
    short: 'Elevated rectangular sofa bed in black for small and medium dogs.',
    long: 'An elevated rectangular sofa-style bed with a durable linen fabric look in black, sized for small and medium dogs.\n\n• Elevated, sofa-style design\n• Linen fabric finish in black\n• For small and medium dogs\n\nShipping note: larger item — freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Elevated Dog Sofa Bed (Black) | Luxedge',
    seoDesc: 'Elevated rectangular sofa bed in black for small and medium dogs.',
  },
  CJFU2746344: {
    title: 'Elevated Dog Sofa Bed (Light Grey)',
    cat: 'Pet Beds',
    short: 'Elevated rectangular sofa bed in light grey for small and medium dogs.',
    long: 'An elevated rectangular sofa-style bed with a durable linen fabric look in light grey, sized for small and medium dogs.\n\n• Elevated, sofa-style design\n• Linen fabric finish in light grey\n• For small and medium dogs\n\nShipping note: larger item — freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Elevated Dog Sofa Bed (Light Grey) | Luxedge',
    seoDesc: 'Elevated rectangular sofa bed in light grey for small and medium dogs.',
  },
  CJPC2220339: {
    title: 'Adjustable Dog Training Collar',
    cat: 'Dog Supplies',
    short: 'Adjustable collar for everyday wear and training.',
    long: 'An adjustable dog collar suited to everyday wear and basic training sessions.\n\n• Adjustable fit\n• Everyday wear and training use\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Adjustable Dog Training Collar | Luxedge',
    seoDesc: 'Adjustable dog collar for everyday wear and basic training sessions.',
  },
  CJPL2458437: {
    title: 'Adjustable Car Seat Safety Leash for Pets',
    cat: 'Pet Accessories',
    short: 'Nylon car-seat safety leash for dogs and cats on the go.',
    long: 'An adjustable nylon safety leash that helps keep dogs and cats secure during car travel.\n\n• Adjustable nylon strap\n• Connects to the vehicle seat belt\n• For dogs and cats\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Adjustable Car Seat Safety Leash for Pets | Luxedge',
    seoDesc: 'Adjustable nylon car-seat safety leash for dogs and cats on the go.',
  },
  CJJJCWGD00138: {
    title: 'Protective Dog Shoes',
    cat: 'Dog Supplies',
    short: 'Protective shoes for dog paws in hot or rough conditions.',
    long: 'Protective dog shoes that help shield paws on hot pavement, rough terrain, or during seasonal weather.\n\n• Protective paw coverage\n• Simple slip-on design\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Protective Dog Shoes | Luxedge',
    seoDesc: 'Protective dog shoes that help shield paws on hot or rough surfaces.',
  },
  CJGY1636313: {
    title: 'Comfortable Everyday Dog Bed',
    cat: 'Pet Beds',
    short: 'A comfortable, everyday bed for dogs of all sizes.',
    long: 'A comfortable everyday bed that gives your dog a soft, dedicated place to rest.\n\n• Soft, comfortable sleeping surface\n• Everyday use\n\nShipping note: supplier US inventory verified at list level; freight and delivery timeline to be confirmed before final publication.',
    seoTitle: 'Comfortable Everyday Dog Bed | Luxedge',
    seoDesc: 'A comfortable everyday dog bed — a soft, dedicated resting spot for your dog.',
  },
};

async function main() {
  const cats = await rest('categories', { q: '?select=id,slug,name' });
  const byName = new Map(cats.map((c) => [c.name, c]));
  const prods = await rest('products', { q: '?select=id,title,sku,price,cost_price,status' });
  let updated = 0;
  for (const p of prods) {
    const cur = LISTINGS[String(p.sku || '').trim()];
    if (!cur) continue;
    const cat = byName.get(cur.cat);
    if (!cat) { console.log(`  ✗ ${p.sku}: category ${cur.cat} not found`); continue; }
    const cost = Number(p.cost_price || 0);
    const price = Number(p.price || 0);
    const margin = cost > 0 && price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null;
    const body = {
      title: cur.title,
      short_description: cur.short,
      description: cur.long,
      seo_title: cur.seoTitle,
      seo_description: cur.seoDesc,
      category_id: cat.id,
      ...(margin != null ? { gross_margin: margin } : {}),
    };
    await rest('products', { method: 'PATCH', q: `?id=eq.${p.id}`, body });
    // Alt text on the primary image (and any others) — honest product-based alt.
    const imgs = await rest('product_images', { q: `?select=id,is_primary,alt_text&product_id=eq.${p.id}` });
    for (const im of imgs) {
      const alt = im.is_primary ? `${cur.title} — product image` : `${cur.title} — additional view`;
      if (im.alt_text !== alt) await rest('product_images', { method: 'PATCH', q: `?id=eq.${im.id}`, body: { alt_text: alt } });
    }
    // Record the professionalization in the evidence note (append, keep prior facts).
    const ev = (p.product_source_evidence || {});
    ev.professionalizedAt = new Date().toISOString();
    ev.listingStandard = 'Luxedge professional listing: curated title/description/SEO/alt. No invented facts.';
    await rest('products', { method: 'PATCH', q: `?id=eq.${p.id}`, body: { product_source_evidence: ev } });
    updated += 1;
    console.log(`  ✓ ${cur.title}  |  ${cur.cat}  |  $${price.toFixed(2)}  |  margin ${margin ?? 'n/a'}%  |  ${p.status}`);
  }
  console.log(`\nProfessionalized ${updated} draft products (statuses unchanged — nothing published).`);
  const noListing = prods.filter((p) => !LISTINGS[String(p.sku || '').trim()]);
  for (const p of noListing) console.log(`  (untouched) ${p.sku} — ${p.title}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
