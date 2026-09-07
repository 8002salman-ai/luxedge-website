// ============================================================================
// LUXEDGE — Admin: Pet Gift Drop management
//
//   GET  /api/admin/gift-drop            → campaign config + claims ledger
//   POST /api/admin/gift-drop            → actions:
//        { action:'campaign', ...fields }          update campaign config
//        { action:'update-status', id, status }    advance claim status
//        { action:'cancel', id }                   cancel claim (frees slot)
//        { action:'tracking', id, carrier, number } persist tracking
//
// Admin-authenticated (requireAdmin). Reads/writes the SAME luxedge_orders
// rows the public claim flow creates — one order system, no duplication.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  GIFT_MARKER,
  GIFT_CAMPAIGN_KEY,
  GIFT_STATUS_FLOW,
  giftGiftData,
  giftAddress,
  loadCampaign as loadCfg,
  saveCampaign as saveCfg,
  liveRemaining as countRemaining,
} from '../_lib/gift-drop.js';

const envUrl = () => (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const envKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
function headers() {
  const key = envKey();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Row → admin-friendly claim view
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClaimView(row: any) {
  const g = giftGiftData(row);
  const a = giftAddress(row);
  const line = Array.isArray(row.items) && row.items.length ? row.items[0] : undefined;
  return {
    id: row.id,
    orderNumber: row.order_number,
    email: row.customer_email,
    name: row.customer_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    address: a,
    petType: g.petType || '',
    petName: g.petName || '',
    petSize: g.petSize || '',
    petInterest: g.petInterest || '',
    giftName: (line && (line.name || '')) || '',
    giftValueCents: Number(line && line.valueCents) || 0,
    payment: g.payment || 'NOT_REQUIRED',
    source: g.source || 'web',
    marketingOptIn: !!g.marketingOptIn,
    isTest: !!g.isTest,
    emailSent: g.emailSent === true,
    emailNote: g.emailNote || '',
    tracking: g.tracking || null,
    totalCents: Math.round((Number(row.total) || 0) * 100),
    currency: row.currency || 'USD',
  };
}

export async function listClaims(): Promise<ReturnType<typeof toClaimView>[]> {
  const url = envUrl();
  const key = envKey();
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?select=*&coupon_code=eq.${encodeURIComponent(GIFT_MARKER)}&order=created_at.desc&limit=300`,
      { headers: headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map(toClaimView);
  } catch {
    return [];
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const url = envUrl();
  const key = envKey();
  if (!url || !key) {
    sendJson(res, 502, { error: 'Database is not configured on this deployment.' });
    return;
  }

  // ----------------------------------------------------------------- GET
  if (req.method === 'GET') {
    const cfg = await loadCfg();
    const claims = await listClaims();
    const total = Math.max(Number(cfg?.totalQuantity) || 0, 0);
    const remaining = await countRemaining(total);
    const campaign = cfg
      ? {
          title: String(cfg.title || 'Luxedge Pet Gift Drop'),
          message: String(cfg.message || ''),
          giftName: String(cfg.giftName || ''),
          giftValueCents: Math.max(Number(cfg.giftValueCents) || 0, 0),
          totalQuantity: total,
          active: !!cfg.active,
          startsAt: cfg.startsAt || null,
          endsAt: cfg.endsAt || null,
        }
      : null;
    sendJson(res, 200, { campaign, claims, stats: { total, remaining } });
    return;
  }

  // ----------------------------------------------------------------- POST
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const action = String(body.action || '');

  // ---- campaign config ----------------------------------------------------
  if (action === 'campaign') {
    const cfg = await loadCfg();
    const next: Record<string, unknown> = {
      ...(cfg || {}),
      key: GIFT_CAMPAIGN_KEY,
      title: String(body.title ?? cfg?.title ?? 'Luxedge Pet Gift Drop').slice(0, 120),
      message: String(body.message ?? cfg?.message ?? '').slice(0, 600),
      giftName: String(body.giftName ?? cfg?.giftName ?? '').slice(0, 200),
      giftValueCents: Math.max(Number(body.giftValueCents ?? cfg?.giftValueCents ?? 0) || 0, 0),
      totalQuantity: Math.max(Math.trunc(Number(body.totalQuantity ?? cfg?.totalQuantity ?? 0)) || 0, 0),
      active: body.active !== undefined ? !!body.active : !!cfg?.active,
      startsAt: body.startsAt ?? cfg?.startsAt ?? null,
      endsAt: body.endsAt ?? cfg?.endsAt ?? null,
    };
    // Inventory is derived from live claim counts — only clamp the config total.
    const ok = await saveCfg(next);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, campaign: next } : { error: 'Could not save campaign.' });
    return;
  }

  // ---- claim actions ------------------------------------------------------
  const id = String(body.id || '');
  if (!id) {
    sendJson(res, 400, { error: 'Missing claim id.' });
    return;
  }
  const rowRes = await fetch(`${url}/rest/v1/luxedge_orders?select=*&id=eq.${id}&limit=1`, {
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!rowRes.ok) {
    sendJson(res, 502, { error: 'Could not read the claim.' });
    return;
  }
  const rows = (await rowRes.json()) as Array<Record<string, unknown>>;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || row.coupon_code !== GIFT_MARKER) {
    sendJson(res, 404, { error: 'Claim not found.' });
    return;
  }

  const current = String(row.status || '');
  const patch = async (fields: Record<string, unknown>) => {
    const r = await fetch(`${url}/rest/v1/luxedge_orders?id=eq.${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  };

  if (action === 'cancel') {
    if (current === 'cancelled') {
      sendJson(res, 400, { error: 'This claim is already cancelled.' });
      return;
    }
    if (!['pending', 'processing'].includes(current)) {
      sendJson(res, 400, { error: 'Only unshipped claims can be cancelled.' });
      return;
    }
    const ok = await patch({ status: 'cancelled' });
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, id, status: 'cancelled' } : { error: 'Could not cancel the claim.' });
    return;
  }

  if (action === 'update-status') {
    const next = String(body.status || '');
    if (!(GIFT_STATUS_FLOW[current] || []).includes(next)) {
      sendJson(res, 400, { error: `Cannot move a claim from "${current}" to "${next}".` });
      return;
    }
    const ok = await patch({ status: next });
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, id, status: next } : { error: 'Could not update the claim.' });
    return;
  }

  if (action === 'tracking') {
    const carrier = String(body.carrier || '').slice(0, 60);
    const number = String(body.number || '').slice(0, 80);
    if (!number) {
      sendJson(res, 400, { error: 'Tracking number is required.' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = (row.shipping_address as any) || {};
    const ok = await patch({
      shipping_address: { ...sa, _gift: { ...((sa._gift as object) || {}), tracking: { carrier, number } } },
    });
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, id, tracking: { carrier, number } } : { error: 'Could not save tracking.' });
    return;
  }

  sendJson(res, 400, { error: `Unknown action "${action}".` });
}
