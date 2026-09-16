import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map((line) => {
  const i = line.indexOf('=');
  return i < 0 ? [] : [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '').trim()];
}));
const base = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const changes = {
  'orthopedic-memory-foam-dog-bed-joint-support-for-senior-large-dogs': {
    short_description: 'Orthopedic dog bed with memory foam base, inner lining and removable washable cover. Designed for senior and large dogs.',
  },
  'spot-pet-mat-waterproof-and-easy-to-clean-silicone-dog-mat-cat-mat-square-pet-placemat-pet-supplies-3': {
    name: 'Easy-Clean Non-Slip Silicone Feeding Placemat for Dogs & Cats',
    short_description: 'Easy-to-clean silicone placemat for food and water bowls.',
    description: 'A silicone placemat that helps contain spills around food and water bowls. Check the stated size and care instructions before ordering.',
    seo_title: 'Easy-Clean Silicone Pet Placemat | Luxedge',
    seo_description: 'Easy-to-clean silicone pet placemat for containing spills around food and water bowls.',
  },
};
for (const [slug, patch] of Object.entries(changes)) {
  const response = await fetch(`${base}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`${slug}: ${response.status} ${await response.text()}`);
  console.log(`Updated ${slug}`);
}
