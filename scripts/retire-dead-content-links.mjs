// LUXEDGE — retire dead outbound links from live editorial content.
//
// The September 2026 production crawl found /blog/how-to-fit-no-pull-dog-harness
// (indexable, in the sitemap) linking readers and crawlers to:
//   * /blog/dog-car-safety-seat-belt-guide      — deleted article (404)
//   * /product/2m-pet-dog-leash-...             — delisted product (404, no image)
// and to a cat-tunnel article under "Essential Supplies for a New Puppy"
// anchor text, plus an unverifiable "3M reflective safety piping" claim.
//
// This rewrites only those lines. Every replacement target is a live, publicly
// listable product/category, and each anchor uses the destination's real
// product name so the article and the PDP agree. The renderers additionally
// refuse to emit links to retired paths (src/content/reviewHolds.ts), so this
// is the content half of a two-layer fix.
//
// Idempotent: lines that no longer contain a dead destination are left alone.
// Usage: node scripts/retire-dead-content-links.mjs
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

const CAR_TETHER = '/product/2pcs-pet-dog-seat-belt-leash-adjustable-pet-dog-cat-safety-leads-harness-car-vehicle-nylon-fabric-seatbelt-strap';
const LEASH_SET = '/product/nylon-anti-grind-dog-leash-collar';
const HARNESS = '/product/no-pull-dog-harness-with-reflective-strips-front-back-clip';

/** [match, replacement] applied per line. */
const LINE_RULES = [
  [/\/blog\/dog-car-safety-seat-belt-guide/, () =>
    `For safer car journeys, a [pet car seatbelt tether](${CAR_TETHER}) restrains your dog while you drive \u2014 check it fits your dog and your vehicle, and never leave a dog unattended in a parked car. For everyday walking gear, browse [Dog Supplies](/category/dog-supplies).`],
  [/\/product\/2m-pet-dog-leash/, () =>
    `- [Anti-Chew Heavy-Duty Braided Nylon Leash & Collar Set](${LEASH_SET}) \u2014 braided nylon walking set to pair with the harness.`],
  [/3M reflective|No-Pull Reflective Dog Harness/, () =>
    `- [No-Pull Dog Harness with Reflective Strips \u2014 Front & Back Clip](${HARNESS}) \u2014 front and back attachment points with reflective strips for safer evening walks.`],
];

async function api(path, init) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: HEAD, ...init });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------- blog body
const [post] = await api('blog_posts?select=slug,content&slug=eq.how-to-fit-no-pull-dog-harness');
if (!post) { console.error('post not found'); process.exit(1); }
const lines = (post.content || '').split('\n');
let changed = 0;
const next = lines.map((line) => {
  for (const [re, make] of LINE_RULES) {
    if (re.test(line)) {
      const replacement = make();
      if (line === replacement) return line;
      changed++;
      return replacement;
    }
  }
  return line;
});
if (changed) {
  await api('blog_posts?slug=eq.how-to-fit-no-pull-dog-harness', {
    method: 'PATCH', body: JSON.stringify({ content: next.join('\n') }),
  });
}
console.log(`blog/how-to-fit-no-pull-dog-harness: ${changed} line(s) rewritten`);

// ------------------------------------------------- product copy (Phase 7 #1)
// The trough listing stated BOTH a 50-gallon capacity (slug, meta description,
// body copy) and a 60 cm length (title, short description) — the two cannot
// both be true, and neither is independently documented here. Per the audit
// rule for unverifiable specs, the conflicting numbers and the unevidenced
// "UV-resistant" claim are removed rather than guessed; the slug (and so the
// indexed URL) is unchanged and the conflict is reported as owner evidence.
const TROUGH = {
  name: 'Heavy-Duty Poly Livestock Feed Trough for Cattle & Goats',
  seo_title: 'Heavy-Duty Poly Livestock Feed Trough for Cattle & Goats | Luxedge',
  seo_description: 'Heavy-duty poly feed trough for cattle, goats, sheep and other livestock. Easy to clean and built for daily feeding and watering.',
  short_description: 'Heavy-duty rectangular livestock feeding trough for cattle, sheep, goats, pigs and poultry. Easy-to-clean design with reinforced edges.',
  description: 'Built for livestock use, this heavy-duty poly trough works as both a feed trough and a water basin. The smooth interior is easy to clean, which suits daily feeding and watering, and it is made to be used outdoors on the farm. Suitable for cattle, horses, goats, and other large livestock.\n\nExact dimensions and capacity are not stated on this listing \u2014 contact us before ordering if you need a specific size.',
};
const [trough] = await api('products?select=slug,name,seo_title,seo_description,short_description,description&slug=eq.heavy-duty-cattle-feed-trough-50-gallon');
if (!trough) { console.error('trough product not found'); process.exit(1); }
const conflicts = JSON.stringify(trough).match(/50-gallon|50 gallon|60 ?cm/gi) || [];
if (conflicts.length) {
  await api('products?slug=eq.heavy-duty-cattle-feed-trough-50-gallon', {
    method: 'PATCH', body: JSON.stringify(TROUGH),
  });
  console.log(`heavy-duty-cattle-feed-trough-50-gallon: copy replaced (found ${conflicts.length} conflicting capacity mention(s))`);
} else {
  console.log('heavy-duty-cattle-feed-trough-50-gallon: no conflicting capacity claim left, unchanged');
}
