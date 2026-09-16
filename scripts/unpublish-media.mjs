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

// Find published media rows
const getRes = await fetch(`${base}/rest/v1/media_videos?select=id,slug,status&status=eq.published`, { headers: HEAD });
const published = await getRes.json();
console.log('Found published media rows:', published.length);

if (published.length > 0) {
  const patchRes = await fetch(`${base}/rest/v1/media_videos?status=eq.published`, {
    method: 'PATCH',
    headers: HEAD,
    body: JSON.stringify({ status: 'draft' }),
  });
  if (!patchRes.ok) {
    console.error('Failed to unpublish media:', patchRes.status, await patchRes.text());
  } else {
    const updated = await patchRes.json();
    console.log('Successfully set status=draft for:', updated.map(u => u.slug));
  }
}

// Re-verify counts
const verifyRes = await fetch(`${base}/rest/v1/media_videos?select=id,slug,status`, { headers: HEAD });
const rows = await verifyRes.json();
console.log('Final media_videos counts by status:', rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}));
