// Verify migration 0015 against the LIVE database (owner says applied).
// Tests: table + 3 RPCs exist; anon/authenticated blocked; service-role
// round-trips (reserve→consume, reserve→release), idempotent duplicates,
// expired-sweep; then restores EVERY product's inventory to its starting
// value and deletes all test reservation rows.
import { readFileSync } from 'node:fs';
const envRaw = readFileSync('.env', 'utf8');
const get = (k) => {
  const m = envRaw.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};
const base = (get('VITE_SUPABASE_URL') || '').replace(/\/$/, '');
const service = get('SUPABASE_SERVICE_ROLE_KEY');
const anon = get('VITE_SUPABASE_ANON_KEY');

async function jfetch(path, key, opts = {}) {
  const res = await fetch(`${base}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const rpc = (fn, body, key = service) => jfetch(`/rpc/${fn}`, key, { method: 'POST', body });

const out = {};
const cleanup = []; // {reservationId} rows to delete
const restore = []; // {id, qty} inventory to restore

// 1. Pick TWO real ACTIVE products with tracked inventory.
const prods = await jfetch('/products?status=eq.active&inventory_qty=not.is.null&inventory_qty=gt.0&select=id,name,inventory_qty&limit=2&order=inventory_qty.desc', service);
if (!prods.ok || !Array.isArray(prods.data) || prods.data.length < 2) {
  console.log('PRODUCTS:', JSON.stringify(prods));
  process.exit(2);
}
const [P, Q] = prods.data;
out.products = prods.data.map((p) => ({ id: p.id, name: p.name, initialQty: p.inventory_qty }));

// 2. Table exists + RLS: anon read blocked.
const anonRead = await jfetch('/inventory_reservations?select=id&limit=1', anon);
out.anon_read = { status: anonRead.status, ok: anonRead.ok };
const anonWrite = await jfetch('/inventory_reservations', anon, { method: 'POST', body: { reservation_id: crypto.randomUUID(), product_id: P.id, quantity: 1, expires_at: new Date(Date.now() + 3600_000).toISOString() } });
out.anon_write = { status: anonWrite.status, ok: anonWrite.ok };

// 3. anon/authenticated blocked on the 3 RPCs.
out.anon_rpc = {};
for (const fn of ['reserve_inventory', 'consume_reservation', 'release_reservation']) {
  const r = await rpc(fn, { p_reservation_id: crypto.randomUUID(), p_product_id: P.id, p_quantity: 1, p_expires_at: new Date(Date.now() + 3600_000).toISOString() }, anon);
  out.anon_rpc[fn] = { status: r.status, ok: r.ok };
}

// 4. ROUND-TRIP A — reserve → consume on product P.
const resA = crypto.randomUUID();
const expA = new Date(Date.now() + 24 * 3600_000).toISOString();
const r1 = await rpc('reserve_inventory', { p_reservation_id: resA, p_product_id: P.id, p_quantity: 1, p_expires_at: expA });
out.reserve_ok = r1.data;
const qtyAfterReserve = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_reserve = qtyAfterReserve;
// duplicate reserve (same reservation+product) → already:true, no double reduction
const r1b = await rpc('reserve_inventory', { p_reservation_id: resA, p_product_id: P.id, p_quantity: 1, p_expires_at: expA });
out.reserve_duplicate = r1b.data;
const qtyAfterDup = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_duplicate_reserve = qtyAfterDup;
// consume
const c1 = await rpc('consume_reservation', { p_reservation_id: resA });
out.consume_ok = c1.data;
const qtyAfterConsume = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_consume = qtyAfterConsume; // must equal qtyAfterReserve (consume = status flip, no change)
// consume again → idempotent (consumed=0, group_size=1)
const c1b = await rpc('consume_reservation', { p_reservation_id: resA });
out.consume_duplicate = c1b.data;
const qtyAfterDupConsume = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_duplicate_consume = qtyAfterDupConsume;
// restore product P + mark reservation row for deletion
restore.push({ id: P.id, qty: P.inventory_qty });
cleanup.push({ reservationId: resA });

// 5. ROUND-TRIP B — reserve → release on product Q (stock must be restored exactly).
const resB = crypto.randomUUID();
const r2 = await rpc('reserve_inventory', { p_reservation_id: resB, p_product_id: Q.id, p_quantity: 1, p_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
out.reserveB = r2.data;
const qtyAfterReserveB = (await jfetch(`/products?id=eq.${Q.id}&select=inventory_qty`, service)).data[0].inventory_qty;
// release
const l1 = await rpc('release_reservation', { p_reservation_id: resB });
out.release_ok = l1.data;
const qtyAfterRelease = (await jfetch(`/products?id=eq.${Q.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_release = qtyAfterRelease;
// release again → idempotent (released=0)
const l1b = await rpc('release_reservation', { p_reservation_id: resB });
out.release_duplicate = l1b.data;
const qtyAfterDupRelease = (await jfetch(`/products?id=eq.${Q.id}&select=inventory_qty`, service)).data[0].inventory_qty;
out.qty_after_duplicate_release = qtyAfterDupRelease;
out.release_restored_exactly = qtyAfterRelease === Q.inventory_qty && qtyAfterDupRelease === Q.inventory_qty;
cleanup.push({ reservationId: resB });

// 6. EXPIRED SWEEP — a past-due hold is released + stock restored by the next reserve call.
const resC = crypto.randomUUID();
const r3 = await rpc('reserve_inventory', { p_reservation_id: resC, p_product_id: P.id, p_quantity: 1, p_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
out.reserveC = r3.data;
const qtyAfterReserveC = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
// age the reservation into the past (simulates 24h passing)
const aged = await jfetch('/inventory_reservations?reservation_id=eq.' + resC, service, {
  method: 'PATCH',
  body: { expires_at: new Date(Date.now() - 3600_000).toISOString() },
  prefer: 'return=representation',
});
out.age_ok = aged.ok;
// trigger a sweep via a fresh reserve on product Q (any tracked product)
const resD = crypto.randomUUID();
await rpc('reserve_inventory', { p_reservation_id: resD, p_product_id: Q.id, p_quantity: 1, p_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
const qtyAfterSweep = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0].inventory_qty;
const sweptRow = (await jfetch(`/inventory_reservations?reservation_id=eq.${resC}&select=status`, service)).data[0];
out.expired_sweep = { qty_after_sweep: qtyAfterSweep, row_status: sweptRow ? sweptRow.status : null, restored: qtyAfterSweep === qtyAfterReserveC };
cleanup.push({ reservationId: resC });
cleanup.push({ reservationId: resD }); // resD holds 1 on Q → release it before restore
// resD held 1 on Q → restore Q once more at the end via inventory restore
restore.push({ id: Q.id, qty: Q.inventory_qty });

// 7. CLEANUP — delete all test reservation rows + restore inventory to start values.
let deleted = 0;
for (const { reservationId } of cleanup) {
  const d = await jfetch(`/inventory_reservations?reservation_id=eq.${reservationId}`, service, { method: 'DELETE' });
  if (d.ok) deleted += 1;
}
out.cleanup = { reservationRowsDeleted: deleted, of: cleanup.length };
for (const { id, qty } of restore) {
  await jfetch(`/products?id=eq.${id}`, service, { method: 'PATCH', body: { inventory_qty: qty, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
}
const finalP = (await jfetch(`/products?id=eq.${P.id}&select=inventory_qty`, service)).data[0];
const finalQ = (await jfetch(`/products?id=eq.${Q.id}&select=inventory_qty`, service)).data[0];
out.restored = { P: finalP.inventory_qty === P.inventory_qty, Q: finalQ.inventory_qty === Q.inventory_qty };
out.residual = (await jfetch('/inventory_reservations?select=id&limit=5', service)).data;

console.log(JSON.stringify(out, null, 2));
