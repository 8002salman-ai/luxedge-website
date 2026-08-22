import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const SUPABASE_URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_URL or KEY'); process.exit(1); }

function supabasePost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new globalThis.URL(path, SUPABASE_URL);
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = new globalThis.URL(path, SUPABASE_URL);
    https.get(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    }).on('error', reject);
  });
}

// Check if table exists
console.log('Checking if app_settings table exists...');
const check = await supabaseGet('/rest/v1/app_settings?select=key&limit=1');
console.log('Status:', check.status);
if (check.status === 200) {
  console.log('✅ Table already exists!');
  process.exit(0);
}

console.log('Table not found. Creating via SQL...');

// Try exec_sql RPC
const sql = `CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.app_settings TO service_role;
GRANT ALL ON public.app_settings TO authenticated;`;

const rpc = await supabasePost('/rest/v1/rpc/exec', { query: sql });
console.log('RPC exec:', rpc.status, rpc.body.substring(0, 200));

if (rpc.status !== 200) {
  // Try exec_sql
  const rpc2 = await supabasePost('/rest/v1/rpc/exec_sql', { sql });
  console.log('RPC exec_sql:', rpc2.status, rpc2.body.substring(0, 200));
}

// Verify
const verify = await supabaseGet('/rest/v1/app_settings?select=key&limit=1');
console.log('Verify:', verify.status);
if (verify.status === 200) {
  console.log('✅ app_settings table created successfully!');
} else {
  console.log('⚠️  Table may not exist. Run this SQL in Supabase SQL Editor:');
  console.log(sql);
}
