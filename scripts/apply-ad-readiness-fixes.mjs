// scripts/apply-ad-readiness-fixes.mjs
import fs from 'node:fs';

const envText = fs.readFileSync('.env', 'utf-8');
const getEnv = (k) => {
  const m = envText.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
};

const sbUrl = getEnv('VITE_SUPABASE_URL');
const sbKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!sbUrl || !sbKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

async function patchProduct(slug, fields) {
  const url = `${sbUrl}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to patch product ${slug}: ${res.status} ${err}`);
  }
  const data = await res.json();
  console.log(`✓ Patched product: ${slug} (${data.length} row updated)`);
}

async function patchBlogPost(slug, contentUpdater) {
  const getUrl = `${sbUrl}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}`;
  const getRes = await fetch(getUrl, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
  });
  const rows = await getRes.json();
  if (!rows.length) {
    console.warn(`! Blog post not found in DB: ${slug}`);
    return;
  }
  const post = rows[0];
  const newContent = contentUpdater(post.content || '');
  const patchUrl = `${sbUrl}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ content: newContent }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(`Failed to patch blog ${slug}: ${patchRes.status} ${err}`);
  }
  console.log(`✓ Patched blog post: ${slug}`);
}

async function main() {
  console.log('--- Applying Pre-Application AdSense Readiness Fixes to DB ---');

  // 1. Cattle Feed Trough
  await patchProduct('heavy-duty-cattle-feed-trough', {
    name: 'Heavy-Duty Poly Livestock Feed Trough for Cattle & Goats',
    title: 'Heavy-Duty Poly Livestock Feed Trough for Cattle & Goats',
    seo_title: 'Heavy-Duty Poly Livestock Feed Trough | Luxedge',
    short_description: 'Heavy-duty rectangular poly feed trough for cattle, goats, sheep and livestock. Durable outdoor construction with easy-clean interior and reinforced rim.',
    seo_description: 'Durable outdoor poly feed trough for cattle, goats, and livestock. Easy-clean smooth interior with reinforced edges for daily feeding on the farm.',
    description: `Built for farm and pasture use, this heavy-duty poly feed trough provides a durable feeding station for cattle, horses, goats, and sheep. The smooth, non-porous interior is easy to scrub clean between feedings to prevent feed from souring, and the reinforced poly construction resists cracking in outdoor weather conditions.\n\nSized for group pen and paddock feeding of dry feed, grain, pellets, or mineral mixes. Exact capacity and outer dimensions are not specified by the manufacturer — contact hello@luxedge.us before ordering if your setup requires verified measurements.`,
    specifications: {
      Material: 'Reinforced Polyethylene (Poly)',
      'Intended Animals': 'Cattle, Goats, Sheep, Horses, Livestock',
      'Primary Use': 'Dry grain, feed pellets, hay supplements, and mineral feeding',
      Structure: 'Rectangular open trough with reinforced rim',
      'Interior Finish': 'Smooth, non-porous easy-clean surface',
      Placement: 'Level ground in barns, pens, or outdoor paddocks',
      'Manufacturer Sizing': 'Sized for group pen feeding (exact dimensions unlisted)',
    },
    features: [
      'Durable all-weather polyethylene construction',
      'Smooth interior walls for quick wash-down between feedings',
      'Reinforced rim helps resist bending and animal nudging',
      'Suitable for group feeding of cattle, calves, goats, and sheep',
    ],
  });

  // 2. Bird Feeder
  await patchProduct('outdoor-hanging-bird-feeder', {
    specifications: {
      Material: 'Weather-resistant clear acrylic and protective poly roof',
      'Mounting Type': 'Hanging (top suspension loop for branches, poles, or hooks)',
      'Target Species': 'Cardinals, finches, chickadees, nuthatches, and backyard songbirds',
      'Seed Compatibility': 'Black-oil sunflower seed, mixed wild bird seed, safflower',
      'Refill Method': 'Removable roof cap for quick refilling and cleaning',
      Drainage: 'Built-in drainage points to help keep seed dry in rain',
      Capacity: 'Backyard feeder reservoir (approx. 1.5 to 2 cups seed capacity)',
    },
    features: [
      'Clear acrylic seed reservoir allows easy monitoring of feed levels at a distance',
      'Protective overhang roof helps shield seed from rain and snow',
      'Circular perch rail gives songbirds comfortable 360-degree feeding access',
      'Twist-off assembly simplifies routine cleaning and refilling',
    ],
  });

  // 3. Adjustable Car Restraint Tether (2-Pack)
  await patchProduct('adjustable-pet-car-seatbelt-tether-2-pack', {
    name: 'Adjustable Dog Car Restraint Tether — 2-Pack',
    title: 'Adjustable Dog Car Restraint Tether — 2-Pack',
    seo_title: 'Adjustable Dog Car Restraint Tether (2-Pack) | Luxedge',
    short_description: 'Two adjustable travel tethers designed to restrain pets in their seat and reduce driver distraction during vehicle trips.',
    seo_description: 'Two adjustable dog car restraint tethers that clip to a harness to reduce roaming and driver distraction. Note: travel restraint, not crash-tested.',
    description: `A two-pack of adjustable nylon vehicle tethers designed to restrain pets in their seat and minimize driver distraction while on the road.\n\n• Includes 2 adjustable travel tethers\n• Durable woven nylon webbing with universal vehicle buckle clip\n• Designed to attach exclusively to a chest harness (never attach to a neck collar)\n• Note: This is a vehicle travel restraint intended to reduce pet roaming and driver distraction; it is not an independently crash-tested safety device.`,
    specifications: {
      Quantity: '2 tethers per pack',
      Material: 'Heavy-duty woven nylon webbing with zinc alloy swivel snap hook',
      'Attachment Method': 'Universal seatbelt buckle tab into vehicle seatbelt receptacle',
      'Harness Requirement': 'Must be clipped to a body harness (never attach to a neck collar)',
      Adjustment: 'Adjustable slide buckle to set pet reach in the back seat',
      'Safety Disclosure': 'Travel distraction restraint only; not an independently crash-tested safety device',
    },
    features: [
      '2-pack provides restraints for multiple vehicles or multiple pets',
      'Helps keep pets in their designated back-seat area to minimize driver distraction',
      'Universal 0.82-inch seatbelt clip fits most standard automotive buckles',
      '360-degree swivel carabiner prevents tether twisting when pets shift position',
    ],
  });

  // 4. Bungee Pet Car Tether
  await patchProduct('bungee-pet-car-seatbelt-leash', {
    name: 'Bungee Dog Car Restraint Tether — Elastic Travel Leash',
    title: 'Bungee Dog Car Restraint Tether — Elastic Travel Leash',
    seo_title: 'Bungee Dog Car Restraint Tether — Travel Leash | Luxedge',
    short_description: 'Elastic shock-absorbing vehicle restraint tether for dogs and cats to reduce roaming and driver distraction on car trips.',
    seo_description: 'Elastic shock-absorbing car restraint tether that clips to a harness to reduce pet roaming and driver distraction during vehicle travel.',
    description: `An elastic bungee travel tether designed to help keep dogs and cats restrained in their seat area during vehicle trips.\n\n• Shock-absorbing elastic bungee section cushions sudden vehicle movements\n• Heavy-duty swivel snap hook connects to a body harness (never attach to a collar)\n• Universal seatbelt tab fits most standard vehicle buckle receptacles\n• Note: This product is designed to keep pets seated and reduce driver distraction; it is not an independently certified crash-protection restraint.`,
    specifications: {
      Material: 'High-density nylon webbing with integrated elastic bungee buffer',
      Hardware: 'Zinc alloy 360-degree swivel snap and standard car buckle clip',
      'Attachment Requirement': 'Chest harness attachment only (do not clip to neck collars)',
      Function: 'Vehicle seat restraint to reduce driver distraction and roaming',
      'Safety Disclosure': 'Travel restraint only; not an independently certified crash-protection device',
    },
    features: [
      'Shock-absorbing bungee buffer dampens sudden movements during turns or braking',
      'Universal buckle insert clicks into most standard vehicle seatbelt slots',
      'Sturdy swivel snap prevents tangling when your dog changes sitting position',
      'Keeps pets securely in the back seat away from steering and driver foot controls',
    ],
  });

  // 5. No-Pull Dog Harness
  await patchProduct('no-pull-dog-harness-with-reflective-strips-front-back-clip', {
    specifications: {
      Material: 'Durable Oxford nylon outer with padded, breathable air-mesh lining',
      'Attachment Points': '2 sturdy metal D-rings (chest front ring for no-pull steering; top back ring for casual walks)',
      Adjustability: '4 fully adjustable slide straps (2 neck, 2 chest) for customized fit',
      Buckles: '2 quick-release side snap buckles for easy on-off over the head',
      Visibility: 'Reflective 3M nylon stitching along all straps and chest plate for night walks',
      'Care Instructions': 'Hand wash with mild soap in lukewarm water; air dry away from direct heat',
      Suitability: 'Small, medium, and large dogs learning leash manners or walking in low light',
    },
    features: [
      'Dual-leash attachment: front D-ring gently redirects pulling dogs sideways toward you',
      'Breathable padded mesh lining prevents chafing behind front armpits and along ribs',
      '4-point adjustment system ensures a snug, secure fit without restricting shoulder movement',
      'Bright reflective trim enhances visibility for evening and early-morning walks',
      'Sturdy back grab handle allows quick control when assisting dogs over obstacles',
    ],
  });

  // 6. Blog Posts — Add Sources & Further Reading
  const carSafetySources = `\n\n## Sources and further reading\n\n- **American Veterinary Medical Association (AVMA):** *Traveling with Your Pet FAQ — Restraint Recommendations & Airbag Dangers* (avma.org)\n- **Center for Pet Safety (CPS):** *Harness and Travel Crate Crash-Testing Standards and Research* (centerforpetsafety.org)\n- **National Highway Traffic Safety Administration (NHTSA):** *Driver Distraction and Unrestrained Animal Hazard Statistics* (nhtsa.gov)\n- **Humane Society of the United States:** *Traveling by Car with Pets: Guidelines for Safe Road Trips* (humanesociety.org)`;

  await patchBlogPost('dog-car-safety-seat-belt-guide', (content) => {
    if (content.includes('## Sources and further reading')) return content;
    return content + carSafetySources;
  });

  const harnessSources = `\n\n## Sources and further reading\n\n- **Association of Professional Dog Trainers (APDT):** *Canine Equipment Selection and Fitting Guide* (apdt.com)\n- **American College of Veterinary Behaviorists (ACVB):** *Humane Restraint Equipment and Pulling Management* (dacvb.org)\n- **Royal Society for the Prevention of Cruelty to Animals (RSPCA):** *Dog Walking Equipment: Choosing Collars, Leads, and Harnesses* (rspca.org.uk)`;

  await patchBlogPost('how-to-fit-no-pull-dog-harness', (content) => {
    if (content.includes('## Sources and further reading')) return content;
    return content + harnessSources;
  });

  const birdFeederSources = `\n\n## Sources and further reading\n\n- **Cornell Lab of Ornithology (Project FeederWatch):** *Feeder Cleaning Routine and Disease Prevention in Backyard Birds* (feederwatch.org)\n- **U.S. Geological Survey (USGS) National Wildlife Health Center:** *Wildlife Health Bulletin: Salmonellosis and Feeder Hygiene Protocols* (nwhc.usgs.gov)\n- **National Audubon Society:** *How to Clean Your Bird Feeder to Protect Wild Birds* (audubon.org)`;

  await patchBlogPost('how-to-clean-a-bird-feeder', (content) => {
    if (content.includes('## Sources and further reading')) return content;
    return content + birdFeederSources;
  });

  const cattleTroughSources = `\n\n## Sources and further reading\n\n- **USDA Natural Resources Conservation Service (NRCS):** *Conservation Practice Standard: Watering Facility (Code 614)* (nrcs.usda.gov)\n- **Texas A&M AgriLife Extension:** *Water and Feed Trough Management for Beef Cattle and Small Ruminants* (agrilifeextension.tamu.edu)\n- **University of Missouri Extension:** *Livestock Water Requirements and Stock Tank Sizing Considerations* (extension.missouri.edu)`;

  await patchBlogPost('how-to-choose-cattle-trough-feed-water-setup', (content) => {
    if (content.includes('## Sources and further reading')) return content;
    return content + cattleTroughSources;
  });

  console.log('\n--- All DB updates completed successfully! ---');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
