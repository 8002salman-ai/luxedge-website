import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Missing Supabase credentials');

const HEAD = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

// 1. Bird Feeder
console.log('Updating outdoor-hanging-bird-feeder...');
const birdRes = await fetch(`${base}/rest/v1/products?slug=eq.outdoor-hanging-bird-feeder`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    description: 'Attract wild birds to your backyard with this clear hanging acrylic bird feeder. Features a protective rain guard roof, easy-fill top, and perching rail for garden birds.\n\n• Clear acrylic seed reservoir for easy monitoring of food levels\n• Protective roof helps shield seed from rain\n• Twist-off base for straightforward refilling and routine cleaning\n• Suitable for mixed wild bird seed, sunflower seeds, and safflower\n\nHang securely from a sturdy branch, pole, or bracket at least 5 feet off the ground.',
    short_description: 'Weather-resistant hanging acrylic bird feeder with rain guard roof and easy-fill top.'
  })
});
console.log('Bird feeder update status:', birdRes.status);

// 2. Heavy-Duty Cattle Feed Trough
console.log('Updating heavy-duty-cattle-feed-trough...');
const troughDesc = 'A heavy-duty poly feed trough for cattle and goats, suited to group feeding in a pen, paddock or barn.\n\n• Rectangular 60cm poly trough with a smooth, easy-clean interior\n• Reinforced edges for outdoor farm use\n• Suited for grain, pellets, and dry livestock feed rations\n• Suitable for cattle, calves, goats, and sheep\n\nEnsure placement on level, firm ground. Wash and dry between feed refills to prevent residue buildup.';
const troughRes = await fetch(`${base}/rest/v1/products?slug=eq.heavy-duty-cattle-feed-trough`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    title: 'Heavy-Duty Poly Livestock Feed Trough — 60cm Feeder for Cattle & Goats',
    name: 'Heavy-Duty Poly Livestock Feed Trough — 60cm Feeder for Cattle & Goats',
    description: troughDesc,
    long_description: troughDesc,
    short_description: 'Heavy-duty 60cm rectangular poly feed trough for cattle and goats. Easy-clean smooth interior with reinforced edges.',
    seo_keywords: ['cattle feed trough', 'livestock feed trough', 'poly feed trough', 'farm feed trough', 'cattle feeding equipment']
  })
});
console.log('Cattle feed trough update status:', troughRes.status);

// 3. Portable Livestock Water Trough 30 Gallon
console.log('Updating portable-livestock-water-trough-30-gallon image...');
const waterTroughImg = 'https://luxedge.us/images/products/portable-livestock-water-trough-30-gallon.jpg';
const waterRes = await fetch(`${base}/rest/v1/products?slug=eq.portable-livestock-water-trough-30-gallon`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    image_url: waterTroughImg
  })
});
console.log('Water trough product update status:', waterRes.status);
const waterData = await waterRes.json();
if (waterData[0]?.id) {
  const imgPatch = await fetch(`${base}/rest/v1/product_images?product_id=eq.${waterData[0].id}`, {
    method: 'PATCH',
    headers: HEAD,
    body: JSON.stringify({
      url: waterTroughImg,
      public_url: waterTroughImg,
      alt_text: 'Portable Collapsible 30-Gallon Livestock Water Trough'
    })
  });
  console.log('Water trough product_images update status:', imgPatch.status);
}

// 4. Cat Window Perch
console.log('Updating cat-window-perch-suction-cup-hammock-seat-for-sunbathing...');
const perchRes = await fetch(`${base}/rest/v1/products?slug=eq.cat-window-perch-suction-cup-hammock-seat-for-sunbathing`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    title: 'Suction Cup Window Perch Hammock Seat for Cats — Sunbathing Lounger',
    name: 'Suction Cup Window Perch Hammock Seat for Cats — Sunbathing Lounger',
    description: 'A suction-mounted window hammock that gives an adult cat a raised, sunny place to rest without taking up floor space.\n\n• Mounts to smooth, non-porous glass with strong suction cups — no drilling\n• Breathable mesh fabric cover that is easy to remove and wipe clean\n• Simple assembly with support cables\n• Suitable for standard adult cats up to 25 lbs\n\nEnsure glass is thoroughly cleaned and dried before pressing suction cups firmly to remove all air pockets.',
    short_description: 'Suction-mounted window hammock seat for cats. Sturdy suction cups, breathable mesh cover, no drilling required.'
  })
});
console.log('Cat perch update status:', perchRes.status);

// 5. Dog Bed
console.log('Updating dog-bed...');
const bedRes = await fetch(`${base}/rest/v1/products?slug=eq.dog-bed`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    title: 'Plush Bolster Comfort Bed for Dogs & Cats',
    name: 'Plush Bolster Comfort Bed for Dogs & Cats',
    description: 'A soft, plush bolster bed providing dogs and cats with a comfortable, warm spot to curl up and sleep.\n\n• Raised bolster edges provide head and neck support\n• Soft plush fabric with cushioned polyfill base\n• Machine washable on gentle cycle, air dry\n• Dimensions: approx. 24 x 18 inches, suitable for small to medium dogs and cats up to 25 lbs\n\nPlace on a flat floor away from drafts.',
    short_description: 'Plush bolster comfort bed with raised rim for head and neck support. Soft fabric, machine washable.'
  })
});
console.log('Dog bed update status:', bedRes.status);

// 6. Blog Posts
console.log('Updating blog posts in Supabase...');
// Cattle trough blog hero image
const blogCattleRes = await fetch(`${base}/rest/v1/blog_posts?slug=eq.how-to-choose-cattle-trough-feed-water-setup`, {
  method: 'PATCH',
  headers: HEAD,
  body: JSON.stringify({
    hero_image_url: 'https://images.pexels.com/photos/422218/pexels-photo-422218.jpeg?auto=compress&cs=tinysrgb&w=800'
  })
});
console.log('Cattle blog update status:', blogCattleRes.status);

// Horse halter blog post - fetch existing and update content
const halterRes = await fetch(`${base}/rest/v1/blog_posts?slug=eq.horse-halter-lead-rope-buyers-guide`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
const halterData = await halterRes.json();
if (halterData[0]) {
  const updatedContent = halterData[0].content.replace(
    /The \[Adjustable Nylon Horse Halter with Lead Rope\]\(\/product\/adjustable-nylon-horse-halter-lead-rope\) is one current listing; confirm its own sizing and material details before ordering\./g,
    'For current horse essentials, browse our [Horse Supplies](/category/horse) collection and compare options like the [Horse Fly Mask with Ears](/product/horse-fly-mask-with-ears).'
  ).replace(
    /\*\*Related product → \[Adjustable Nylon Horse Halter with Lead Rope\]\(\/product\/adjustable-nylon-horse-halter-lead-rope\)\*\*/g,
    '**Related product → [Horse Fly Mask with Ears](/product/horse-fly-mask-with-ears)**'
  );

  const halterPatch = await fetch(`${base}/rest/v1/blog_posts?slug=eq.horse-halter-lead-rope-buyers-guide`, {
    method: 'PATCH',
    headers: HEAD,
    body: JSON.stringify({ content: updatedContent })
  });
  console.log('Horse halter blog update status:', halterPatch.status);
}

console.log('All Supabase database updates completed successfully.');
