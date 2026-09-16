// LUXEDGE — unsupported-claim audit (read-only).
//
// Scans every publicly visible surface for the claim classes that must not ship
// without owner evidence: safety/certification, medical or treatment outcomes,
// noise/load/UV figures, airline approval, biodegradability timelines, and
// third-party brand names that imply official sourcing.
//
// Sources:
//   * products            — name, short description, long description, SEO fields
//                           (only products the storefront actually lists)
//   * blog_posts          — published guides: title, excerpt, body, SEO fields
//   * categories          — active category name and description
//
// Nothing is modified and no secret is exposed. Public results only.
// Usage: node scripts/product-claim-audit.mjs [--json]
import fs from 'fs';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const txt = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Same public contract as the storefront (src/content/productEligibility.ts). */
function listable(p) {
  if (!/^(active|published)$/.test(txt(p.status).toLowerCase())) return false;
  if (num(p.price) <= 0) return false;
  const hasImage = /^https?:\/\//i.test(txt(p.image_url)) || (p.product_images || []).some((i) => /^https?:\/\//i.test(txt(i?.url || i?.public_url)));
  if (!hasImage) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(txt(p.slug))) return false;
  if (txt(p.name).length < 3 || /^(product|item|test)(\s|$)/i.test(txt(p.name))) return false;
  if (txt(p.description).length + txt(p.short_description).length < 100) return false;
  if (/\bkong\b|official|manufacturer/i.test(txt(p.supplier_source))) return false;
  const facts = txt([p.slug, p.name, p.description, p.short_description].join(' ')).toLowerCase();
  if ((/(horse.*halter|halter.*horse)/.test(facts) && /nylon/.test(facts) && /cowhide/.test(facts)) ||
      (/(grooming.*kit|kit.*grooming)/.test(facts) && /\b12[- ]?piece\b/.test(facts) && /\b10[- ]?piece\b/.test(facts)) ||
      (/(trough|water bladder)/.test(facts) && /\b30[- ]?gallon\b/.test(facts) && /water bladder/.test(facts))) return false;
  const declared = txt(p.commerce_readiness);
  if (declared) return declared === 'COMMERCE_READY';
  const src = txt(p.supplier_source).toLowerCase();
  return !!src && num(p.cost_price) > 0
    && (p.us_inventory === true || (txt(p.stock_status) === 'in_stock' && num(p.inventory_qty) > 0));
}

/**
 * [label, pattern, severity] — each is a claim that must not ship without owner
 * evidence. `hard` = unsupported claim, fix or remove. `advisory` = ordinary
 * descriptive wording that an operator should see but that is not automatically
 * wrong (e.g. "waterproof" for a silicone mat or a lined bed cover).
 */
const CLAIMS = [
  ['airline-approval', /\bairline[- ]approved\b|\bTSA[- ]approved\b|\bIATA[- ]approved\b/i, 'hard'],
  ['crash-test', /\bcrash[- ]tested\b|\bcrash[- ]test(ed)?\b|\bsafety[- ]certified\b|\bNCAP\b/i, 'hard'],
  ['certification', /\bCertiPUR[- ]US\b|\bOEKO[- ]TEX\b|\bFDA[- ]approved\b|\bCE[- ]marked\b|\bISO\b/i, 'hard'],
  // "treat" is only a medical verb with an object ("treats arthritis"), never as
  // the noun for a reward snack — the bare word produced false positives.
  ['medical-outcome', /\bcures?\b|\bprevents?\b|\bheals?\b|\btreat(?:s|ed|ing)\b\s+(?:your|the|a|an|this|that|it|them|him|her|their|its|pain|joints?|skin|coat|infection|disease|arthritis|anxiety|itch|allergies|wounds?|hot ?spots?)|\btherap(eutic|y)\b|\bjoint support\b|\brelieves? (pain|joint)\b/i, 'hard'],
  ['decibels', /\b\d{2}\s?dB\b|\bdecibels?\b/i, 'hard'],
  ['load-rating', /\b\d+\s?(lb|lbs|kg|pounds)\b[^.]{0,24}\b(load|capacity|hold|support|withstand)/i, 'hard'],
  ['uv-protection', /\bUV[- ]?(protection|resistant|blocking|proof)\b|\bUPF\s?\d+/i, 'hard'],
  ['non-toxic', /\bnon[- ]toxic\b|\bpet[- ]safe\b|\bfood[- ]grade\b/i, 'hard'],
  ['biodegradable-timeline', /\bbiodegrades?[^.]{0,40}\b(year|month|day)/i, 'hard'],
  ['waterproof-rating', /\bIPX?\d\b|\bwaterproof\b/i, 'advisory'],
  ['third-party-brand-as-official', /\b3M\b|\bKONG\b|\bVelcro\b|\bGore[- ]?Tex\b/i, 'hard'],
];

/**
 * Claim wording that survives in a live URL slug after the copy was corrected.
 * The URL is not a sentence, but it is publicly visible (address bar, search
 * results, inbound links), so a withdrawn claim in a slug is worth reporting.
 * Renaming a slug needs a 301, so these are owner decisions, not silent edits.
 */
