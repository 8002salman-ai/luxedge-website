// ============================================================================
// LUXEDGE — Braintree Webhook Handler
//
// Receives payment notifications from Braintree, verifies using Braintree's
// webhook notification mechanism, and reconciles payment state with Luxedge
// orders. Idempotent: repeated webhooks never create duplicate orders.
//
// SECURITY: Signature verified server-side. Never trust browser callbacks.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';

function supabaseBase(): string { return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''); }
function serviceRole(): string { return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(); }

async function restFetch(table: string, query: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = supabaseBase(); const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database not configured' } };
  try {
    const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
    const method = init?.method || 'GET';
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init?.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      method, headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 502, data: { error: 'Database unreachable' } }; }
}

// Braintree webhook verification: check the X-Brainree-Signature header
// against our private key using HMAC-SHA1 (Braintree's current mechanism)
async function verifyBraintreeSignature(
  body: string,
  signatureHeader: string,
  privateKey: string,
): Promise<boolean> {
  if (!privateKey || !signatureHeader) return false;
  try {
    // Braintree sends: signature=<hex>;timestamp=<ts>
    const parts = Object.fromEntries(signatureHeader.split(';').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), (v || '').trim()];
    }));
    const sig = parts['signature'];
    const timestamp = parts['timestamp'];
    if (!sig || !timestamp) return false;

    // HMAC-SHA1 of "timestamp|body|private_key" — Braintree's documented verification
    const message = `${timestamp}|${body}|${privateKey}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(privateKey);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const messageData = encoder.encode(message);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const computedHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHex === sig;
  } catch { return false; }
}

interface BraintreeNotification {
  kind?: string;
  timestamp?: string;
  subject?: {
    transaction?: {
      id?: string;
      status?: string;
      amount?: string;
      order_id?: string;
      payment_instrument_type?: string;
    };
    dispute?: {
      id?: string;
      status?: string;
      transaction?: { id?: string; };
    };
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  let rawBody = '';
  try {
    rawBody = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  } catch { sendJson(res, 400, { error: 'Could not read request body' }); return; }

  // Verify signature when configured
  const privateKey = process.env.BRAINTREE_PRIVATE_KEY || '';
  if (privateKey) {
    const sigHeader = req.headers['x-braintree-signature'] as string || '';
    const valid = await verifyBraintreeSignature(rawBody, sigHeader, privateKey);
    if (!valid) { sendJson(res, 401, { error: 'Invalid webhook signature' }); return; }
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const notification = (body ?? {}) as BraintreeNotification;
  const kind = notification.kind || '';
  const transaction = notification.subject?.transaction;

  switch (kind) {
    case 'transaction_disbursed':
    case 'transaction_settled':
    case 'transaction_settlement_declined': {
      if (!transaction?.id) { sendJson(res, 200, { ok: true, ignored: true }); return; }

      // Find order by Braintree transaction ID (idempotent)
      const r = await restFetch('luxedge_orders',
        `?payment_provider=eq.braintree&payment_provider_payment_id=eq.${encodeURIComponent(transaction.id)}&limit=1`);

      if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
        const order = r.data[0] as Record<string, unknown>;
        const newStatus = kind === 'transaction_settlement_declined' ? 'payment_failed' : 'paid';
        if (order.payment_status !== newStatus && order.payment_status !== 'paid') {
          await restFetch('luxedge_orders', `?id=eq.${order.id}`, {
            method: 'PATCH',
            body: { payment_status: newStatus, status: newStatus === 'paid' ? 'processing' : order.status },
            prefer: 'return=minimal',
          });
        }
        sendJson(res, 200, { ok: true, orderId: order.id, status: 'reconciled' });
        return;
      }
      console.error('[Braintree Webhook] No matching order for transaction:', transaction.id);
      sendJson(res, 200, { ok: true, warning: 'No matching order found', transactionId: transaction.id });
      return;
    }

    case 'dispute_opened':
    case 'dispute_lost':
    case 'dispute_won': {
      const dispute = notification.subject?.dispute;
      if (dispute?.transaction?.id) {
        const r = await restFetch('luxedge_orders',
          `?payment_provider=eq.braintree&payment_provider_payment_id=eq.${encodeURIComponent(dispute.transaction.id)}&limit=1`);
        if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
          const order = r.data[0] as Record<string, unknown>;
          await restFetch('luxedge_orders', `?id=eq.${order.id}`, {
            method: 'PATCH',
            body: { payment_status: kind === 'dispute_won' ? 'paid' : 'disputed' },
            prefer: 'return=minimal',
          });
        }
      }
      sendJson(res, 200, { ok: true, kind });
      return;
    }

    default:
      sendJson(res, 200, { ok: true, ignored: true, kind });
  }
}
