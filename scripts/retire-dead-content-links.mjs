// LUXEDGE — retire dead outbound links from live editorial content.
//
// The September 2026 production crawl found /blog/how-to-fit-no-pull-dog-harness
// (indexable, in the sitemap) linking readers and crawlers to:
//   * /blog/dog-car-safety-seat-belt-guide      — deleted article (404)
//   * /product/2m-pet-dog-leash-...             — delisted product (404, no image)
// and to a cat-tunnel article under "Essential Supplies for a New Puppy"
// anchor text, plus an unverifiable "3M reflective safety piping" claim.
//
// It also carries the September 2026 guide corrections found while reviewing all
// eight published guides:
//   * two guides recommended products Luxedge has withheld from sale (horse
//     halter, horse grooming kit) — references replaced with the category, an
//     honest note, or dropped;
//   * the horse grooming kit guide contradicted itself (a "10-Piece Set" label
//     pointing at the 12-piece listing);
//   * the fly-mask guide claimed UV protection the listing no longer states;
//   * the cattle-trough guide repeated the withdrawn "60cm" capacity and framed
//     capacity around a "50 gallon" figure the product page no longer claims;
//   * the bird-feeder guide gave an unqualified bleach instruction, routed seed
//     storage through a feeder product, and used the same product link twice.
//
// Every replacement points at a live, publicly listable destination and uses
// that destination's real name, so the guide and the PDP agree. The renderers
// additionally refuse to emit links to retired paths
// (src/content/reviewHolds.ts), so this is the content half of a two-layer fix.
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

/** FAQ answers for the two guides that had none. Genuinely useful buying
 * questions only — never added to inflate schema volume. */
