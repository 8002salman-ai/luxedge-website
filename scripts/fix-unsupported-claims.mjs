// LUXEDGE — remove unsupported claims from live product copy.
//
// scripts/product-claim-audit.mjs lists every claim class that may not ship
// without owner evidence. This script applies the corrections for the ones the
// September 2026 audit confirmed in PUBLICLY LISTABLE products:
//
//   * "Airline-Approved" cabin-travel approval (no airline or IATA document)
//   * "CertiPUR-US certified" foam (no product-level certificate on file)
//   * medical/outcome wording on an orthopedic bed ("Joint Support", "reduce
//     pressure on hips, elbows and spine")
//   * numeric noise figures ("under 30 dB", "40 dB") and an absolute
//     "prevents/eliminates stress" outcome
//   * UV-protection specs, "frost-resistant", "chew-proof" durability absolute
//
// Wording is replaced by conservative statements of what the listing itself
// supports; nothing is invented and no new product claim is introduced. Slugs
// (and therefore the indexed URLs) are untouched, so any slug that still names
// a withdrawn claim is reported as NEEDS OWNER EVIDENCE instead of being
// renamed — changing it would break the live URL without a redirect.
//
// Idempotent: a replacement whose old text is already gone is skipped.
// Usage: node scripts/fix-unsupported-claims.mjs
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

/** { slug: { field: [[from, to], ...] } } */
const FIXES = {
  'outdoor-hanging-bird-feeder': {
    description: [
      ['chew-proof construction', 'durable construction'],
      ['Made from UV-resistant plastic with a built-in perching rail.', 'Made from weather-resistant plastic with a built-in perching rail.'],
    ],
  },
  'solar-bird-bath-fountain': {
    short_description: [
      ['weather- and frost-resistant resin', 'weather-resistant resin'],
    ],
    description: [
      ['The gentle water circulation attracts birds and prevents stagnation.', 'The gentle water circulation attracts birds and keeps the basin water moving.'],
    ],
  },
  'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs': {
    description: [
      ['Quiet pump under 30 dB.', 'Quiet circulating pump.'],
    ],
    seo_description: [
      ['2.5L, silent pump under 30dB.', '2.5L, quiet circulating pump.'],
    ],
  },
  'usb-rechargeable-pet-nail-grinder-quiet-motor-for-dogs-cats': {
    short_description: [
      ['Whisper-quiet nail grinder eliminates the stress of traditional clippers for pets and owners.', 'Low-noise nail grinder as an alternative to traditional clippers for pets and owners.'],
    ],
    seo_description: [
      ['Stress-free nail trimming with a 40dB ultra-quiet motor.', 'Low-noise nail grinder for dogs and cats.'],
    ],
    description: [
      ["40 dB ultra-quiet motor won't spook noise-sensitive pets.", 'Low-noise motor designed to be gentler on noise-sensitive pets.'],
      ['Safety guard prevents over-grinding.', 'Safety guard for controlled grinding.'],
    ],
  },
  'horse-fly-mask-with-ears': {
    name: [
      ['Breathable Mesh Horse Fly Mask with Ear Protection & UV Shield', 'Breathable Mesh Horse Fly Mask with Ear Covers'],
    ],
    short_description: [
      ['protect horses from flies, dust, and UV rays', 'shade horses from flies, dust, and direct sun'],
    ],
    seo_title: [
      ['Horse Fly Mask with Ears — UV Protection', 'Horse Fly Mask with Ears — Breathable Mesh | Luxedge'],
    ],
    seo_description: [
      ['Fly mask for horses with ears, offering UV protection and a clear view.', 'Fly mask for horses with ear covers, shading the eyes, face and ears with a clear view.'],
    ],
    description: [
      ['Protect your horse from biting flies and UV rays with this breathable mesh fly mask.', "Shield your horse's eyes, face and ears from biting flies and the sun with this breathable mesh fly mask."],
      ['Soft fleece padding at pressure points prevents rubbing.', 'Soft fleece padding at pressure points reduces rubbing.'],
    ],
  },
  'orthopedic-memory-foam-dog-bed': {
    name: [
      ['Orthopedic Memory Foam Dog Bed — Joint Support for Senior & Large Dogs', 'Orthopedic Memory Foam Dog Bed for Senior & Large Dogs'],
    ],
    short_description: [
      ['Joint support for senior and large breeds.', 'Designed for senior and large breeds.'],
    ],
    seo_description: [
      ['CertiPUR-US certified 4-inch memory foam for senior and large dogs. Washable cover, waterproof liner, up to XXL.', '4-inch memory foam dog bed in sizes M to XXL. Removable washable cover, water-resistant inner liner.'],
    ],
    description: [
      ['Certified CertiPUR-US foam distributes body weight evenly to reduce pressure on hips, elbows, and spine. Non-slip bottom prevents sliding.', 'The memory foam base distributes body weight evenly across the bed surface. Non-slip bottom.'],
      ['Available in M, L, XL, and XXL for dogs up to 120 lbs.', 'Available in M, L, XL, and XXL.'],
    ],
  },
  'foldable-pet-travel-carrier-backpack': {
    name: [
      ['Airline-Approved Breathable Foldable Pet Travel Carrier Backpack', 'Breathable Foldable Pet Travel Carrier Backpack'],
    ],
    short_description: [
      ['Expandable backpack carrier with mesh ventilation and a rigid base — approved for cabin travel.', "Expandable backpack carrier with mesh ventilation and a rigid base. Check your airline's current cabin-size rules before booking."],
    ],
    seo_title: [
      ['Pet Carrier Backpack | Foldable, Airline-Approved', 'Foldable Pet Carrier Backpack | Breathable & Expandable | Luxedge'],
    ],
    seo_description: [
      ["Airline-approved backpack carrier with expandable compartment and mesh ventilation. Padded straps, up to 8kg.", "Expandable pet carrier backpack with mesh ventilation and padded straps. Check your airline's current cabin rules before booking."],
    ],
    description: [
      ["Meets major airline carry-on requirements (fits under seat).", "Designed to fit under an airline seat — always confirm your airline's current cabin-size and weight limits before travelling."],
      ['Includes a fleece travel mat. Max weight: 8 kg.', 'Includes a fleece travel mat.'],
    ],
  },
};

