// GET/POST /api/admin/payment-keys
// Admin-only endpoint to manage the owner-attached Stripe payment keys.
// Keys are stored in the Supabase app_settings table as `PAYMENT_STRIPE_SECRET_KEY`
// and `PAYMENT_STRIPE_WEBHOOK_SECRET` — server-side only, never in the browser.
// Env vars (wrangler secrets / Vercel env) always win; the DB keys are the
// fallback so the owner can attach/rotate keys from Admin → Payments without a
// redeploy (mirrors the AI-key / CJ-key model).
//
// GET:  { secretKey: { configured, masked, source }, webhookSecret: {...} }
// POST { action: 'set', keyType: 'secretKey'|'webhookSecret', key }
//      | { action: 'clear', keyType }
//      | { action: 'test' }   → live account probe (safe read-only balance/account)
//
// NEVER returns a full key. set/clear never echo the key. The test action
// returns only safe account facts (mode, charges_enabled, masked key).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { upsertAppSetting, deleteAppSetting } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import { STRIPE_SETTING_KEYS, resetStripeKeyCache } from '../_lib/stripe.js';

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function envOrDb(envVal: string, dbVal: string): { configured: boolean; masked: string; source: string } {
  if (envVal) return { configured: true, masked: mask(envVal), source: 'env' };
  if (dbVal) return { configured: true, masked: mask(dbVal), source: 'attached' };
  return { configured: false, masked: '', source: 'none' };
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

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'GET') {
    const envSecret = (process.env.STRIPE_SECRET_KEY || '').trim();
    const envWh = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const [dbSecret, dbWh] = await Promise.all([
      readSetting(STRIPE_SETTING_KEYS.secretKey),
      readSetting(STRIPE_SETTING_KEYS.webhookSecret),
    ]);
    sendJson(res, 200, {
      secretKey: envOrDb(envSecret, dbSecret || ''),
      webhookSecret: envOrDb(envWh, dbWh || ''),
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

  if (action === 'set') {
    const keyType = String(body.keyType || '');
    const key = String(body.key || '').trim();
    const settingKey =
      keyType === 'secretKey' ? STRIPE_SETTING_KEYS.secretKey
      : keyType === 'webhookSecret' ? STRIPE_SETTING_KEYS.webhookSecret
      : '';
    if (!settingKey) {
      sendJson(res, 400, { error: 'keyType must be secretKey or webhookSecret' });
      return;
    }
    if (key.length < 8) {
      sendJson(res, 400, { error: 'Key too short — paste the full key.' });
      return;
    }
    const ok = await upsertAppSetting(settingKey, key);
    if (!ok) {
      sendJson(res, 502, { error: 'Could not save the key to the server (app_settings unavailable).' });
      return;
    }
    resetStripeKeyCache();
    sendJson(res, 200, { ok: true, masked: mask(key) });
    return;
  }

  if (action === 'clear') {
    const keyType = String(body.keyType || '');
    const settingKey =
      keyType === 'secretKey' ? STRIPE_SETTING_KEYS.secretKey
      : keyType === 'webhookSecret' ? STRIPE_SETTING_KEYS.webhookSecret
      : '';
    if (!settingKey) {
      sendJson(res, 400, { error: 'keyType must be secretKey or webhookSecret' });
      return;
    }
    await deleteAppSetting(settingKey);
    resetStripeKeyCache();
    const stillEnv = keyType === 'secretKey'
      ? !!(process.env.STRIPE_SECRET_KEY || '').trim()
      : !!(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    sendJson(res, 200, { ok: true, configured: stillEnv, masked: stillEnv ? '•••• (env)' : '' });
    return;
  }

  if (action === 'test') {
    const envSecret = (process.env.STRIPE_SECRET_KEY || '').trim();
    const dbSecret = await readSetting(STRIPE_SETTING_KEYS.secretKey);
    const testKey = envSecret || dbSecret || '';
    if (!testKey) {
      sendJson(res, 200, { ok: false, message: 'Not configured — attach a Stripe secret key first.' });
      return;
    }
    try {
      const resAcct = await fetch('https://api.stripe.com/v1/account', {
        headers: { Authorization: `Bearer ${testKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const acct = (await resAcct.json().catch(() => ({}))) as {
        livemode?: boolean;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
        id?: string;
        error?: { message?: string };
      };
      if (!resAcct.ok) {
        sendJson(res, 200, {
          ok: false,
          message: acct.error?.message ? 'Stripe rejected the key — check it is valid.' : 'Stripe rejected the key.',
        });
        return;
      }
      // livemode is absent on some standard account responses, so fall back to
      // the key prefix — sk_live_ can only ever talk to the live API.
      const mode =
        typeof acct.livemode === 'boolean'
          ? (acct.livemode ? 'live' : 'test')
          : testKey.startsWith('sk_live_') || testKey.startsWith('rk_live_')
            ? 'live'
            : 'test';
      sendJson(res, 200, {
        ok: true,
        mode,
        chargesEnabled: acct.charges_enabled === true,
        payoutsEnabled: acct.payouts_enabled === true,
        accountId: acct.id ? mask(acct.id) : '',
        masked: mask(testKey),
      });
      return;
    } catch (e) {
      sendJson(res, 200, { ok: false, message: (e as Error).message || 'Stripe is unreachable right now.' });
      return;
    }
  }

  sendJson(res, 400, { error: 'action must be set, clear or test' });
}
