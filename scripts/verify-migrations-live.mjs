// TEMP — verify 0011/0012/0013 against the LIVE DB. Deleted after run.
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const url = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const anon = env.VITE_SUPABASE_ANON_KEY;
const role = env.SUPABASE_SERVICE_ROLE_KEY;
const H = (k) => ({ apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' });

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// ---- 0011: anon image/variant visibility for ACTIVE products, hidden for DRAFT ----
try {
  const active = await (await fetch(`${url}/rest/v1/products?status=eq.active&select=id,name&limit=3`, { headers: H(anon) })).json();
  const draft = await (await fetch(`${url}/rest/v1/products?status=eq.draft&select=id,name&limit=2`, { headers: H(anon) })).json();
  check('0011: active products anon-readable', Array.isArray(active) && active.length >= 3, `${active.length} active`);

  // product_images for an ACTIVE product (RLS policy joins products.status in ('published','active'))
  const aid = active[0].id;
  const imgs = await (await fetch(`${url}/rest/v1/product_images?product_id=eq.${aid}&select=id,image_url&limit=10`, { headers: H(anon) })).json();
  check('0011: anon sees product_images for ACTIVE product', Array.isArray(imgs) && imgs.length >= 1, `${imgs.length} rows`);

  const vars = await (await fetch(`${url}/rest/v1/product_variants?product_id=eq.${aid}&select=id&limit=10`, { headers: H(anon) })).json();
  check('0011: anon can read product_variants for ACTIVE product', Array.isArray(vars), `${vars.length} rows`);

  if (draft.length) {
    const dImgs = await (await fetch(`${url}/rest/v1/product_images?product_id=eq.${draft[0].id}&select=id&limit=5`, { headers: H(anon) })).json();
    check('0011: DRAFT product images NOT exposed to anon', Array.isArray(dImgs) && dImgs.length === 0, `${dImgs.length} rows`);
  } else check('0011: draft-hidden check skipped', true, 'no draft products');

  // anon write attempt to product_images must fail
  const w = await fetch(`${url}/rest/v1/product_images`, { method: 'POST', headers: H(anon), body: JSON.stringify({ product_id: aid, image_url: 'https://x.test/x.jpg' }) });
  check('0011: anon CANNOT write product_images', [401, 403, 404].includes(w.status), `HTTP ${w.status}`);
} catch (e) { check('0011 suite', false, String(e).slice(0, 120)); }

// ---- 0012: Hermes tables exist, RLS admin-only, anon cannot write ----
for (const t of ['hermes_recommendations', 'hermes_seo_suggestions', 'hermes_marketing_intel', 'ads_readiness']) {
  const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, { headers: H(role) });
  check(`0012: ${t} exists`, r.status === 200, `HTTP ${r.status}`);
}
const w2 = await fetch(`${url}/rest/v1/hermes_recommendations`, { method: 'POST', headers: H(anon), body: JSON.stringify({}) });
check('0012: anon CANNOT write Hermes tables', [401, 403].includes(w2.status), `HTTP ${w2.status}`);
const w2r = await fetch(`${url}/rest/v1/hermes_recommendations`, { method: 'POST', headers: H(role), body: JSON.stringify({ product_name: '__probe__' }) });
check('0012: service-role write permitted (research-only table)', w2r.status === 201, `HTTP ${w2r.status}`);

// ---- 0013: luxedge_orders schema + constraints + RLS ----
const oa = await fetch(`${url}/rest/v1/luxedge_orders?select=*&limit=1`, { headers: H(role) });
check('0013: luxedge_orders exists', oa.status === 200, `HTTP ${oa.status}`);

const schema = await (await fetch(`${url}/`, { headers: H(role) })).json();
const defs = schema?.definitions || {};
const col = (n) => !!defs['luxedge_orders']?.properties?.[n];
check('0013: unique stripe_session_id column', col('stripe_session_id'));
check('0013: order_number column', col('order_number'));
check('0013: payment_intent column', col('stripe_payment_intent'));
check('0013: items jsonb column', col('items'));
check('0013: totals columns', col('subtotal') && col('discount') && col('shipping') && col('tax') && col('total'));

// anon write blocked
const w3 = await fetch(`${url}/rest/v1/luxedge_orders`, { method: 'POST', headers: H(anon), body: JSON.stringify({ order_number: 'X', items: [], subtotal: 0, total: 0 }) });
check('0013: anon CANNOT write luxedge_orders', [401, 403].includes(w3.status), `HTTP ${w3.status}`);

// real unique-constraint check: insert two rows with the SAME stripe_session_id via service role
const probeSession = 'cs_test_probe_' + Date.now();
const mk = () => ({ order_number: 'ORD-PROBE-' + Date.now(), customer_email: 'probe@test.local', items: [{ id: 'x', qty: 1, price: 1 }], subtotal: 1, discount: 0, shipping: 0, tax: 0, total: 1, currency: 'USD', status: 'paid', stripe_session_id: probeSession });
const i1 = await fetch(`${url}/rest/v1/luxedge_orders`, { method: 'POST', headers: H(role), body: JSON.stringify(mk()) });
const i2 = await fetch(`${url}/rest/v1/luxedge_orders`, { method: 'POST', headers: H(role), body: JSON.stringify(mk()) });
check('0013: stripe_session_id UNIQUE enforced', i1.status === 201 && i2.status === 409, `first=${i1.status} duplicate=${i2.status}`);
if (i1.status === 201) {
  const del = await fetch(`${url}/rest/v1/luxedge_orders?order_number=like.ORD-PROBE-*`, { method: 'DELETE', headers: H(role) });
  console.log('  cleanup probe rows ->', del.status);
}

// Hermes research tables cleanup of probe row
await fetch(`${url}/rest/v1/hermes_recommendations?product_name=eq.__probe__`, { method: 'DELETE', headers: H(role) });

const failed = results.filter((r) => !r.pass).length;
console.log(`\nTOTAL: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