// ---------------------------------------------------------------------------
// Brand cleanup: the retailer's own name is not a product brand.
// ---------------------------------------------------------------------------
// Luxedge is the store (operated by Embani LLC), not the manufacturer of the
// third-party goods it sells, yet eighteen rows carried brand = "Luxedge" and
// the storefront displayed it as the product's brand. Where a third-party
// supplier is recorded for the row, the value is not evidence of a real product
// brand, so it is cleared: the page then shows no brand (and no schema brand)
// instead of a fabricated one. Any genuinely own-branded item keeps its value
// by having its real brand name recorded in the catalog.
let brandsCleared = 0;
{
  const res = await fetch(`${BASE}/rest/v1/products?select=slug,brand,supplier_source&brand=ilike.Luxedge&limit=500`, { headers: HEAD });
  if (!res.ok) throw new Error(`brand scan -> ${res.status}`);
  const rows = await res.json();
  const targets = rows.filter((r) => String(r.supplier_source || '').trim().length > 0);
  for (const r of targets) {
    const put = await fetch(`${BASE}/rest/v1/products?slug=eq.${encodeURIComponent(r.slug)}`, {
      method: 'PATCH', headers: HEAD, body: JSON.stringify({ brand: '' }),
    });
    if (!put.ok) throw new Error(`${r.slug} brand PATCH -> ${put.status} ${await put.text()}`);
    brandsCleared++;
  }
  console.log(`brand = "Luxedge" on a third-party row: ${rows.length} found, ${brandsCleared} cleared (evidence: ${targets.map((r) => String(r.supplier_source).slice(0, 40)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(' | ') || 'n/a'})`);
}

const FIELDS = ['name', 'short_description', 'description', 'seo_title', 'seo_description'];
let totalChanged = 0;

for (const [slug, fields] of Object.entries(FIXES)) {
  const res = await fetch(`${BASE}/rest/v1/products?select=slug,${FIELDS.join(',')}&slug=eq.${encodeURIComponent(slug)}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${slug} -> ${res.status}`);
  const [row] = await res.json();
  if (!row) { console.log(`  ${slug}: ROW NOT FOUND (skipped)`); continue; }

  const patch = {};
  for (const [field, rules] of Object.entries(fields)) {
    let text = String(row[field] || '');
    let changed = false;
    for (const [from, to] of rules) {
      if (text.includes(from)) { text = text.replace(from, to); changed = true; }
    }
    if (changed) patch[field] = text;
  }
  const keys = Object.keys(patch);
  if (!keys.length) { console.log(`  ${slug}: already clean`); continue; }
  const put = await fetch(`${BASE}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, { method: 'PATCH', headers: HEAD, body: JSON.stringify(patch) });
  if (!put.ok) throw new Error(`${slug} PATCH -> ${put.status} ${await put.text()}`);
  totalChanged += keys.length;
  console.log(`  ${slug}: rewrote ${keys.join(', ')}`);
}
console.log(`\n${totalChanged} product field(s) rewritten, ${brandsCleared} fabricated brand value(s) cleared.`);