const TROUGH_FAQ = [
  { q: 'Should I use one trough for both feed and water?', a: 'Separating them usually makes daily routines easier: feed stations need dry, level placement and water stations need access to refilling, cleaning and drainage. Many owners keep them apart for that reason.' },
  { q: 'How often does a livestock trough need cleaning?', a: 'Clean on a routine you can actually keep, and check it daily. Feed troughs collect fines and moisture; water troughs collect debris and algae faster in warm weather. Empty, scrub and refill more often in hot conditions.' },
  { q: 'What should I check before ordering a trough?', a: 'Confirm the capacity and dimensions your supplier states, the material, whether it is intended for feed or water, and how you will empty and clean it. Measure the placement and approach space first.' },
];
const BIRD_FAQ = [
  { q: 'Which feeder attracts the widest range of birds?', a: 'A hopper or tray feeder with a roof and drainage usually attracts the widest range, while a tube feeder favours smaller birds such as finches and chickadees. Starting with one versatile feeder is normal.' },
  { q: 'How often should a bird feeder be cleaned?', a: 'Regularly — many bird-care sources suggest a routine of about once every one to two weeks, and more often in warm or wet weather when seed spoils faster. Our bird feeder cleaning guide covers a simple weekly routine.' },
  { q: 'Does a bird feeder need water nearby?', a: 'It helps. Birds need water for drinking and bathing year-round, and a bird bath near the feeder keeps them in the same area — particularly through winter and dry spells.' },
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

// ------------------------------------------------- withdrawn-product references
/** Per-guide line rules: replace or delete lines that reference a withdrawn
 * product or carry a claim the product page no longer supports. */
const GUIDE_LINE_RULES = {
  'horse-halter-lead-rope-buyers-guide': [
    [/^\*\*Related product → \[Adjustable Nylon Horse Halter/, () =>
      '**Note:** the specific halter this guide was written around is not currently stocked. The fit and sizing guidance above applies to any halter you buy — check the maker’s size chart for the one you choose.'],
    [/\/product\/adjustable-nylon-horse-halter-lead-rope/, () => null],
  ],
  'horse-grooming-kit-buyers-guide': [
    [/A coordinated \[12-Piece Horse Grooming Kit\]\(\/product\/horse-grooming-kit-12-piece\) with a storage bag/, () =>
      'A coordinated kit with a storage bag'],
    [/^A complete 12-piece kit, a fly mask/, () =>
      'A complete grooming kit, a fly mask'],
    [/A coordinated kit like the \[12-Piece Horse Grooming Kit\]\(\/product\/horse-grooming-kit-12-piece\) covers/, () =>
      'A coordinated kit covers'],
    [/\/product\/horse-grooming-kit-12-piece/, () => null],
  ],
  'horse-fly-mask-buyers-guide': [
    [/dust, and UV —/, () => 'dust, and direct sun —'],
    [/Many mesh masks also block a portion of UV, which matters for horses with pale skin or light muzzles\./, () =>
      'Mesh masks also shade the face, which matters for horses with pale skin or light muzzles.'],
    [/^## Material, UV, and Durability/, () => '## Material, Shade, and Durability'],
    [/Look for a breathable mesh that still blocks UV if the horse is sun-sensitive\./, () =>
      'Look for a breathable mesh that still gives shade if the horse is sun-sensitive.'],
    [/\[Horse Fly Mask with Ears — UV Protection\]/, () => '[Horse Fly Mask with Ears]'],
    [/^### Does a horse fly mask block UV\?/, () => '### Does a horse fly mask protect from the sun?'],
    [/^Many mesh masks block a portion of UV\. If your horse has sensitive pale skin, choose a mask that states UV protection\.$/, () =>
      'A mesh mask shades the face from direct sun. If your horse has pale, sun-sensitive skin, check the specific mask’s stated material with the maker or your vet.'],
    [/- \[Breathable Mesh Horse Fly Mask with Ear Protection & UV Shield\]/, () =>
      '- [Breathable Mesh Horse Fly Mask with Ear Covers]'],
    [/while blocking harmful UV rays\./, () => 'while shading the eyes and ears from direct sun.'],
  ],
  'how-to-choose-cattle-trough-feed-water-setup': [
    [/^## 30 vs\. 50 gallons: use the capacity as a planning choice/, () => '## Capacity: how much to hold between refills'],
    [/^A 30-gallon livestock trough can suit a portable water point[\s\S]*?how easily it can be cleaned\.$/, () =>
      'Capacity is a planning decision, not a rule about herd size. A trough that holds more means fewer refills but a heavier, harder-to-empty unit to move and clean; a smaller trough suits a portable water point, a tight space, or a routine with frequent checks. Choose around animal count, refill rate, weather, whether the trough is used for feed or water, and how easily it can be cleaned. Confirm the capacity your supplier states before ordering.'],
    [/For feed, compare the \[50-gallon cattle feed trough\]/, () =>
      'For feed, compare the [poly livestock feed trough]'],
    [/^2\. Choose 30 or 50 gallons based on your refill routine/, () =>
      '2. Choose a capacity based on your refill routine'],
    [/- \[Heavy-Duty Livestock Feed Trough — 60cm Poly Feeder\]/, () =>
      '- [Heavy-Duty Poly Livestock Feed Trough for Cattle & Goats]'],
    [/— Heavy-duty impact-resistant trough built for cattle, goats, and sheep\./, () =>
      '— Poly feed trough for cattle, goats and sheep, usable for feed or water.'],
  ],
  'best-bird-feeder-buyers-guide': [
    [/and store it in an \[Outdoor Hanging Bird Feeder\]\(\/product\/outdoor-hanging-bird-feeder\) with a sealed seed chamber to keep the mix dry and fresh between fillings\./, () =>
      'and store the seed itself in a sealed, dry container between fillings.'],
    [/Keep cats indoors and clean feeders every couple of weeks with a mild bleach solution\./, () =>
      'Keep cats away from the feeding station, and clean feeders on a regular routine — our [bird feeder cleaning guide](/blog/how-to-clean-a-bird-feeder) covers a simple weekly one.'],
    [/^Birds learn reliable food sources\./, () =>
      'Birds learn reliable food sources.'],
  ],
};

/** Extra sections appended to thin guides, only where they add real value. */
const GUIDE_APPENDS = {
  'best-bird-feeder-buyers-guide': [
    '',
    '## Compare before you buy',
    '',
    'Browse the [bird supplies collection](/category/bird-supplies) to compare feeders, baths and seed storage side by side, and check each listing’s stated capacity, hanging method and cleaning access before ordering.',
  ],
};

/** FAQ-column corrections. The visible FAQ block is rendered from this column
 * (and mirrored as FAQPage JSON-LD), so a claim fixed in the body can still be
 * published from here — which is exactly what a live-page scan caught. */
const GUIDE_FAQ_FIXES = {
  'horse-fly-mask-buyers-guide': [
    [/block UV\?/i, 'Does a horse fly mask protect from the sun?', 'A mesh mask shades the face from direct sun. If your horse has pale, sun-sensitive skin, check the specific mask’s stated material with the maker or your vet.'],
  ],
};

for (const [slug, fixes] of Object.entries(GUIDE_FAQ_FIXES)) {
  const [row] = await api(`blog_posts?select=slug,faq&slug=eq.${encodeURIComponent(slug)}`);
  if (!row || !Array.isArray(row.faq) || !row.faq.length) { console.log(`  ${slug}: no FAQ to correct`); continue; }
  let touched = 0;
  const faq = row.faq.map((item) => {
    for (const [re, q, a] of fixes) {
      if (re.test(String(item && item.q))) { touched++; return { q, a }; }
    }
    return item;
  });
  if (!touched) { console.log(`  ${slug}: FAQ already corrected`); continue; }
  await api(`blog_posts?slug=eq.${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify({ faq }) });
  console.log(`  ${slug}: ${touched} FAQ answer(s) corrected`);
}

/** Guides that were materially edited get their FAQ filled in (two had none). */
const GUIDE_FAQ = {
  'how-to-choose-cattle-trough-feed-water-setup': TROUGH_FAQ,
  'best-bird-feeder-buyers-guide': BIRD_FAQ,
};

for (const [slug, rules] of Object.entries(GUIDE_LINE_RULES)) {
  const [row] = await api(`blog_posts?select=slug,content,faq&slug=eq.${encodeURIComponent(slug)}`);
  if (!row) { console.log(`  ${slug}: NOT FOUND (skipped)`); continue; }
  const lines = String(row.content || '').split('\n');
  let touched = 0;
  const next = lines
    .map((line) => {
      for (const [re, make] of rules) {
        if (!re.test(line)) continue;
        const replacement = make();
        if (replacement === line) return line;
        touched++;
        return replacement;
      }
      return line;
    })
    .filter((line) => line !== null);
  const append = GUIDE_APPENDS[slug];
  if (append && !String(row.content || '').includes('## Compare before you buy')) {
    next.push(...append);
    touched++;
  }
  const faq = GUIDE_FAQ[slug];
  const needsFaq = faq && !(Array.isArray(row.faq) && row.faq.length);
  if (!touched && !needsFaq) { console.log(`  ${slug}: already corrected`); continue; }
  const body = { content: next.join('\n') };
  if (needsFaq) body.faq = faq;
  await api(`blog_posts?slug=eq.${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(body) });
  console.log(`  ${slug}: ${touched} line(s) corrected${needsFaq ? `, ${faq.length} FAQ answer(s) added` : ''}`);
}

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
// Only the COPY fields are checked — the slug legitimately keeps "50-gallon"
// (it is the indexed URL), so including it would rewrite the same copy on every
// run instead of reporting the row as already corrected.
const troughCopy = [trough.name, trough.seo_title, trough.seo_description, trough.short_description, trough.description].join(' ');
const conflicts = troughCopy.match(/50-gallon|50 gallon|60 ?cm/gi) || [];
if (conflicts.length) {
  await api('products?slug=eq.heavy-duty-cattle-feed-trough-50-gallon', {
    method: 'PATCH', body: JSON.stringify(TROUGH),
  });
  console.log(`heavy-duty-cattle-feed-trough-50-gallon: copy replaced (found ${conflicts.length} conflicting capacity mention(s))`);
} else {
  console.log('heavy-duty-cattle-feed-trough-50-gallon: no conflicting capacity claim left, unchanged');
}