const SLUG_TOKENS = [
  { label: 'uv-protection', slugRe: /uv[-_]?protection/i, supports: (m, copy) => /\bUV\b|\bUPF\b|ultraviolet/i.test(copy) },
  { label: 'airline-approved', slugRe: /airline[-_]approved/i, supports: (m, copy) => /\bairlines?\b/i.test(copy) },
  { label: 'joint-support', slugRe: /joint[-_]support/i, supports: (m, copy) => /\bjoint\b/i.test(copy) },
  { label: 'gallon-capacity', slugRe: /(\d+)[-_]gallons?/i, supports: (m, copy) => new RegExp(`${m[1]}[- ]?gallon`, 'i').test(copy) },
  { label: 'certipur', slugRe: /certipur/i, supports: (m, copy) => /certipur/i.test(copy) },
];

/** Markdown link targets are URLs, not reading copy. Strip them before scanning
 * a body so `/product/horse-fly-mask-with-ears-uv-protection` cannot be reported
 * as the guide making a UV claim. */
const stripLinkTargets = (text) => String(text || '').replace(/\]\([^)]*\)/g, ']');

const get = async (path) => {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const scan = (fields, owner) => {
  const out = [];
  for (const [where, text] of Object.entries(fields)) {
    const haystack = where === 'body' ? stripLinkTargets(text) : text;
    for (const [label, re, severity] of CLAIMS) {
      const hit = haystack.match(re);
      if (hit) out.push({
        owner, where, label, severity, text: hit[0],
        context: haystack.slice(Math.max(0, (hit.index || 0) - 40), (hit.index || 0) + 80),
      });
    }
  }
  return out;
};

/** A slug is only stale when the visible copy no longer supports the wording the
 * slug names — otherwise a slug such as `…trough-30-gallon` would be reported
 * merely for stating a capacity the listing still states. */
const scanSlug = (slug, copy, owner) => SLUG_TOKENS
  .filter(({ slugRe, supports }) => { const m = slug.match(slugRe); return m && !supports(m, copy); })
  .map(({ label }) => ({
    owner, where: 'slug', label: `slug-names-${label}`, severity: 'advisory',
    text: slug, context: `public URL still names a claim the visible copy no longer makes: /${owner}`,
  }));

const [rawProducts, rawPosts, rawCats] = await Promise.all([
  get('products?select=slug,name,status,price,image_url,short_description,description,seo_title,seo_description,supplier_source,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness,product_images(url,public_url)&limit=500'),
  get('blog_posts?select=slug,title,excerpt,content,seo_title,meta_description,author_name,date_label&status=eq.published&order=slug.asc&limit=500'),
  get('categories?select=slug,name,description&is_active=eq.true&order=slug.asc&limit=200'),
]);

// Match the public sitemap/storefront contract: editorially held records stay
// out of the public claim scan even when their admin data is otherwise complete.
const HELD_PRODUCT_SLUGS = new Set([
  'kong-classic-durable-natural-rubber-dog-toy',
  'adjustable-nylon-horse-halter-lead-rope',
  'horse-grooming-kit-12-piece',
]);
const products = rawProducts.filter((p) => !HELD_PRODUCT_SLUGS.has(txt(p.slug)) && listable(p));
const findings = [];

for (const p of products) {
  findings.push(...scan({
    name: txt(p.name), short: txt(p.short_description), long: txt(p.description),
    seoTitle: txt(p.seo_title), seoDesc: txt(p.seo_description),
  }, `product/${p.slug}`));
}

for (const post of rawPosts) {
  findings.push(...scan({
    title: txt(post.title), excerpt: txt(post.excerpt), body: txt(post.content),
    seoTitle: txt(post.seo_title), seoDesc: txt(post.meta_description),
  }, `blog/${post.slug}`));
}

for (const c of rawCats) {
  findings.push(...scan({ name: txt(c.name), description: txt(c.description) }, `category/${c.slug}`));
}

findings.push(...rawProducts.flatMap((p) => scanSlug(
  p.slug,
  [p.name, p.short_description, p.description, p.seo_title, p.seo_description].map(txt).join(' '),
  `product/${p.slug}`,
)));

const hard = findings.filter((f) => f.severity === 'hard');
const advisory = findings.filter((f) => f.severity === 'advisory');

const summary = {
  publiclyListableProducts: products.length,
  publishedGuides: rawPosts.length,
  activeCategories: rawCats.length,
  unsupportedClaims: hard.length,
  advisoryNotes: advisory.length,
  findings,
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`publicly listable products: ${summary.publiclyListableProducts}`);
  console.log(`published guides:           ${summary.publishedGuides}`);
  console.log(`active categories:          ${summary.activeCategories}`);
  console.log(`unsupported claims:         ${hard.length}`);
  console.log(`advisory notes:             ${advisory.length}\n`);
  for (const f of hard) console.log(`  [HARD ${f.label}] ${f.where} :: ${f.owner}\n      "${f.context.trim()}"`);
  if (advisory.length) {
    console.log('\n  --- advisory (ordinary descriptive wording, confirm before changing) ---');
    for (const f of advisory) console.log(`  [note ${f.label}] ${f.where} :: ${f.owner}\n      "${f.context.trim()}"`);
  }
}

// Operator gate: an unsupported claim in public copy fails the audit.
// (exitCode rather than process.exit so Node tears down fetch handles cleanly.)
process.exitCode = hard.length ? 1 : 0;
