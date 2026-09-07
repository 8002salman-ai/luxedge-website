// ============================================================================
// LUXEDGE — /api/admin/payments  (multi-provider payment management)
//
// GET  → provider status overview (masked keys, health)
// POST → configure, test, enable/disable, set primary/backup
//
// Secrets are stored in app_settings (DB) and/or env vars.
// NEVER returns raw secret values.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { upsertAppSetting } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  type ProviderId,
  type PaymentProvidersConfig,
  defaultPaymentConfig,
  detectProviderFromEnv,
  getProvider,
} from '../_lib/payment-providers.js';

// Import all providers so they register themselves
import '../_lib/providers-square.js';
import '../_lib/providers-paypal.js';
import '../_lib/providers-braintree.js';
import '../_lib/providers-payoneer.js';
import '../_lib/providers-authorize-net.js';

const CONFIG_KEY = 'PAYMENT_PROVIDERS_CONFIG';

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function envVal(key: string): string {
  return (process.env[key] || '').trim();
}

function supabaseCfg(): { url: string; key: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

async function loadConfig(): Promise<PaymentProvidersConfig> {
  const cfg = supabaseCfg();
  if (!cfg) return defaultPaymentConfig();
  try {
    const res = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(CONFIG_KEY)}&select=value`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return defaultPaymentConfig();
    const rows = await res.json() as Array<{ value?: string }>;
    if (!rows[0]?.value) return defaultPaymentConfig();
    return { ...defaultPaymentConfig(), ...JSON.parse(rows[0].value) };
  } catch {
    return defaultPaymentConfig();
  }
}

async function saveConfig(config: PaymentProvidersConfig): Promise<boolean> {
  const cfg = supabaseCfg();
  if (!cfg) return false;
  try {
    await upsertAppSetting(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

const PROVIDER_DISPLAY: Record<ProviderId, { name: string; envKeys: Record<string, string>; dashboardUrl: string; setupChecklist: string[] }> = {
  none: { name: 'No Payment Required', envKeys: {}, dashboardUrl: '', setupChecklist: [] },
  stripe: {
    name: 'Stripe',
    envKeys: {
      'Secret Key': 'STRIPE_SECRET_KEY',
      'Webhook Secret': 'STRIPE_WEBHOOK_SECRET',
      'Publishable Key': 'STRIPE_PUBLISHABLE_KEY',
    },
    dashboardUrl: 'https://dashboard.stripe.com',
    setupChecklist: [
      'Stripe account created',
      'Business verification approved',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhook configured (checkout.session.completed, payment_intent.succeeded)',
      'Controlled payment tested',
      'Enabled',
    ],
  },
  square: {
    name: 'Square',
    envKeys: {
      'Application ID': 'SQUARE_APPLICATION_ID',
      'Access Token': 'SQUARE_ACCESS_TOKEN',
      'Location ID': 'SQUARE_LOCATION_ID',
      'Environment': 'SQUARE_ENVIRONMENT',
      'Webhook Signature Key': 'SQUARE_WEBHOOK_SIGNATURE_KEY',
    },
    dashboardUrl: 'https://developer.squareup.com/dashboard',
    setupChecklist: [
      'Square account created',
      'Business verification approved',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhook configured',
      'Controlled payment tested',
      'Enabled',
    ],
  },
  paypal: {
    name: 'PayPal',
    envKeys: {
      'Client ID': 'PAYPAL_CLIENT_ID',
      'Client Secret': 'PAYPAL_CLIENT_SECRET',
      'Environment': 'PAYPAL_ENVIRONMENT',
      'Webhook ID': 'PAYPAL_WEBHOOK_ID',
    },
    dashboardUrl: 'https://www.paypal.com/business',
    setupChecklist: [
      'PayPal Business account created',
      'Business verification approved',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhook configured',
      'Controlled payment tested',
      'Enabled',
    ],
  },
  braintree: {
    name: 'Braintree',
    envKeys: {
      'Merchant ID': 'BRAINTREE_MERCHANT_ID',
      'Public Key': 'BRAINTREE_PUBLIC_KEY',
      'Private Key': 'BRAINTREE_PRIVATE_KEY',
      'Environment': 'BRAINTREE_ENVIRONMENT',
    },
    dashboardUrl: 'https://www.braintreegateway.com',
    setupChecklist: [
      'Braintree merchant account created',
      'Business verification approved',
      'Settlement bank account linked',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhooks configured',
      'Controlled payment tested',
      'Payout/settlement confirmed',
      'Enabled',
    ],
  },
  payoneer: {
    name: 'Payoneer',
    envKeys: {
      'Client ID': 'PAYONEER_CLIENT_ID',
      'Client Secret': 'PAYONEER_CLIENT_SECRET',
      'Environment': 'PAYONEER_ENVIRONMENT',
      'Merchant ID': 'PAYONEER_MERCHANT_ID',
    },
    dashboardUrl: 'https://www.payoneer.com',
    setupChecklist: [
      'Payoneer account created',
      'Checkout application submitted',
      'Application approved',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhook configured',
      'Controlled payment tested',
      'Enabled',
    ],
  },
  authorize_net: {
    name: 'Authorize.Net',
    envKeys: {
      'Login ID': 'AUTHORIZENET_LOGIN_ID',
      'Transaction Key': 'AUTHORIZENET_TRANSACTION_KEY',
      'Client Key': 'AUTHORIZENET_CLIENT_KEY',
      'Environment': 'AUTHORIZENET_ENVIRONMENT',
      'Webhook Signature Key': 'AUTHORIZENET_SIGNATURE_KEY',
    },
    dashboardUrl: 'https://sandbox.authorize.net',
    setupChecklist: [
      'Authorize.Net account created',
      'Merchant account approved',
      'Sandbox credentials added',
      'Production credentials added',
      'Webhook configured',
      'Controlled payment tested',
      'Enabled',
    ],
  },
  manual: { name: 'Manual Payment', envKeys: {}, dashboardUrl: '', setupChecklist: ['Enable manual payment mode'] },
};

function buildProviderOverview() {
  const config = defaultPaymentConfig(); // sync fallback
  const envDetected = detectProviderFromEnv();
  const providers = Object.entries(PROVIDER_DISPLAY).filter(([id]) => id !== 'none').map(([id, display]) => {
    const pid = id as ProviderId;
    const cfg = config.providers[pid] || { enabled: false, role: 'available' as const, mode: 'sandbox' as const };
    const detected = envDetected[pid];
    const isConfigured = detected?.status === 'ready' || detected?.status === 'sandbox';
    const keys: Record<string, { configured: boolean; masked: string; source: string }> = {};
    for (const [label, envKey] of Object.entries(display.envKeys)) {
      const val = envVal(envKey);
      if (val) {
        keys[label] = { configured: true, masked: mask(val), source: 'env' };
      } else {
        keys[label] = { configured: false, masked: '', source: 'none' };
      }
    }
    return {
      id: pid, name: display.name, enabled: cfg.enabled, role: cfg.role,
      mode: detected?.mode || cfg.mode,
      status: detected?.status || (isConfigured ? (cfg.enabled ? 'ready' : 'sandbox') : 'not_configured'),
      isConfigured, keys, dashboardUrl: display.dashboardUrl, setupChecklist: display.setupChecklist,
      lastTestAt: cfg.lastTestAt, lastTestOk: cfg.lastTestOk,
      lastWebhookAt: cfg.lastWebhookAt, lastPaymentAt: cfg.lastPaymentAt, lastError: cfg.lastError,
    };
  });
  return { primary: config.primary, backup: config.backup, providers };
}

export async function handlePaymentsGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, ...buildProviderOverview() });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Support both GET and POST
  if (req.method === 'GET') { await handlePaymentsGet(req, res); return; }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  let body: unknown;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid body.' }); return; }
  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action || '');

  if (action === 'get' || !action) {
    // Return full payment system overview
    const { primary, backup, providers } = buildProviderOverview();
    sendJson(res, 200, { ok: true, primary, backup, providers });
    return;
  }  if (action === 'test') {
    const providerId = String(b.provider || '') as ProviderId;
    const p = getProvider(providerId);
    if (!p) { sendJson(res, 400, { error: `Unknown provider: ${providerId}` }); return; }
    const result = await p.testConnection();
    sendJson(res, result.ok ? 200 : 400, { ok: result.ok, message: result.message, mode: result.mode, masked: result.masked });
    return;
  }

  if (action === 'set_primary' || action === 'set_backup') {
    const providerId = String(b.provider || '') as ProviderId;
    const config = await loadConfig();
    if (action === 'set_primary') config.primary = providerId;
    else config.backup = providerId;
    await saveConfig(config);
    sendJson(res, 200, { ok: true, message: `${action === 'set_primary' ? 'Primary' : 'Backup'} set to ${providerId}` });
    return;
  }

  if (action === 'toggle') {
    const providerId = String(b.provider || '') as ProviderId;
    const enabled = b.enabled === true;
    const config = await loadConfig();
    if (!config.providers[providerId]) config.providers[providerId] = { enabled: false, role: 'available', mode: 'sandbox' };
    config.providers[providerId].enabled = enabled;
    await saveConfig(config);
    sendJson(res, 200, { ok: true, message: `${providerId} ${enabled ? 'enabled' : 'disabled'}` });
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
