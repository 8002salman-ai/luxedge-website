import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i >= 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const HEAD = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const updates = [
  {
    slug: 'heavy-duty-cattle-feed-trough',
    image_url: 'https://images.pexels.com/photos/422218/pexels-photo-422218.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    slug: 'portable-livestock-water-trough-30-gallon',
    image_url: 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Cattle_water_trough_-_geograph.org.uk_-_747178.jpg',
  },
];

for (const u of updates) {
  const res = await fetch(`${base}/rest/v1/products?slug=eq.${u.slug}`, {
    method: 'PATCH',
    headers: HEAD,
    body: JSON.stringify({ image_url: u.image_url }),
  });
  if (!res.ok) {
    console.error(`Failed to update ${u.slug}:`, res.status, await res.text());
  } else {
    const data = await res.json();
    console.log(`Updated ${u.slug} image to:`, data[0]?.image_url);
  }
}
