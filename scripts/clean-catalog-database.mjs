import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Missing Supabase credentials');

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

const curatedSlugs = new Set([
  'adjustable-pet-car-seatbelt-tether-2-pack',
  'bone-charm-pendant-necklace',
  'bungee-pet-car-seatbelt-leash',
  'cat-window-perch-suction-cup-hammock-seat-for-sunbathing',
  'ceramic-cat-face-food-bowl-easy-clean-pet-dish',
  'collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube',
  'cooling-pet-mat-ice-silk-cooling-pad-for-cats-dogs',
  'cozy-cat-nest-bed-round-plush-mat',
  'cute-cat-blankets-dog-pet-mat',
  'dog-bed',
  'dog-clothes-spring-and-summer-clothing',
  'dog-poop-bags-biodegradable-waste-bag-rolls',
  'dual-shoulder-pet-carrier-backpack',
  'foldable-pet-travel-carrier-backpack',
  'heavy-duty-cattle-feed-trough',
  'himalayan-30-lb-trace-mineral-salt-block',
  'himalayan-round-rope-salt-lick-6-lb-pack-of-4',
  'horse-fly-mask-with-ears',
  'no-pull-dog-harness-with-reflective-strips-front-back-clip',
  'nylon-anti-grind-dog-leash-collar',
  'nylon-training-collar-quick-release',
  'orthopedic-memory-foam-dog-bed',
  'outdoor-hanging-bird-feeder',
  'pet-shoes-wear-dog-shoes',
  'polka-dot-turtleneck-dog-sweater',
  'portable-livestock-water-trough-30-gallon',
  'retractable-dog-leash-5m-one-button-lock-with-anti-slip-grip',
  'silicone-feeding-placemat-dogs-cats',
  'silicone-flying-disc-dog-toy',
  'solar-bird-bath-fountain',
  'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs',
  'usb-rechargeable-pet-nail-grinder-quiet-motor-for-dogs-cats'
]);

async function cleanCatalog() {
  const res = await fetch(`${base}/rest/v1/products?select=id,slug,title,name,status,commerce_readiness`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const prods = await res.json();
  console.log('Total products in database:', prods.length);

  let archivedCount = 0;
  for (const p of prods) {
    if (!curatedSlugs.has(p.slug) && p.status === 'active') {
      console.log(`Archiving non-curated/supplier product: ${p.slug} | ${p.title || p.name}`);
      const patchRes = await fetch(`${base}/rest/v1/products?id=eq.${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'archived', commerce_readiness: null })
      });
      if (!patchRes.ok) {
        console.error('Failed to archive', p.slug, await patchRes.text());
      } else {
        archivedCount++;
      }
    }
  }
  console.log('Total supplier/stale products archived:', archivedCount);

  // Now fix specific contradictions:
  console.log('\nFixing dog-poop-bags contradiction (removing unverified biodegradable claims)...');
  const poopRes = await fetch(`${base}/rest/v1/products?slug=eq.dog-poop-bags-biodegradable-waste-bag-rolls`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      title: 'Dog Poop Bags — Durable Waste Bag Rolls (15 per Roll)',
      name: 'Dog Poop Bags — Durable Waste Bag Rolls (15 per Roll)',
      seo_title: 'Dog Poop Bags — Durable Waste Bag Rolls | Luxedge',
      seo_description: 'Durable dog waste bags on continuous rolls (15 per roll). Fits standard dispensers. Clean, leak-resistant, and easy to tear.',
      short_description: 'Dog waste bags on continuous rolls — 15 bags per roll, fits standard dispensers. Bag it and bin it responsibly.'
    })
  });
  console.log('Poop bags patch status:', poopRes.status);

  console.log('Fixing bone-charm-pendant-necklace seo_title (clearly identifying as dog owner jewellery)...');
  const boneRes = await fetch(`${base}/rest/v1/products?slug=eq.bone-charm-pendant-necklace`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      seo_title: 'Bone Charm Pendant Necklace for Dog Owners | Luxedge'
    })
  });
  console.log('Bone charm patch status:', boneRes.status);

  console.log('Fixing portable-livestock-water-trough-30-gallon consistency...');
  const waterRes = await fetch(`${base}/rest/v1/products?slug=eq.portable-livestock-water-trough-30-gallon`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      title: 'Portable Collapsible Livestock Water Trough — 30 Gallon',
      name: 'Portable Collapsible Livestock Water Trough — 30 Gallon',
      seo_title: 'Portable Collapsible Livestock Water Trough — 30 Gallon | Luxedge',
      seo_description: 'Portable 30-gallon collapsible livestock water trough for cattle, horses and goats. Durable heavy-duty PVC, folds flat for easy transport.',
      short_description: 'Large-capacity collapsible 30-gallon livestock water trough. Folds flat when empty for easy transport and paddock rotation.',
      description: 'A 30-gallon collapsible water trough designed for livestock rotational grazing, temporary paddocks, and travel.\n\n• 30-gallon capacity when expanded\n• Heavy-duty reinforced PVC construction with welded seams\n• Folds flat for compact transport and storage\n• Suitable for cattle, horses, goats, and sheep\n\nEnsure placement on level, clear ground free of sharp stones to prevent abrasion.'
    })
  });
  console.log('Water trough patch status:', waterRes.status);

  console.log('Catalogue DB cleaning completed successfully!');
}

cleanCatalog();
