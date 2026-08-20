import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
if (fs.existsSync(path.join(__dirname, '..', '.env'))) for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const U = (env.VITE_SUPABASE_URL || '').replace(/\/$/, ''); const KEY = env.VITE_SUPABASE_ANON_KEY;
for (const t of ['product_images', 'product_variants', 'products']) {
  const r = await fetch(`${U}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  console.log(t, r.status, (await r.text()).slice(0, 150));
}
