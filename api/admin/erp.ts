// ============================================================================
// LUXEDGE — /api/admin/erp  (Embani ERP sync — server-side only)
//
// The admin browser NEVER talks to the ERP webhook directly. This endpoint is
// the only component that holds the webhook URL + API token (env vars win,
// app_settings as the owner-attachable fallback), calls Embani ERP, and
// records a sync ledger so we always know which Luxedge orders were
// transmitted.
//
//   GET /api/admin/erp
//       → { webhook: { configured, masked, source }, token: {...},
//           sync: { [order_number]: { status, synced_at, error? } } }
//       NEVER returns the raw token or the full webhook URL.
//
//   POST /api/admin/erp
//       { action: 'set',   field: 'webhook'|'token', value }  → store server-side
//       { action: 'clear', field: 'webhook'|'token' }         → remove attached value
//       { action: 'test' }                                    → harmless ERP probe
//       { action: 'push' }                                    → sync real orders
//
// PUSH CONTRACT (Luxedge → Embani ERP webhook):
//   POST <webhook>  Authorization: Bearer <token>
//   { app: 'luxedge', event: 'orders.sync', sent_at, orders: [Order...] }
//
//   Order normalization (stable, never re-created):
//     source, order_id, order_number (STABLE — reused on retry so ERP can
//     reconcile instead of duplicating), stripe_session_id,
//     stripe_payment_intent, created_at, currency, subtotal, shipping, tax,
//     discount, total, payment_status, fulfillment_status, coupon_code,
//     customer { name, email }, shipping_address, items[{ product_id, sku,
//     name, quantity, unit_price, line_total }]
//
//   Response parsing (lenient — handles several ERP shapes):
//     { created: 9, updated: 3 } | { created: [...], updated: [...] } |
//     { ok: true, orders_synced: N } | { failed: [{order_number, reason}] }
//
// SECURITY:
//   - Secrets live only in server env / app_settings. The GET response masks
//     everything; set/clear never echo values.
//   - The webhook target is SSRF-guarded (validateFetchTarget) like fetch-page.
//   - Only genuinely persisted Stripe-webhook orders are pushed — the demo
//     order (LX-1001) lives only in the browser UI and can never reach ERP.
//   - 12s timeout, sanitized errors (never include the token or full URL).
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { upsertAppSetting, deleteAppSetting } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import { validateFetchTarget } from '../_lib/ssrf.js';

const ERP_WEBHOOK_KEY = 'ERP_WEBHOOK_URL';
const ERP_TOKEN_KEY = 'ERP_API_TOKEN';
const ERP_SYNC_LEDGER_KEY = 'ERP_SYNC_STATUS';

const ERP_TIMEOUT_MS = 12_000;

type SyncStatus = 'created' | 'updated' | 'sent' | 'failed';

interface SyncEntry {
  status: SyncStatus;
  synced_at: string;
  error?: string;
}

function envWebhook(): string {
  return (process.env.EMBANI_ERP_WEBHOOK_URL || '').trim();
}
function envToken(): string {
  return (process.env.EMBANI_ERP_API_TOKEN || '').trim();
}

