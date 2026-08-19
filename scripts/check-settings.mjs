import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
if (fs.existsSync(path.join(__dirname, '..', '.env'))) for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, ''); const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };
for (const t of ['coupons','store_offers']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: HEAD });
  console.log(t.toUpperCase() + ':', await r.text());
}
