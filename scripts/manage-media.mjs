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

const res = await fetch(`${base}/rest/v1/media_videos?select=id,slug,status,title`, { headers: HEAD });
const rows = await res.json();
console.log('Total media_videos in Supabase:', rows.length);
const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
console.log('Status counts:', counts);

const published = rows.filter(r => r.status === 'published');
console.log('Published titles:', published.map(r => `${r.slug} (${r.title})`));