function maskToken(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Mask a webhook URL: keep the scheme+host (so the admin can identify it), mask the rest. */
function maskWebhook(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/••••••`;
  } catch {
    return '••••••••';
  }
}

function statusOf(configured: boolean, masked: string, source: 'env' | 'attached' | 'none') {
  return { configured, masked, source };
}

async function readSetting(key: string): Promise<string | null> {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRole) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value?: string }>;
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

/** Effective config: env wins over the attached (DB) value. */
async function effectiveConfig(): Promise<{ webhook: string; token: string; webhookSource: 'env' | 'attached' | 'none'; tokenSource: 'env' | 'attached' | 'none' }> {
  const [dbWebhook, dbToken] = await Promise.all([readSetting(ERP_WEBHOOK_KEY), readSetting(ERP_TOKEN_KEY)]);
  const wh = envWebhook() || dbWebhook || '';
  const tk = envToken() || dbToken || '';
  return {
    webhook: wh,
    token: tk,
    webhookSource: envWebhook() ? 'env' : dbWebhook ? 'attached' : 'none',
    tokenSource: envToken() ? 'env' : dbToken ? 'attached' : 'none',
  };
}

async function readSyncLedger(): Promise<Record<string, SyncEntry>> {
  const raw = await readSetting(ERP_SYNC_LEDGER_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SyncEntry>) : {};
  } catch {
    return {};
  }
}

async function writeSyncLedger(ledger: Record<string, SyncEntry>): Promise<boolean> {
  return upsertAppSetting(ERP_SYNC_LEDGER_KEY, JSON.stringify(ledger));
}

/** Make one ERP call with a 12s timeout; sanitized on failure. */
async function callErp(webhook: string, token: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    const msg = (e as Error).message || 'network error';
    // Timeout / network failure — do not leak URL or token details.
    return { ok: false, status: 0, body: '', error: msg.includes('timeout') ? 'ERP request timed out' : 'Could not reach the ERP server' };
  }
}

function derivePaymentStatus(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'awaiting_payment' || s === 'pending' || s === 'failed') return s === 'failed' ? 'failed' : 'pending';
  if (s === 'paid' || s === 'processing' || s === 'shipped' || s === 'delivered') return 'paid';
  if (s === 'refunded') return 'refunded';
  if (s === 'cancelled') return 'cancelled';
  return s || 'unknown';
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_email?: string | null;
  customer_name?: string | null;
  shipping_address?: unknown;
  items?: unknown[];
  coupon_code?: string | null;
  subtotal?: number | string | null;
  discount?: number | string | null;
  shipping?: number | string | null;
  tax?: number | string | null;
  total?: number | string | null;
  currency?: string | null;
  status?: string | null;
  stripe_session_id?: string | null;
  stripe_payment_intent?: string | null;
  created_at?: string | null;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Normalize one authoritative Luxedge order into the ERP contract. */
function normalizeOrder(row: OrderRow): Record<string, unknown> {
  const items = (Array.isArray(row.items) ? row.items : []).map((it) => {
    const r = (it || {}) as Record<string, unknown>;
    const quantity = Math.max(Number(r.quantity || 1), 0);
    const unitPrice = typeof r.unitPrice === 'number' ? r.unitPrice : Number(r.unitPrice || r.price || 0);
    return {
      product_id: r.id || null,
      sku: r.sku || r.variantSku || null,
      name: String(r.name || r.title || 'Item'),
      quantity,
      unit_price: unitPrice,
      line_total: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
  return {
    source: 'luxedge',
    order_id: row.id,
    order_number: row.order_number, // STABLE — preserved across retries for ERP reconciliation
    stripe_session_id: row.stripe_session_id || null,
    stripe_payment_intent: row.stripe_payment_intent || null,
    created_at: row.created_at || null,
    currency: row.currency || 'USD',
    subtotal: num(row.subtotal),
    shipping: num(row.shipping),
    tax: num(row.tax),
    discount: num(row.discount),
    total: num(row.total),
    payment_status: derivePaymentStatus(row.status || ''),
    fulfillment_status: row.status || 'unknown',
    coupon_code: row.coupon_code || null,
    customer: {
      name: row.customer_name || null,
      email: row.customer_email || null,
    },
    shipping_address: row.shipping_address || null,
    items,
  };
}

interface ParsedErpResult {
  created: number | null;
  updated: number | null;
  failed: { order_number?: string; reason?: string }[];
}

/** Lenient parsing of the ERP webhook response. */
function parseErpResponse(body: string): ParsedErpResult {
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  const out: ParsedErpResult = { created: null, updated: null, failed: [] };
  if (!data || typeof data !== 'object') return out;

  const pick = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  out.created = pick(['created', 'created_count', 'createdOrderNumbers', 'created_order_numbers', 'inserted']);
  out.updated = pick(['updated', 'updated_count', 'updatedOrderNumbers', 'updated_order_numbers', 'reconciled']);

  for (const k of ['failed', 'errors', 'failures']) {
    const list = (data as Record<string, unknown>)[k];
    if (Array.isArray(list)) {
      for (const f of list) {
        if (!f || typeof f !== 'object') continue;
        const fr = f as Record<string, unknown>;
        out.failed.push({
          order_number: String(fr.order_number || fr.orderNumber || fr.reference || fr.id || ''),
          reason: String(fr.reason || fr.error || fr.message || 'ERP rejected order').slice(0, 200),
        });
      }
      break;
    }
  }
  return out;
}

/** Authoritative real orders only — the demo row never exists in the DB. */
async function fetchRealOrders(): Promise<{ ok: boolean; status: number; orders: OrderRow[]; error?: string }> {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return { ok: false, status: 503, orders: [], error: 'Database is not configured on this deployment.' };
  try {
    const select = 'id,order_number,customer_email,customer_name,shipping_address,items,coupon_code,subtotal,discount,shipping,tax,total,currency,status,stripe_session_id,stripe_payment_intent,created_at';
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?coupon_code=not.eq.PET-GIFT-DROP&order=created_at.asc&select=${encodeURIComponent(select)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) },
    );
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) return { ok: false, status: res.status, orders: [], error: 'database request rejected' };
    return { ok: true, status: res.status, orders: Array.isArray(data) ? (data as OrderRow[]) : [] };
  } catch {
    return { ok: false, status: 502, orders: [], error: 'Database is unreachable right now.' };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'GET') {
    const [cfg, sync] = await Promise.all([effectiveConfig(), readSyncLedger()]);
    sendJson(res, 200, {
      webhook: statusOf(!!cfg.webhook, maskWebhook(cfg.webhook), cfg.webhookSource),
      token: statusOf(!!cfg.token, maskToken(cfg.token), cfg.tokenSource),
      sync,
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const action = String(body.action || '');

  // ── SET — store webhook/token server-side (app_settings). Env wins at read time. ──
  if (action === 'set') {
    const field = String(body.field || '');
    const value = String(body.value || '').trim();
    if (field !== 'webhook' && field !== 'token') {
      sendJson(res, 400, { error: 'field must be webhook or token' });
      return;
    }
    if (field === 'webhook') {
      if (!/^https?:\/\//.test(value)) {
        sendJson(res, 400, { error: 'Webhook URL must start with http:// or https://' });
        return;
      }
      const guard = await validateFetchTarget(value).catch(() => null);
      if (guard) {
        sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
        return;
      }
      if (envWebhook()) {
        sendJson(res, 400, { error: 'The webhook URL is configured in the server environment — edit it there, not in the UI.' });
        return;
      }
    } else if (value.length < 8) {
      sendJson(res, 400, { error: 'Token too short — paste the full token.' });
      return;
    }
    const ok = await upsertAppSetting(field === 'webhook' ? ERP_WEBHOOK_KEY : ERP_TOKEN_KEY, value);
    if (!ok) {
      sendJson(res, 502, { error: 'Could not save to the server (app_settings unavailable).' });
      return;
    }
    sendJson(res, 200, { ok: true, masked: field === 'webhook' ? maskWebhook(value) : maskToken(value) });
    return;
  }

  // ── CLEAR — remove the attached value (env values cannot be cleared via UI). ──
  if (action === 'clear') {
    const field = String(body.field || '');
    if (field !== 'webhook' && field !== 'token') {
      sendJson(res, 400, { error: 'field must be webhook or token' });
      return;
    }
    const key = field === 'webhook' ? ERP_WEBHOOK_KEY : ERP_TOKEN_KEY;
    if (field === 'webhook' && envWebhook()) {
      sendJson(res, 400, { error: 'The webhook URL is configured in the server environment — edit it there, not in the UI.' });
      return;
    }
    await deleteAppSetting(key);
    // Re-read effective config so the response reflects env fallbacks.
    const cfg = await effectiveConfig();
    sendJson(res, 200, {
      ok: true,
      configured: cfg.webhook || cfg.token ? true : false,
      masked: field === 'webhook' ? maskWebhook(cfg.webhook) : maskToken(cfg.token),
      source: field === 'webhook' ? cfg.webhookSource : cfg.tokenSource,
    });
    return;
  }

  // ── TEST — harmless ERP probe. Never creates orders or revenue records. ──
  if (action === 'test') {
    const cfg = await effectiveConfig();
    if (!cfg.webhook) {
      sendJson(res, 400, { error: 'ERP webhook URL is not configured yet — set it first.' });
      return;
    }
    const guard = await validateFetchTarget(cfg.webhook).catch(() => null);
    if (guard) {
      sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
      return;
    }
    const started = Date.now();
    const r = await callErp(cfg.webhook, cfg.token, {
      app: 'luxedge',
      event: 'test',
      test: true,
      sent_at: new Date().toISOString(),
      message: 'Luxedge ERP connection test — no order data, nothing to record.',
    });
    const latencyMs = Date.now() - started;
    if (r.ok) {
      sendJson(res, 200, { ok: true, status: r.status, latencyMs, message: 'ERP connection successful' });
      return;
    }
    if (r.status === 401 || r.status === 403) {
      sendJson(res, 200, { ok: false, status: r.status, latencyMs, message: `ERP connection failed — HTTP ${r.status} (unauthorized). Check the API token.` });
      return;
    }
    if (r.status === 0) {
      sendJson(res, 200, { ok: false, status: 0, latencyMs, message: `ERP connection failed — ${r.error}` });
      return;
    }
    const detail = r.body.slice(0, 160).replace(/\s+/g, ' ').trim();
    sendJson(res, 200, { ok: false, status: r.status, latencyMs, message: `ERP connection failed — HTTP ${r.status}${detail ? `: ${detail}` : ''}` });
    return;
  }

  // ── PUSH — sync real orders to ERP, record the ledger, report per-order failures. ──
  if (action === 'push') {
    const cfg = await effectiveConfig();
    if (!cfg.webhook) {
      sendJson(res, 400, { error: 'ERP webhook URL is not configured yet — set it first.' });
      return;
    }
    const guard = await validateFetchTarget(cfg.webhook).catch(() => null);
    if (guard) {
      sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
      return;
    }
    const db = await fetchRealOrders();
    if (!db.ok) {
      sendJson(res, db.status, { error: db.error });
      return;
    }
    // Defensive filter on top of the SQL exclusion — gift-drop $0 claims and
    // the demo LX-1001 order can never be pushed to ERP, even if a query or
    // data change ever let them through.
    const realOrders = db.orders.filter((o) => o.coupon_code !== 'PET-GIFT-DROP' && o.order_number !== 'LX-1001');
    if (realOrders.length === 0) {
      sendJson(res, 200, { ok: true, sent: 0, created: 0, updated: 0, failed: [], message: 'ERP Sync complete — no orders to push yet.' });
      return;
    }

    const orders = realOrders.map(normalizeOrder);
    const started = Date.now();
    const r = await callErp(cfg.webhook, cfg.token, {
      app: 'luxedge',
      event: 'orders.sync',
      sent_at: new Date().toISOString(),
      orders,
    });
    const latencyMs = Date.now() - started;

    const ledger = await readSyncLedger();
    const failedByNumber: Record<string, string> = {};
    if (r.ok) {
      const parsed = parseErpResponse(r.body);
      for (const f of parsed.failed) {
        if (f.order_number) failedByNumber[f.order_number] = f.reason || 'ERP rejected order';
      }
      const now = new Date().toISOString();
      for (const o of realOrders) {
        if (failedByNumber[o.order_number]) {
          ledger[o.order_number] = { status: 'failed', synced_at: now, error: failedByNumber[o.order_number] };
        } else {
          const status: SyncStatus =
            parsed.created !== null && parsed.updated !== null ? (parsed.created > 0 ? 'created' : 'updated')
            : parsed.created !== null ? 'created'
            : parsed.updated !== null ? 'updated'
            : 'sent';
          ledger[o.order_number] = { status, synced_at: now };
        }
      }
      await writeSyncLedger(ledger);

      const created = parsed.created;
      const updated = parsed.updated;
      const failed = realOrders
        .filter((o) => failedByNumber[o.order_number])
        .map((o) => ({ order_number: o.order_number, reason: failedByNumber[o.order_number] }));
      const parts = [`ERP Sync complete`, `Sent: ${realOrders.length}`];
      if (created !== null) parts.push(`Created: ${created}`);
      if (updated !== null) parts.push(`Updated: ${updated}`);
      parts.push(`Failed: ${failed.length}`);
      sendJson(res, 200, {
        ok: true,
        sent: realOrders.length,
        created,
        updated,
        failed,
        latencyMs,
        message: `${parts.join(' · ')}${created === null && updated === null ? ' (ERP response did not report created/updated counts)' : ''}`,
      });
      return;
    }

    // Whole batch failed — mark every order failed (sanitized reason only).
    const now = new Date().toISOString();
    let reason = `ERP request failed`;
    if (r.status === 401 || r.status === 403) reason = `ERP rejected request — HTTP ${r.status} (unauthorized). Check the API token.`;
    else if (r.status === 0) reason = `ERP request failed — ${r.error}`;
    else if (r.status >= 400 && r.status < 600) reason = `ERP returned HTTP ${r.status}`;
    for (const o of realOrders) {
      ledger[o.order_number] = { status: 'failed', synced_at: now, error: reason };
    }
    await writeSyncLedger(ledger);
    sendJson(res, 200, {
      ok: false,
      sent: realOrders.length,
      created: 0,
      updated: 0,
      failed: realOrders.map((o) => ({ order_number: o.order_number, reason })),
      latencyMs,
      message: `ERP Sync failed — ${reason}. No orders were confirmed.`,
    });
    return;
  }

  sendJson(res, 400, { error: 'Unknown action — use set, clear, test or push.' });
}